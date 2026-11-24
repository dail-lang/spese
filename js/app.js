import * as L from './logic.js';
import { loadState, saveState, requestPersistence, uid, emptyState } from './store.js';
import { icon, CATEGORY_ICONS, CATEGORY_COLORS } from './icons.js';

const APP_VERSION = '1.0.0';

let S = null; // persisted state
const ui = {
  tab: 'month',
  month: null,
  trendRange: 6,
  trendCat: null,
  trendSel: null,
  installHidden: false,
};

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => L.toISO(new Date());
const eur = (c) => L.formatEuro(c);
const eur0 = (c) => L.formatEuro(c, { decimals: false });

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const coarse = () => matchMedia('(pointer: coarse)').matches;

function cat(id) {
  return S.categories.find((c) => c.id === id) || S.categories.find((c) => c.id === 'altro') || { id: 'altro', name: 'Altro', icon: 'dots', color: 'slate' };
}
const sortedCats = () => [...S.categories].sort((a, b) => a.order - b.order);

function shortDate(iso, withYear = false) {
  const { y, m, d } = L.parseISO(iso);
  const showYear = withYear || y !== new Date().getFullYear();
  return `${d} ${L.MONTHS_SHORT[m - 1]}${showYear ? ` ${y}` : ''}`;
}

function splitEuro(c) {
  const [int, dec] = L.formatEuro(c).replace('€ ', '').split(',');
  return `<span class="cents">€</span> ${int}<span class="cents">,${dec}</span>`;
}

function chipIc(c, size = '') {
  return `<span class="chip-ic ${size} c-${c.color}">${icon(c.icon)}</span>`;
}

function spend(month, categoryId = null) {
  const [from, to] = L.monthRange(month);
  let s = 0;
  for (const e of S.expenses) {
    if (e.date >= from && e.date <= to && (!categoryId || e.categoryId === categoryId)) s += e.amount;
  }
  return s;
}

function persist() {
  saveState(S).catch(() => toast('Impossibile salvare i dati su questo dispositivo.', { kind: 'over' }));
}

// ---------- refresh plumbing ----------

const refreshers = new Set();
function refresh() {
  render(false);
  refreshers.forEach((fn) => fn());
}

function runRecurring() {
  const created = L.materializeRecurring(S.recurring, today(), uid);
  if (created.length) {
    S.expenses.push(...created);
    persist();
  }
  return created;
}

// ---------- toasts ----------

function toast(msg, { kind = '', action = null, onAction = null, ms = 3800 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  const ic = { warn: 'alert', over: 'alert', ok: 'check' }[kind] || 'info';
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  host.appendChild(el);
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  const t = setTimeout(remove, ms);
  if (action) el.querySelector('button').onclick = () => { clearTimeout(t); remove(); onAction?.(); };
  while (host.children.length > 3) host.firstElementChild.remove();
}

// ---------- system notifications ----------

async function notify(title, body) {
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `limit-${title}` });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch { /* ignore */ }
}

function checkLimits(month, categoryId, beforeCat, beforeTot) {
  if (month !== L.monthKey(today())) return;
  const c = cat(categoryId);
  const afterCat = spend(month, categoryId);
  const afterTot = spend(month);
  const alerts = [];
  const lvlC = L.crossedLevel(beforeCat, afterCat, c.limit);
  if (lvlC) alerts.push(limitMsg(c.name, afterCat, c.limit, lvlC));
  const lvlT = L.crossedLevel(beforeTot, afterTot, S.settings.totalLimit);
  if (lvlT) alerts.push(limitMsg('Totale del mese', afterTot, S.settings.totalLimit, lvlT));
  alerts.forEach((a, i) => setTimeout(() => {
    toast(a.text, { kind: a.level, ms: 5200 });
    notify(a.title, a.text);
  }, 400 + i * 300));
}

function limitMsg(name, spent, limit, level) {
  if (level === 'over') {
    return { level, title: `${name}: limite superato`, text: `${name}: limite superato di ${eur(spent - limit)} (${eur0(spent)} su ${eur0(limit)}).` };
  }
  return { level, title: `${name}: quasi al limite`, text: `${name}: hai usato il ${Math.round((spent / limit) * 100)}% del limite (${eur0(spent)} su ${eur0(limit)}).` };
}

// ---------- sheets ----------

const sheetStack = [];

function sheetHead(title, extra = '') {
  return `<div class="sheet-head"><h2>${title}</h2>${extra}<button class="icon-btn" type="button" data-close aria-label="Chiudi">${icon('x')}</button></div>`;
}

function openSheet(html, { full = false, onClose = null, refresh: refreshFn = null } = {}) {
  const layer = $('#layer');
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="backdrop"></div><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  layer.appendChild(wrap);
  document.body.classList.add('locked');
  const sheet = wrap.querySelector('.sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    sheet.style.transform = '';
    const i = sheetStack.indexOf(close);
    if (i >= 0) sheetStack.splice(i, 1);
    if (refreshFn) refreshers.delete(refreshFn);
    setTimeout(() => {
      wrap.remove();
      if (!layer.children.length) document.body.classList.remove('locked');
    }, 320);
    onClose?.();
  };
  sheetStack.push(close);
  if (refreshFn) refreshers.add(refreshFn);
  wrap.querySelector('.backdrop').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  enableSwipeClose(sheet, close);
  return { sheet, close };
}

function enableSwipeClose(sheet, close) {
  const head = sheet.querySelector('.sheet-head');
  if (!head) return;
  let y0 = null; let dy = 0;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select')) return;
    y0 = e.clientY; dy = 0; sheet.style.transition = 'none';
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null; sheet.style.transition = '';
    if (dy > 90) close(); else sheet.style.transform = '';
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1]();
});

// ---------- render ----------

const TABS = {
  month: ['wallet', 'Mese'],
  trend: ['chart', 'Andamento'],
  recurring: ['repeat', 'Ricorrenti'],
  settings: ['sliders', 'Impostazioni'],
};

function renderTabs() {
  $$('.tab').forEach((b) => {
    const [ic, label] = TABS[b.dataset.tab];
    b.innerHTML = `${icon(ic)}<span>${label}</span>`;
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('.fab').innerHTML = icon('plus');
}

function render(animate = true) {
  const v = $('#view');
  const views = { month: viewMonth, trend: viewTrend, recurring: viewRecurring, settings: viewSettings };
  v.innerHTML = views[ui.tab]();
  if (animate) { v.classList.remove('view-enter'); void v.offsetWidth; v.classList.add('view-enter'); }
  renderTabs();
  fillBars(v, !animate);
}

function fillBars(root, instant = false) {
  const bars = $$('.bar > i[data-w]', root);
  if (instant) { bars.forEach((i) => { i.style.transition = 'none'; i.style.width = i.dataset.w; }); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach((i) => { i.style.width = i.dataset.w; })));
}

function bar(pct, level = '', color = '') {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="bar ${level} ${color ? `c-${color}` : ''}"><i data-w="${w.toFixed(1)}%"></i></div>`;
}

// ---------- view: month ----------

function viewMonth() {
  const t = today();
  const key = ui.month;
  const curKey = L.monthKey(t);
  const isCur = key === curKey;
  const sum = L.monthSummary(S.expenses, key, t);
  const [from, to] = L.monthRange(key);
  const list = S.expenses.filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const upcoming = isCur ? L.upcomingThisMonth(S.recurring, t) : [];
  const upTotal = upcoming.reduce((s, u) => s + u.rule.amount, 0);
  const prevName = L.monthLabel(sum.compare.prevKey, false);
  const monthName = L.monthLabel(key, false);

  // hero
  const diff = sum.compare.cur.total - sum.compare.prev.total;
  let delta = '';
  if (sum.compare.prev.total || sum.compare.cur.total) {
    const span = sum.compare.partial ? ' a pari giorni' : '';
    delta = diff === 0
      ? `<div class="hero-delta">Come ${prevName}${span}</div>`
      : `<div class="hero-delta">${icon(diff > 0 ? 'arrowUp' : 'arrowDown')} ${eur0(Math.abs(diff))} ${diff > 0 ? 'in più' : 'in meno'} di ${prevName}${span}</div>`;
  }

  const catsWithSpend = sortedCats().map((c) => ({ c, v: sum.by[c.id] || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const R = 40; const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = catsWithSpend.map(({ c, v }) => {
    const len = (v / (sum.total || 1)) * C;
    const gap = catsWithSpend.length > 1 && len > 4 ? 2.5 : 0;
    const s = `<circle class="seg c-${c.color}" cx="50" cy="50" r="${R}" stroke-dasharray="${(len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"/>`;
    acc += len;
    return s;
  }).join('');
  const donut = `<svg class="donut on-dark" viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="${R}"/>${segs}</svg>`;

  let limitHtml = '';
  const TL = S.settings.totalLimit;
  if (TL) {
    const lvl = L.limitLevel(sum.total, TL);
    const left = TL - sum.total;
    limitHtml = `<div class="hero-limit">${bar((sum.total / TL) * 100, lvl === 'ok' ? '' : lvl)}
      <div class="hero-limit-text num"><span>${left >= 0 ? `${eur0(left)} rimasti` : `Superato di ${eur0(-left)}`}</span><span>limite ${eur0(TL)}</span></div></div>`;
  }

  const chips = [];
  if (upTotal) chips.push(`<span class="hero-chip">${icon('repeat')} In arrivo ${eur0(upTotal)}</span>`);
  if (list.length) chips.push(`<span class="hero-chip">${icon('tag')} ${list.length} ${list.length === 1 ? 'spesa' : 'spese'}</span>`);

  const hero = `<section class="hero">
    <div class="hero-row">
      <div class="hero-main">
        <div class="hero-label">${isCur ? `Speso a ${monthName}` : `Speso a ${monthName} ${key.slice(0, 4)}`}</div>
        <div class="hero-total num">${splitEuro(sum.total)}</div>
        ${delta}
      </div>
      ${sum.total ? donut : ''}
    </div>
    ${limitHtml}
    ${chips.length ? `<div class="hero-chips">${chips.join('')}</div>` : ''}
  </section>`;

  // banners
  let banners = '';
  if (!isStandalone() && !ui.installHidden) {
    banners += `<div class="banner">${icon('phone')}<div class="banner-body"><b>Aggiungila alla schermata Home</b>
      Funziona offline. Poi usa sempre l'icona: i dati del browser sono separati.<br><button class="link" type="button" data-action="install-help">Come si fa</button>
      &nbsp;·&nbsp;<button class="link" type="button" data-action="hide-install">Non ora</button></div></div>`;
  }
  if (S.expenses.length >= 5) {
    const last = S.settings.lastBackup;
    const days = last ? (Date.now() - last) / 86400000 : Infinity;
    const oldest = Math.min(...S.expenses.map((e) => e.createdAt || Date.now()));
    if (days > 30 && (last || Date.now() - oldest > 7 * 86400000)) {
      banners += `<div class="banner warn">${icon('download')}<div class="banner-body"><b>${last ? 'Fai un nuovo backup' : 'Fai il primo backup'}</b>
        I dati sono solo su questo telefono. ${last ? `Ultimo backup: ${shortDate(L.toISO(new Date(last)), true)}.` : ''}
        <br><button class="link" type="button" data-action="export-json">Esporta ora</button></div></div>`;
    }
  }

  // categories
  const showCats = sortedCats()
    .map((c) => ({ c, v: sum.by[c.id] || 0 }))
    .filter((x) => x.v > 0 || (isCur && x.c.limit))
    .sort((a, b) => b.v - a.v || (b.c.limit || 0) - (a.c.limit || 0));
  const maxV = Math.max(1, ...showCats.map((x) => x.v));
  const prevShort = L.MONTHS_SHORT[Number(sum.compare.prevKey.slice(5)) - 1];
  const catRows = showCats.map(({ c, v }) => {
    let barHtml; let left;
    if (c.limit) {
      const lvl = L.limitLevel(v, c.limit);
      const pct = (v / c.limit) * 100;
      barHtml = bar(pct, lvl === 'ok' ? '' : lvl, c.color);
      left = `<span class="${lvl === 'warn' ? 'lvl-warn' : lvl === 'over' ? 'lvl-over' : ''}">${Math.round(pct)}% di ${eur0(c.limit)}</span>`;
    } else {
      barHtml = bar((v / maxV) * 100, '', c.color);
      left = `<span>${sum.total ? Math.round((v / sum.total) * 100) : 0}% del totale</span>`;
    }
    const cc = sum.compare.cur.by[c.id] || 0;
    const pc = sum.compare.prev.by[c.id] || 0;
    let right = '';
    if (cc || pc) {
      const d = cc - pc;
      right = d === 0 ? `<span>come ${prevShort}</span>`
        : `<span class="${d > 0 ? 'delta-up' : 'delta-down'}">${d > 0 ? '+' : '−'}${eur0(Math.abs(d))} vs ${prevShort}</span>`;
    }
    return `<button class="cat-row" type="button" data-action="cat-detail" data-id="${c.id}">
      <div class="cat-top">${chipIc(c)}<span class="cat-name">${esc(c.name)}</span><span class="cat-amount num">${eur(v)}</span></div>
      <div class="cat-bar">${barHtml}</div>
      <div class="cat-meta num">${left}${right}</div>
    </button>`;
  }).join('');

  // expenses grouped by day
  let expHtml = '';
  if (list.length) {
    const groups = new Map();
    list.forEach((e) => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
    for (const [date, items] of groups) {
      const tot = items.reduce((s, e) => s + e.amount, 0);
      expHtml += `<div class="day-head"><span>${L.dayLabel(date, t)}</span><span class="num">${eur(tot)}</span></div>
        <div class="list">${items.map(expRow).join('')}</div>`;
    }
  }

  const empty = `<div class="empty"><div class="bubble">${icon('wallet')}</div>
    <h3>Nessuna spesa a ${monthName}</h3><p>${isCur ? 'Tocca + per segnare la prima.' : 'Non hai segnato spese in questo mese.'}</p></div>`;

  return `
    <header class="top">
      <div class="month-switch">
        <button class="icon-btn" type="button" data-action="month-prev" aria-label="Mese precedente">${icon('chevL')}</button>
        <h1>${L.monthLabel(key, false).replace(/^./, (m) => m.toUpperCase())}${key.slice(0, 4) !== curKey.slice(0, 4) ? ` <span class="muted" style="font-weight:600">${key.slice(0, 4)}</span>` : ''}</h1>
        <button class="icon-btn" type="button" data-action="month-next" aria-label="Mese successivo" ${key >= curKey ? 'disabled' : ''}>${icon('chevR')}</button>
      </div>
      ${!isCur ? `<button class="icon-btn" type="button" data-action="month-today" aria-label="Torna al mese corrente">${icon('calendar')}</button>` : ''}
      <button class="icon-btn filled" type="button" data-action="search" aria-label="Cerca">${icon('search')}</button>
    </header>
    ${banners}
    ${hero}
    ${showCats.length ? `<div class="section-title"><span>Per categoria</span></div><div class="list">${catRows}</div>` : ''}
    ${list.length ? `<div class="section-title"><span>Movimenti</span></div>${expHtml}` : empty}
  `;
}

function expRow(e, { withDate = false } = {}) {
  const c = cat(e.categoryId);
  const title = e.note ? esc(e.note) : esc(c.name);
  const sub = [e.note ? esc(c.name) : '', withDate ? shortDate(e.date) : ''].filter(Boolean).join(' · ');
  return `<button class="exp-row" type="button" data-action="edit-exp" data-id="${e.id}">
    ${chipIc(c, 'sm')}
    <div class="exp-main"><div class="exp-title">${title}</div>
      ${sub || e.recurringId ? `<div class="exp-sub">${e.recurringId ? icon('repeat') : ''}${sub || 'Ricorrente'}</div>` : ''}</div>
    <div class="exp-amount num">${eur(e.amount)}</div>
  </button>`;
}

// ---------- view: trend ----------

function viewTrend() {
  const t = today();
  const endKey = L.monthKey(t);
  const n = ui.trendRange;
  const data = L.monthlyTotals(S.expenses, endKey, n, ui.trendCat);
  const sel = data.find((d) => d.key === ui.trendSel) || data[data.length - 1];
  const max = Math.max(1, ...data.map((d) => d.total));
  const full = data.filter((d) => d.key !== endKey);
  const fullWithData = full.filter((d) => d.total > 0);
  const avg = fullWithData.length ? Math.round(fullWithData.reduce((s, d) => s + d.total, 0) / fullWithData.length) : 0;
  const top = data.reduce((a, b) => (b.total > a.total ? b : a), data[0]);
  const periodTotal = data.reduce((s, d) => s + d.total, 0);
  const selCat = ui.trendCat ? cat(ui.trendCat) : null;

  const W = 340; const H = 180; const top0 = 18; const bottom = 24;
  const ch = H - top0 - bottom;
  const slot = W / n; const bw = Math.min(30, slot * 0.6);
  const bars = data.map((d, i) => {
    const h = Math.max(d.total ? 4 : 2, (d.total / max) * ch);
    const x = i * slot + (slot - bw) / 2;
    const y = top0 + ch - h;
    const m = Number(d.key.slice(5));
    const cls = `${d.key === sel.key ? 'sel' : ''} ${d.key === endKey ? 'cur' : ''}`;
    return `<g data-action="trend-sel" data-key="${d.key}">
      <rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H}"/>
      <rect class="b ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(8, bw / 3).toFixed(1)}"/>
      <text class="lbl ${d.key === sel.key ? 'sel' : ''}" x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 6}">${L.MONTHS_SHORT[m - 1]}</text>
    </g>`;
  }).join('');
  const avgY = top0 + ch - (avg / max) * ch;
  const avgLine = avg ? `<line class="avg" x1="0" x2="${W}" y1="${avgY.toFixed(1)}" y2="${avgY.toFixed(1)}"/>` : '';

  // breakdown for the period (only when "Tutte")
  let breakdown = '';
  if (!ui.trendCat) {
    const [from] = L.monthRange(data[0].key);
    const [, to] = L.monthRange(endKey);
    const s = L.sumBy(L.expensesInRange(S.expenses, from, to));
    const rows = sortedCats().map((c) => ({ c, v: s.by[c.id] || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (rows.length) {
      breakdown = `<div class="section-title"><span>Dove sono andati</span><span class="aside">ultimi ${n} mesi</span></div>
      <div class="list">${rows.map(({ c, v }) => `<button class="cat-row" type="button" data-action="trend-cat" data-id="${c.id}">
        <div class="cat-top">${chipIc(c)}<span class="cat-name">${esc(c.name)}</span><span class="cat-amount num">${eur0(v)}</span></div>
        <div class="cat-bar">${bar((v / s.total) * 100, '', c.color)}</div>
        <div class="cat-meta num"><span>${Math.round((v / s.total) * 100)}% del periodo</span><span>${eur0(Math.round(v / n))} al mese</span></div>
      </button>`).join('')}</div>`;
    }
  }

  const chips = [`<button class="fchip" type="button" data-action="trend-cat" data-id="" aria-pressed="${!ui.trendCat}">Tutte</button>`]
    .concat(sortedCats().map((c) => `<button class="fchip c-${c.color}" type="button" data-action="trend-cat" data-id="${c.id}" aria-pressed="${ui.trendCat === c.id}">${icon(c.icon)}${esc(c.name)}</button>`)).join('');

  return `
    <header class="top"><h1>Andamento</h1>
      <div class="seg" role="group" aria-label="Periodo" style="width:150px">
        <button type="button" data-action="trend-range" data-n="6" aria-pressed="${n === 6}">6 mesi</button>
        <button type="button" data-action="trend-range" data-n="12" aria-pressed="${n === 12}">12 mesi</button>
      </div>
    </header>
    <div class="chips">${chips}</div>
    <section class="card chart-card" style="margin-top:10px">
      <div class="chart-head">
        <div class="sub">${L.monthLabel(sel.key)}${sel.key === endKey ? ' · finora' : ''}${selCat ? ` · ${esc(selCat.name)}` : ''}</div>
        <div class="big num">${eur(sel.total)}</div>
        <button class="link" type="button" data-action="open-month" data-key="${sel.key}" style="color:var(--accent);font-weight:650;font-size:14px">Apri il mese ›</button>
      </div>
      <svg class="chart ${selCat ? `c-${selCat.color}` : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spese mensili">${avgLine}${bars}</svg>
    </section>
    <div class="stats">
      <div class="card stat"><div class="k">Media mensile</div><div class="v num">${avg ? eur0(avg) : '—'}</div></div>
      <div class="card stat"><div class="k">Mese più caro</div><div class="v num">${top.total ? L.MONTHS_SHORT[Number(top.key.slice(5)) - 1] : '—'}</div></div>
      <div class="card stat"><div class="k">Totale</div><div class="v num">${eur0(periodTotal)}</div></div>
    </div>
    <p class="footnote">La linea tratteggiata è la media: conta solo i mesi conclusi con almeno una spesa.</p>
    ${breakdown}
  `;
}

// ---------- view: recurring ----------

function monthlyEquivalent(r) {
  if (r.freq === 'weekly') return (r.amount * 52) / 12;
  if (r.freq === 'yearly') return r.amount / 12;
  return r.amount;
}

function viewRecurring() {
  const active = S.recurring.filter((r) => r.active).sort((a, b) => L.nextDate(a).localeCompare(L.nextDate(b)));
  const paused = S.recurring.filter((r) => !r.active);
  const eq = Math.round(active.reduce((s, r) => s + monthlyEquivalent(r), 0));
  const row = (r) => {
    const c = cat(r.categoryId);
    return `<button class="exp-row" type="button" data-action="edit-rule" data-id="${r.id}">
      ${chipIc(c, 'sm')}
      <div class="exp-main"><div class="exp-title">${esc(r.note || c.name)}</div>
        <div class="exp-sub">${L.FREQ_LABEL[r.freq]}${r.active ? ` · prossima ${shortDate(L.nextDate(r))}` : ' · in pausa'}</div></div>
      <div class="exp-amount num">${eur(r.amount)}</div>
    </button>`;
  };
  return `
    <header class="top"><h1>Ricorrenti</h1></header>
    ${active.length ? `<section class="hero" style="padding-bottom:20px">
      <div class="hero-label">Spese fisse, circa</div>
      <div class="hero-total num">${splitEuro(eq)}<span class="cents" style="font-size:18px"> / mese</span></div>
      <div class="hero-delta">${active.length} ${active.length === 1 ? 'attiva' : 'attive'} · vengono aggiunte da sole alla data prevista</div>
    </section>` : ''}
    ${active.length ? `<div class="section-title"><span>Attive</span></div><div class="list">${active.map(row).join('')}</div>` : `
      <div class="empty"><div class="bubble">${icon('repeat')}</div><h3>Nessuna spesa ricorrente</h3>
      <p>Affitto, abbonamenti, bollette fisse: segnale una volta e l'app le aggiunge da sola ogni mese, settimana o anno.</p></div>`}
    ${paused.length ? `<div class="section-title"><span>In pausa</span></div><div class="list">${paused.map(row).join('')}</div>` : ''}
    <button class="btn block" type="button" data-action="add-rule">${icon('plus')} Nuova spesa ricorrente</button>
  `;
}

// ---------- view: settings ----------

function viewSettings() {
  const notifSupported = 'Notification' in window;
  const perm = notifSupported ? Notification.permission : 'unsupported';
  let notifNote = 'Ricevi un avviso quando una categoria o il totale arriva all\'80% o supera il limite.';
  if (!notifSupported) notifNote += isIOS() ? ' Su iPhone le notifiche funzionano solo con l\'app aggiunta alla schermata Home (iOS 16.4 o successivo); nel frattempo vedrai gli avvisi dentro l\'app.' : ' Questo browser non supporta le notifiche: vedrai gli avvisi dentro l\'app.';
  else if (perm === 'denied') notifNote += ' Le notifiche sono bloccate nelle impostazioni del telefono: vedrai gli avvisi dentro l\'app.';
  const last = S.settings.lastBackup;

  return `
    <header class="top"><h1>Impostazioni</h1></header>

    <div class="section-title"><span>Limiti di spesa</span></div>
    <div class="list">
      <button class="row" type="button" data-action="edit-total-limit">
        <span class="ico-tile" style="--c:var(--accent)">${icon('target')}</span>
        <span class="label">Limite totale mensile</span>
        <span class="value num">${S.settings.totalLimit ? eur0(S.settings.totalLimit) : 'Nessuno'}</span>${icon('chevR', 'chev')}
      </button>
    </div>

    <div class="section-title"><span>Categorie</span><span class="aside">limite al mese</span></div>
    <div class="list">
      ${sortedCats().map((c) => `<button class="row" type="button" data-action="edit-cat" data-id="${c.id}">
        <span class="ico-tile c-${c.color}">${icon(c.icon)}</span>
        <span class="label">${esc(c.name)}</span>
        <span class="value num">${c.limit ? eur0(c.limit) : '—'}</span>${icon('chevR', 'chev')}
      </button>`).join('')}
      <button class="row" type="button" data-action="new-cat" style="color:var(--accent);font-weight:600">
        <span class="ico-tile" style="--c:var(--accent-soft);color:var(--accent)">${icon('plus')}</span><span class="label">Nuova categoria</span>
      </button>
    </div>

    <div class="section-title"><span>Notifiche</span></div>
    <div class="list">
      <label class="row">
        <span class="ico-tile c-rose">${icon('bell')}</span>
        <span class="label">Avvisi sui limiti</span>
        <span class="switch"><input type="checkbox" data-action="toggle-notify" ${S.settings.notify && perm === 'granted' ? 'checked' : ''} ${!notifSupported || perm === 'denied' ? 'disabled' : ''}><i></i></span>
      </label>
      <label class="row">
        <span class="ico-tile c-indigo">${icon('calendar')}</span>
        <span class="label">Promemoria serale</span>
        <input type="time" value="${esc(S.settings.reminderTime)}" data-action="reminder-time" aria-label="Orario promemoria">
      </label>
      <button class="row" type="button" data-action="reminder-ics" style="color:var(--accent);font-weight:600">
        <span class="ico-tile" style="--c:var(--accent-soft);color:var(--accent)">${icon('plus')}</span>
        <span class="label">Aggiungi promemoria al calendario</span>
      </button>
    </div>
    <p class="footnote">${notifNote}</p>
    <p class="footnote">Il promemoria serale è un evento giornaliero nel calendario del telefono: è il modo più affidabile, perché una web app non può inviare notifiche a orario quando è chiusa.</p>

    <div class="section-title"><span>Backup</span></div>
    <div class="list">
      <button class="row" type="button" data-action="export-json">
        <span class="ico-tile c-green">${icon('download')}</span>
        <span class="label">Esporta backup<small>Ultimo: ${last ? shortDate(L.toISO(new Date(last)), true) : 'mai'}</small></span>${icon('chevR', 'chev')}
      </button>
      <button class="row" type="button" data-action="export-csv">
        <span class="ico-tile c-teal">${icon('table')}</span>
        <span class="label">Esporta per Excel (CSV)</span>${icon('chevR', 'chev')}
      </button>
      <button class="row" type="button" data-action="import-json">
        <span class="ico-tile c-sky">${icon('upload')}</span>
        <span class="label">Importa backup</span>${icon('chevR', 'chev')}
      </button>
    </div>
    <p class="footnote">I dati sono salvati solo su questo telefono, non su internet. Esporta un backup ogni tanto e conservalo (per esempio in File o su Drive): serve se cambi telefono o cancelli i dati del browser.</p>

    <div class="section-title"><span>App</span></div>
    <div class="list">
      ${!isStandalone() ? `<button class="row" type="button" data-action="install-help">
        <span class="ico-tile c-violet">${icon('phone')}</span><span class="label">Aggiungi alla schermata Home</span>${icon('chevR', 'chev')}</button>` : ''}
      <div class="row"><span class="ico-tile c-slate">${icon('info')}</span><span class="label">Versione</span><span class="value">${APP_VERSION}</span></div>
      <button class="row danger" type="button" data-action="wipe">
        <span class="ico-tile" style="--c:var(--over)">${icon('trash')}</span><span class="label">Cancella tutti i dati</span>
      </button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
  `;
}

// ---------- entry sheet (add / edit expense, edit recurring rule) ----------

function amountToText(cents) {
  if (!cents) return '';
  const s = (cents / 100).toFixed(2).replace('.', ',');
  return s.replace(/,00$/, '').replace(/(,\d)0$/, '$1');
}

function displayAmount(txt) {
  if (!txt) return '0';
  const [i, d] = txt.split(',');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d !== undefined ? `${grouped},${d}` : grouped;
}

function openEntry({ mode = 'add', expense = null, rule = null, repeat = 'none' } = {}) {
  const src = expense || rule;
  const st = {
    amt: src ? amountToText(src.amount) : '',
    catId: src ? src.categoryId : null,
    note: src ? (src.note || '') : '',
    date: expense ? expense.date : rule ? L.nextDate(rule) : today(),
    repeat: rule ? rule.freq : repeat,
  };
  const t = today();
  const noteIndex = L.buildNoteIndex(S.expenses);
  const title = mode === 'add' ? (repeat !== 'none' ? 'Nuova ricorrente' : 'Nuova spesa') : mode === 'edit' ? 'Modifica spesa' : 'Spesa ricorrente';
  const linkedRule = expense?.recurringId ? S.recurring.find((r) => r.id === expense.recurringId) : null;

  const repeatOptions = (mode === 'rule' ? [] : [['none', 'Non si ripete']])
    .concat([['weekly', 'Ogni settimana'], ['monthly', 'Ogni mese'], ['yearly', 'Ogni anno']]);

  const html = `
    ${sheetHead(title)}
    <div class="sheet-body">
      <div class="amount-display num" id="amt" aria-live="polite"><span class="eur">€</span><span class="val"></span></div>
      <div class="entry-chips">
        <label class="pill" id="date-pill">${icon('calendar')}<span></span>
          <input type="date" id="date-in" value="${st.date}" aria-label="${mode === 'rule' ? 'Prossima data' : 'Data'}"></label>
        ${mode === 'edit' && linkedRule ? '' : `<label class="pill" id="rep-pill">${icon('repeat')}<span></span>
          <select id="rep-in" aria-label="Ripetizione">${repeatOptions.map(([v, l]) => `<option value="${v}" ${v === st.repeat ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
      </div>
      <div class="note-field">${icon('note')}<input id="note-in" type="text" placeholder="Nota (es. Esselunga)" value="${esc(st.note)}" autocomplete="off" enterkeyhint="done" maxlength="80"></div>
      <div class="suggest" id="sug"></div>
      <div class="cat-grid" id="cats">
        ${sortedCats().map((c) => `<button class="cat-pick c-${c.color}" type="button" data-cat="${c.id}">${chipIc(c)}<span>${esc(c.name)}</span></button>`).join('')}
      </div>
      ${linkedRule ? `<div class="recur-note">${icon('repeat')}<span>Fa parte di una spesa ricorrente (${L.FREQ_LABEL[linkedRule.freq].toLowerCase()}). Le modifiche valgono solo per questa volta.</span></div>` : ''}
      <div class="keypad" id="keypad" style="margin-top:8px">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'].map((k) => `<button class="key" type="button" data-key="${k}" aria-label="${k === 'del' ? 'Cancella' : k}">${k === 'del' ? icon('backspace') : k}</button>`).join('')}
      </div>
    </div>
    <div class="sheet-foot">
      ${mode !== 'add' ? `<button class="btn danger" type="button" id="del-btn" aria-label="Elimina">${icon('trash')}</button>` : ''}
      ${mode === 'rule' ? `<button class="btn secondary" type="button" id="pause-btn" style="flex:0 0 auto;padding:0 16px">${icon(rule.active ? 'pause' : 'play')} ${rule.active ? 'Pausa' : 'Riprendi'}</button>` : ''}
      <button class="btn" type="button" id="save-btn">${icon('check')} Salva</button>
    </div>`;

  const { sheet, close } = openSheet(html, { full: false });
  const amtEl = $('#amt', sheet);
  const noteIn = $('#note-in', sheet);
  const sugEl = $('#sug', sheet);
  const saveBtn = $('#save-btn', sheet);

  function paintAmount() {
    $('.val', amtEl).textContent = displayAmount(st.amt);
    amtEl.classList.toggle('empty-amt', !st.amt);
    const fs = st.amt.length > 9 ? 38 : st.amt.length > 7 ? 44 : 52;
    amtEl.style.fontSize = `${fs}px`;
    saveBtn.disabled = !(L.parseAmount(st.amt) > 0 && st.catId);
  }
  function paintCats() {
    $$('.cat-pick', sheet).forEach((b) => b.classList.toggle('sel', b.dataset.cat === st.catId));
    saveBtn.disabled = !(L.parseAmount(st.amt) > 0 && st.catId);
  }
  function paintDate() {
    const label = mode === 'rule' ? `Prossima: ${shortDate(st.date)}` : st.date === t ? 'Oggi' : st.date === L.addDays(t, -1) ? 'Ieri' : shortDate(st.date);
    $('#date-pill span', sheet).textContent = label;
  }
  function paintRepeat() {
    const pill = $('#rep-pill', sheet);
    if (!pill) return;
    $('span', pill).textContent = st.repeat === 'none' ? 'Non si ripete' : L.FREQ_LABEL[st.repeat];
    pill.classList.toggle('on', st.repeat !== 'none');
  }
  function paintSug() {
    const focused = document.activeElement === noteIn;
    const items = focused || st.note ? L.suggestNotes(noteIndex, st.note, 8) : [];
    sugEl.innerHTML = items.map((it, i) => {
      const c = cat(it.categoryId);
      return `<button class="sug c-${c.color}" type="button" data-sug="${i}"><span class="dot">${icon(c.icon)}</span>${esc(it.note)}</button>`;
    }).join('');
    sugEl._items = items;
  }

  function shake() {
    amtEl.classList.remove('shake'); void amtEl.offsetWidth; amtEl.classList.add('shake');
    navigator.vibrate?.(30);
  }

  function pressKey(k) {
    let a = st.amt;
    if (k === 'del') a = a.slice(0, -1);
    else if (k === ',') { if (!a.includes(',')) a = (a || '0') + ','; }
    else {
      const [i, d] = a.split(',');
      if (d !== undefined) { if (d.length < 2) a += k; }
      else if (i === '0') a = k;
      else if (i.length < 6) a += k;
    }
    st.amt = a;
    paintAmount();
  }

  function save() {
    const cents = L.parseAmount(st.amt);
    if (!cents) { shake(); return; }
    if (!st.catId) { $('#cats', sheet).animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], 250); return; }
    const month = L.monthKey(st.date);
    const beforeCat = spend(month, st.catId);
    const beforeTot = spend(month);
    const note = st.note.trim();

    if (mode === 'add') {
      const exp = { id: uid(), amount: cents, categoryId: st.catId, note, date: st.date, createdAt: Date.now() };
      let newRule = null;
      if (st.repeat !== 'none') {
        newRule = { id: uid(), amount: cents, categoryId: st.catId, note, freq: st.repeat, anchorDate: st.date, nextIndex: 1, active: true };
        exp.recurringId = newRule.id;
        S.recurring.push(newRule);
      }
      if (st.date <= t) S.expenses.push(exp);
      else if (newRule) newRule.nextIndex = 0; // future start: first occurrence will be added on its date
      else S.expenses.push(exp);
      runRecurring();
      persist();
      close();
      refresh();
      const where = month !== ui.month ? ` a ${L.monthLabel(month, false)}` : '';
      toast(newRule ? `Ricorrente creata · ${eur(cents)}` : `Spesa aggiunta${where} · ${eur(cents)}`, {
        kind: 'ok', action: 'Annulla',
        onAction: () => {
          S.expenses = S.expenses.filter((e) => e.id !== exp.id && (!newRule || e.recurringId !== newRule.id));
          if (newRule) S.recurring = S.recurring.filter((r) => r.id !== newRule.id);
          persist(); refresh();
        },
      });
      checkLimits(month, st.catId, beforeCat, beforeTot);
      return;
    }

    if (mode === 'edit') {
      const oldMonth = L.monthKey(expense.date);
      Object.assign(expense, { amount: cents, categoryId: st.catId, note, date: st.date });
      if (!linkedRule && st.repeat !== 'none') {
        const r = { id: uid(), amount: cents, categoryId: st.catId, note, freq: st.repeat, anchorDate: st.date, nextIndex: 1, active: true };
        expense.recurringId = r.id;
        S.recurring.push(r);
        runRecurring();
      }
      persist(); close(); refresh();
      toast('Modifiche salvate', { kind: 'ok' });
      if (oldMonth === month) {
        // before-values must exclude this expense's old amount only when compared in the same month
        checkLimits(month, st.catId, beforeCat, beforeTot);
      }
      return;
    }

    // mode === 'rule'
    const reanchor = st.date !== L.nextDate(rule) || st.repeat !== rule.freq;
    Object.assign(rule, { amount: cents, categoryId: st.catId, note, freq: st.repeat });
    if (reanchor) { rule.anchorDate = st.date; rule.nextIndex = 0; }
    runRecurring();
    persist(); close(); refresh();
    toast('Ricorrente aggiornata', { kind: 'ok' });
  }

  // events
  sheet.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (key) { pressKey(key.dataset.key); return; }
    const c = e.target.closest('[data-cat]');
    if (c) {
      st.catId = c.dataset.cat;
      paintCats();
      if (mode === 'add') {
        if (L.parseAmount(st.amt) > 0) save();
        else { shake(); toast('Prima scrivi l\'importo, poi tocca la categoria', { ms: 2500 }); }
      }
      return;
    }
    const s = e.target.closest('[data-sug]');
    if (s) {
      const it = sugEl._items[Number(s.dataset.sug)];
      st.note = it.note; noteIn.value = it.note;
      st.catId = it.categoryId; paintCats();
      noteIn.blur();
      sugEl.innerHTML = '';
      return;
    }
  });
  $('#save-btn', sheet).addEventListener('click', save);
  noteIn.addEventListener('input', () => { st.note = noteIn.value; paintSug(); });
  noteIn.addEventListener('focus', paintSug);
  noteIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== noteIn) sugEl.innerHTML = ''; }, 150));
  noteIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); noteIn.blur(); } });
  $('#date-in', sheet).addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; paintDate(); } });
  $('#rep-in', sheet)?.addEventListener('change', (e) => { st.repeat = e.target.value; paintRepeat(); });

  sheet.addEventListener('keydown', (e) => {
    if (e.target === noteIn || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (/^\d$/.test(e.key)) { pressKey(e.key); e.preventDefault(); }
    else if (e.key === ',' || e.key === '.') { pressKey(','); e.preventDefault(); }
    else if (e.key === 'Backspace') { pressKey('del'); e.preventDefault(); }
    else if (e.key === 'Enter') { save(); e.preventDefault(); }
  });

  $('#del-btn', sheet)?.addEventListener('click', () => {
    if (mode === 'edit') {
      const removed = expense;
      S.expenses = S.expenses.filter((x) => x.id !== removed.id);
      persist(); close(); refresh();
      toast('Spesa eliminata', { action: 'Annulla', onAction: () => { S.expenses.push(removed); persist(); refresh(); } });
    } else if (mode === 'rule') {
      if (!confirm('Eliminare questa spesa ricorrente? Le spese già registrate restano.')) return;
      S.recurring = S.recurring.filter((r) => r.id !== rule.id);
      S.expenses.forEach((x) => { if (x.recurringId === rule.id) delete x.recurringId; });
      persist(); close(); refresh();
      toast('Ricorrente eliminata');
    }
  });
  $('#pause-btn', sheet)?.addEventListener('click', () => {
    if (rule.active) {
      rule.active = false;
      toast('Ricorrente in pausa');
    } else {
      rule.active = true;
      // skip occurrences missed while paused
      while (L.nextDate(rule) < t) rule.nextIndex += 1;
      runRecurring();
      toast('Ricorrente ripresa');
    }
    persist(); close(); refresh();
  });

  paintAmount(); paintCats(); paintDate(); paintRepeat();
  sheet.tabIndex = -1;
  if (!coarse()) sheet.focus();
}

// ---------- category detail (from month view) ----------

function openCategoryDetail(id) {
  const key = ui.month;
  const build = () => {
    const c = cat(id);
    const [from, to] = L.monthRange(key);
    const items = S.expenses.filter((e) => e.categoryId === id && e.date >= from && e.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const v = items.reduce((s, e) => s + e.amount, 0);
    const lvl = L.limitLevel(v, c.limit);
    return `
      ${sheetHead(`<span style="display:flex;align-items:center;gap:10px">${chipIc(c, 'sm')}${esc(c.name)}</span>`, `<button class="icon-btn" type="button" data-action="edit-cat" data-id="${c.id}" aria-label="Modifica categoria">${icon('note')}</button>`)}
      <div class="sheet-body">
        <div class="muted" style="font-size:14px">${L.monthLabel(key)}</div>
        <div class="num" style="font-size:36px;font-weight:750">${eur(v)}</div>
        ${c.limit ? `<div style="margin-top:10px">${bar((v / c.limit) * 100, lvl === 'ok' ? '' : lvl, c.color)}</div>
          <div class="cat-meta num" style="margin-left:0"><span class="${lvl === 'warn' ? 'lvl-warn' : lvl === 'over' ? 'lvl-over' : ''}">${Math.round((v / c.limit) * 100)}% del limite</span><span>${v <= c.limit ? `${eur0(c.limit - v)} rimasti` : `superato di ${eur0(v - c.limit)}`}</span></div>` : ''}
        <div class="list" style="margin-top:16px">
          <label class="row"><span class="label">Limite mensile</span>
            <input type="text" inputmode="decimal" placeholder="Nessuno" value="${c.limit ? amountToText(c.limit) : ''}" data-limit-for="${c.id}" aria-label="Limite mensile in euro"></label>
        </div>
        <div class="section-title"><span>Spese</span><span class="aside">${items.length}</span></div>
        ${items.length ? `<div class="list">${items.map((e) => expRow(e, { withDate: true })).join('')}</div>` : '<p class="muted" style="margin:0 4px">Nessuna spesa in questo mese.</p>'}
      </div>`;
  };
  const { sheet } = openSheet(build(), { refresh: () => rebuild() });
  function rebuild() {
    sheet.innerHTML = build();
    enableSwipeClose(sheet, sheetStack[sheetStack.length - 1]);
    fillBars(sheet, true);
  }
  fillBars(sheet);
  sheet.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-limit-for]');
    if (!inp) return;
    setCategoryLimit(id, inp.value);
  });
}

function setCategoryLimit(id, text) {
  const c = cat(id);
  const v = text.trim() ? L.parseAmount(text) : null;
  if (text.trim() && !v) { toast('Importo non valido', { kind: 'warn' }); return; }
  c.limit = v;
  persist(); refresh();
  toast(v ? `Limite ${c.name}: ${eur0(v)} al mese` : `Limite ${c.name} rimosso`, { kind: 'ok' });
}

// ---------- category editor ----------

function openCategoryEditor(id = null) {
  const existing = id ? cat(id) : null;
  const st = existing ? { ...existing } : { name: '', icon: 'tag', color: CATEGORY_COLORS[S.categories.length % CATEGORY_COLORS.length], limit: null };
  const html = `
    ${sheetHead(existing ? 'Modifica categoria' : 'Nuova categoria')}
    <div class="sheet-body">
      <div style="display:flex;justify-content:center;margin:6px 0 14px"><span id="preview"></span></div>
      <div class="list">
        <label class="row"><span class="label">Nome</span><input type="text" id="cat-name" value="${esc(st.name)}" placeholder="Es. Animali" maxlength="24" autocomplete="off"></label>
        <label class="row"><span class="label">Limite mensile</span><input type="text" id="cat-limit" inputmode="decimal" placeholder="Nessuno" value="${st.limit ? amountToText(st.limit) : ''}"></label>
      </div>
      <div class="field-label">Icona</div>
      <div class="list"><div class="picker" id="icons">${CATEGORY_ICONS.map((n) => `<button type="button" data-icon="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div></div>
      <div class="field-label">Colore</div>
      <div class="list"><div class="picker" id="colors">${CATEGORY_COLORS.map((n) => `<button type="button" class="swatch c-${n}" data-color="${n}" aria-label="${n}"></button>`).join('')}</div></div>
    </div>
    <div class="sheet-foot">
      ${existing && existing.id !== 'altro' ? `<button class="btn danger" type="button" id="cat-del" aria-label="Elimina categoria">${icon('trash')}</button>` : ''}
      <button class="btn" type="button" id="cat-save">${icon('check')} Salva</button>
    </div>`;
  const { sheet, close } = openSheet(html);
  const paint = () => {
    $('#preview', sheet).innerHTML = `<span class="chip-ic c-${st.color}" style="width:64px;height:64px;border-radius:20px">${icon(st.icon)}</span>`;
    $$('[data-icon]', sheet).forEach((b) => b.classList.toggle('sel', b.dataset.icon === st.icon));
    $$('[data-color]', sheet).forEach((b) => b.classList.toggle('sel', b.dataset.color === st.color));
  };
  sheet.addEventListener('click', (e) => {
    const i = e.target.closest('[data-icon]'); if (i) { st.icon = i.dataset.icon; paint(); }
    const c = e.target.closest('[data-color]'); if (c) { st.color = c.dataset.color; paint(); }
  });
  $('#cat-save', sheet).addEventListener('click', () => {
    const name = $('#cat-name', sheet).value.trim();
    if (!name) { $('#cat-name', sheet).focus(); toast('Dai un nome alla categoria', { kind: 'warn' }); return; }
    const lt = $('#cat-limit', sheet).value.trim();
    const limit = lt ? L.parseAmount(lt) : null;
    if (lt && !limit) { toast('Limite non valido', { kind: 'warn' }); return; }
    if (existing) Object.assign(existing, { name, icon: st.icon, color: st.color, limit });
    else S.categories.push({ id: uid(), name, icon: st.icon, color: st.color, limit, order: Math.max(0, ...S.categories.map((x) => x.order)) + 1 });
    persist(); close(); refresh();
    toast(existing ? 'Categoria aggiornata' : 'Categoria creata', { kind: 'ok' });
  });
  $('#cat-del', sheet)?.addEventListener('click', () => {
    const n = S.expenses.filter((e) => e.categoryId === existing.id).length;
    const msg = n ? `Eliminare "${existing.name}"? Le sue ${n} spese passeranno in "Altro".` : `Eliminare "${existing.name}"?`;
    if (!confirm(msg)) return;
    S.expenses.forEach((e) => { if (e.categoryId === existing.id) e.categoryId = 'altro'; });
    S.recurring.forEach((r) => { if (r.categoryId === existing.id) r.categoryId = 'altro'; });
    S.categories = S.categories.filter((c) => c.id !== existing.id);
    if (ui.trendCat === existing.id) ui.trendCat = null;
    persist();
    sheetStack.slice().reverse().forEach((fn) => fn());
    refresh();
    toast('Categoria eliminata');
  });
  paint();
}

function openTotalLimit() {
  const html = `
    ${sheetHead('Limite totale mensile')}
    <div class="sheet-body">
      <div class="list"><label class="row"><span class="label">Limite</span>
        <input type="text" id="tl" inputmode="decimal" placeholder="Nessuno" value="${S.settings.totalLimit ? amountToText(S.settings.totalLimit) : ''}"></label></div>
      <p class="footnote">Quanto vuoi spendere al massimo in un mese, in tutto. Lascia vuoto per non avere un limite.</p>
    </div>
    <div class="sheet-foot"><button class="btn" type="button" id="tl-save">${icon('check')} Salva</button></div>`;
  const { sheet, close } = openSheet(html);
  const inp = $('#tl', sheet);
  setTimeout(() => inp.focus(), 350);
  const save = () => {
    const txt = inp.value.trim();
    const v = txt ? L.parseAmount(txt) : null;
    if (txt && !v) { toast('Importo non valido', { kind: 'warn' }); return; }
    S.settings.totalLimit = v; persist(); close(); refresh();
    toast(v ? `Limite totale: ${eur0(v)} al mese` : 'Limite totale rimosso', { kind: 'ok' });
  };
  $('#tl-save', sheet).addEventListener('click', save);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// ---------- search ----------

function openSearch() {
  const f = { text: '', categoryId: '', from: '', to: '', min: '', max: '' };
  const html = `
    ${sheetHead('Cerca')}
    <div class="sheet-body">
      <div class="search-field">${icon('search')}<input id="q" type="search" placeholder="Cerca nelle note" autocomplete="off" enterkeyhint="search"></div>
      <div class="filters">
        <label class="filter" style="grid-column:1/-1"><span>Categoria</span>
          <select id="f-cat"><option value="">Tutte</option>${sortedCats().map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="filter"><span>Dal</span><input type="date" id="f-from"></label>
        <label class="filter"><span>Al</span><input type="date" id="f-to"></label>
        <label class="filter"><span>Importo min</span><input type="text" inputmode="decimal" id="f-min" placeholder="€"></label>
        <label class="filter"><span>Importo max</span><input type="text" inputmode="decimal" id="f-max" placeholder="€"></label>
      </div>
      <div id="results"></div>
    </div>`;
  const { sheet } = openSheet(html, { full: true, refresh: () => run() });
  function run() {
    const active = f.text || f.categoryId || f.from || f.to || f.min || f.max;
    const res = $('#results', sheet);
    if (!active) { res.innerHTML = '<p class="muted" style="text-align:center;margin-top:32px">Scrivi qualcosa o scegli un filtro.</p>'; return; }
    const list = L.searchExpenses(S.expenses, {
      text: f.text, categoryId: f.categoryId || null, from: f.from || null, to: f.to || null,
      min: f.min ? L.parseAmount(f.min) : null, max: f.max ? L.parseAmount(f.max) : null,
    });
    const tot = list.reduce((s, e) => s + e.amount, 0);
    const shown = list.slice(0, 300);
    res.innerHTML = `<div class="result-total"><span class="muted">${list.length} ${list.length === 1 ? 'spesa' : 'spese'}</span><b class="num">${eur(tot)}</b></div>
      ${shown.length ? `<div class="list">${shown.map((e) => expRow(e, { withDate: true })).join('')}</div>` : '<p class="muted" style="text-align:center">Nessun risultato.</p>'}
      ${list.length > shown.length ? `<p class="footnote">Mostrate le prime ${shown.length}. Restringi i filtri per vedere le altre.</p>` : ''}`;
  }
  const bind = (sel, k) => $(sel, sheet).addEventListener('input', (e) => { f[k] = e.target.value.trim(); run(); });
  bind('#q', 'text'); bind('#f-from', 'from'); bind('#f-to', 'to'); bind('#f-min', 'min'); bind('#f-max', 'max');
  $('#f-cat', sheet).addEventListener('change', (e) => { f.categoryId = e.target.value; run(); });
  run();
  if (!coarse()) setTimeout(() => $('#q', sheet).focus(), 350);
}

// ---------- install help ----------

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('App installata. Aprila dalla schermata Home.', { kind: 'ok' }); });

function openInstallHelp() {
  const ios = isIOS();
  const html = `
    ${sheetHead('Aggiungi alla schermata Home')}
    <div class="sheet-body">
      ${ios ? `<p>Su iPhone, in <b>Safari</b>:</p>
        <ol class="steps"><li>Tocca il pulsante <b>Condividi</b> (il quadrato con la freccia in su).</li>
        <li>Scorri e scegli <b>Aggiungi alla schermata Home</b>.</li><li>Tocca <b>Aggiungi</b>.</li></ol>`
      : `<p>Su Android, in <b>Chrome</b>:</p>
        <ol class="steps"><li>Tocca il menu <b>⋮</b> in alto a destra.</li><li>Scegli <b>Installa app</b> (o <b>Aggiungi a schermata Home</b>).</li></ol>
        ${deferredPrompt ? `<button class="btn block" type="button" id="do-install">${icon('download')} Installa ora</button>` : ''}`}
      <div class="banner" style="margin-top:16px">${icon('info')}<div class="banner-body">Da quel momento apri Spese sempre dall'icona sulla Home: i dati salvati nel browser e quelli dell'app installata sono separati. Se hai già segnato spese qui nel browser, esporta un backup e importalo nell'app.</div></div>
    </div>`;
  const { sheet, close } = openSheet(html);
  $('#do-install', sheet)?.addEventListener('click', async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null; close();
  });
}

// ---------- files ----------

async function deliverFile(filename, mime, content, { preferShare = true } = {}) {
  const blob = new Blob([content], { type: mime });
  if (preferShare && coarse() && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportJSON() {
  const data = { app: 'spese', version: S.version, exportedAt: new Date().toISOString(), expenses: S.expenses, categories: S.categories, recurring: S.recurring, settings: { ...S.settings } };
  const ok = await deliverFile(`spese-backup-${today()}.json`, 'application/json', JSON.stringify(data, null, 1));
  if (ok) { S.settings.lastBackup = Date.now(); persist(); refresh(); toast('Backup esportato', { kind: 'ok' }); }
}

async function exportCSV() {
  if (!S.expenses.length) { toast('Non ci sono ancora spese da esportare'); return; }
  await deliverFile(`spese-${today()}.csv`, 'text/csv;charset=utf-8', L.toCSV(S.expenses, S.categories));
}

async function importJSON(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Il file non è leggibile', { kind: 'over' }); return; }
  const err = L.validateBackup(data);
  if (err) { toast(err, { kind: 'over' }); return; }
  if (!confirm(`Sostituire i dati attuali (${S.expenses.length} spese) con quelli del backup (${data.expenses.length} spese)?`)) return;
  const base = emptyState();
  S = {
    ...base,
    expenses: data.expenses,
    categories: data.categories.length ? data.categories : base.categories,
    recurring: data.recurring,
    settings: { ...base.settings, ...(data.settings || {}), lastBackup: Date.now() },
  };
  if (!S.categories.some((c) => c.id === 'altro')) S.categories.push({ id: 'altro', name: 'Altro', icon: 'dots', color: 'slate', limit: null, order: 999 });
  runRecurring();
  persist(); refresh();
  toast(`Backup importato: ${S.expenses.length} spese`, { kind: 'ok' });
}

// ---------- global events ----------

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    if (ui.tab !== tab.dataset.tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'add': openEntry(); break;
    case 'add-rule': openEntry({ repeat: 'monthly' }); break;
    case 'month-prev': ui.month = L.shiftMonth(ui.month, -1); render(); break;
    case 'month-next': ui.month = L.shiftMonth(ui.month, 1); render(); break;
    case 'month-today': ui.month = L.monthKey(today()); render(); break;
    case 'search': openSearch(); break;
    case 'cat-detail': openCategoryDetail(el.dataset.id); break;
    case 'edit-exp': { const x = S.expenses.find((q) => q.id === el.dataset.id); if (x) openEntry({ mode: 'edit', expense: x }); break; }
    case 'edit-rule': { const r = S.recurring.find((q) => q.id === el.dataset.id); if (r) openEntry({ mode: 'rule', rule: r }); break; }
    case 'trend-range': ui.trendRange = Number(el.dataset.n); ui.trendSel = null; render(false); break;
    case 'trend-cat': ui.trendCat = el.dataset.id || null; render(false); if (el.classList.contains('cat-row')) window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'trend-sel': ui.trendSel = el.dataset.key; render(false); break;
    case 'open-month': ui.month = el.dataset.key; ui.tab = 'month'; render(); window.scrollTo(0, 0); break;
    case 'edit-total-limit': openTotalLimit(); break;
    case 'edit-cat': openCategoryEditor(el.dataset.id); break;
    case 'new-cat': openCategoryEditor(); break;
    case 'export-json': exportJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'import-json': $('#import-file')?.click(); break;
    case 'reminder-ics':
      deliverFile('promemoria-spese.ics', 'text/calendar;charset=utf-8', L.reminderICS(S.settings.reminderTime, today()), { preferShare: false })
        .then(() => toast(`Apri il file per aggiungere il promemoria delle ${S.settings.reminderTime} al calendario`, { ms: 5000 }));
      break;
    case 'install-help': openInstallHelp(); break;
    case 'hide-install': ui.installHidden = true; render(false); break;
    case 'wipe':
      if (confirm('Cancellare tutte le spese, le ricorrenti e le categorie? Non si può annullare.') && confirm('Sei sicuro? Ti consiglio di esportare prima un backup.')) {
        S = emptyState(); persist(); refresh(); toast('Dati cancellati');
      }
      break;
    default: break;
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'import-file' && t.files?.[0]) { await importJSON(t.files[0]); t.value = ''; return; }
  if (t.dataset?.action === 'reminder-time' && t.value) { S.settings.reminderTime = t.value; persist(); return; }
  if (t.dataset?.action === 'toggle-notify') {
    if (t.checked) {
      const p = await Notification.requestPermission();
      if (p === 'granted') {
        S.settings.notify = true; persist();
        notify('Avvisi attivi', 'Ti avviserò quando ti avvicini a un limite di spesa.');
      } else {
        t.checked = false; S.settings.notify = false; persist();
        toast('Permesso negato: vedrai gli avvisi solo dentro l\'app', { kind: 'warn' });
      }
      render(false);
    } else { S.settings.notify = false; persist(); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S) return;
  const created = runRecurring();
  if (created.length) refresh();
});

// ---------- service worker ----------

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('È disponibile una nuova versione', { action: 'Aggiorna', ms: 12000, onAction: () => nw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch(() => {});
  // Reload only when an update replaces an existing worker, not on the very first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}

// ---------- boot ----------

async function boot() {
  S = await loadState();
  ui.month = L.monthKey(today());
  runRecurring();
  render();
  registerSW();
  requestPersistence();
}

boot();
