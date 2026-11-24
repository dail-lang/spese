// Pure logic: no DOM, no storage. Amounts are integer cents, dates are local 'YYYY-MM-DD'.

export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export const WARN_RATIO = 0.8;

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d }; // m is 1-12
}

export function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

export function monthKey(dateISO) {
  return dateISO.slice(0, 7);
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthLabel(key, withYear = true) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  return withYear ? `${name[0].toUpperCase()}${name.slice(1)} ${y}` : name;
}

// Adds months keeping the target day, clamped to the month length (31 -> 30/28/29).
export function addMonthsClamped(dateISO, months, day) {
  const { y, m } = parseISO(dateISO);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const nd = Math.min(day, daysInMonth(ny, nm));
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

export function addDays(dateISO, days) {
  const { y, m, d } = parseISO(dateISO);
  return toISO(new Date(y, m - 1, d + days));
}

export function dayLabel(dateISO, todayISO) {
  if (dateISO === todayISO) return 'Oggi';
  if (dateISO === addDays(todayISO, -1)) return 'Ieri';
  const { y, m, d } = parseISO(dateISO);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${d} ${MONTHS[m - 1]}`;
}

// ---------- money ----------

const fmt = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const fmt0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });

export function formatEuro(cents, { decimals = true } = {}) {
  const v = cents / 100;
  return `€ ${decimals ? fmt.format(v) : fmt0.format(Math.round(v))}`;
}

// "12,5" / "12.50" / "1.234,56" -> cents. Returns null if invalid.
export function parseAmount(text) {
  if (text == null) return null;
  let s = String(text).trim().replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

// ---------- recurring ----------

// Date of the k-th occurrence (k = 0 is the anchor itself).
export function occurrenceDate(rule, k) {
  const anchorDay = parseISO(rule.anchorDate).d;
  switch (rule.freq) {
    case 'weekly': return addDays(rule.anchorDate, 7 * k);
    case 'monthly': return addMonthsClamped(rule.anchorDate, k, anchorDay);
    case 'yearly': return addMonthsClamped(rule.anchorDate, 12 * k, anchorDay);
    default: throw new Error(`frequenza sconosciuta: ${rule.freq}`);
  }
}

// Creates every occurrence due up to `todayISO`. Mutates rules' nextIndex, returns new expenses.
export function materializeRecurring(rules, todayISO, makeId) {
  const created = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let guard = 0;
    while (guard++ < 1000) {
      const date = occurrenceDate(rule, rule.nextIndex);
      if (date > todayISO) break;
      created.push({
        id: makeId(), amount: rule.amount, categoryId: rule.categoryId, note: rule.note,
        date, recurringId: rule.id, createdAt: Date.now(),
      });
      rule.nextIndex += 1;
    }
  }
  return created;
}

export function nextDate(rule) {
  return occurrenceDate(rule, rule.nextIndex);
}

// Occurrences after today but within today's month (still to be paid this month).
export function upcomingThisMonth(rules, todayISO) {
  const mk = monthKey(todayISO);
  const items = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    for (let k = rule.nextIndex; k < rule.nextIndex + 40; k++) {
      const date = occurrenceDate(rule, k);
      if (monthKey(date) !== mk) break;
      if (date > todayISO) items.push({ rule, date });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export const FREQ_LABEL = { weekly: 'Ogni settimana', monthly: 'Ogni mese', yearly: 'Ogni anno' };

// ---------- aggregation ----------

export function expensesInRange(expenses, fromISO, toISO) {
  return expenses.filter((e) => e.date >= fromISO && e.date <= toISO);
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return [`${key}-01`, `${key}-${pad(daysInMonth(y, m))}`];
}

export function sumBy(expenses) {
  const by = {};
  let total = 0;
  for (const e of expenses) {
    by[e.categoryId] = (by[e.categoryId] || 0) + e.amount;
    total += e.amount;
  }
  return { total, by };
}

// Range used to compare against the previous month.
// For the current month: same day span of the previous month (1..today's day, clamped).
// For past months: the whole previous month.
export function comparisonRanges(key, todayISO) {
  const prev = shiftMonth(key, -1);
  const isCurrent = monthKey(todayISO) === key;
  if (!isCurrent) {
    return { current: monthRange(key), previous: monthRange(prev), partial: false, prevKey: prev };
  }
  const day = parseISO(todayISO).d;
  const [py, pm] = prev.split('-').map(Number);
  const pd = Math.min(day, daysInMonth(py, pm));
  return {
    current: [`${key}-01`, todayISO],
    previous: [`${prev}-01`, `${prev}-${pad(pd)}`],
    partial: true,
    prevKey: prev,
  };
}

export function monthSummary(expenses, key, todayISO) {
  const [from, to] = monthRange(key);
  const month = sumBy(expensesInRange(expenses, from, to));
  const cr = comparisonRanges(key, todayISO);
  const cur = sumBy(expensesInRange(expenses, cr.current[0], cr.current[1]));
  const prev = sumBy(expensesInRange(expenses, cr.previous[0], cr.previous[1]));
  return { ...month, compare: { cur, prev, partial: cr.partial, prevKey: cr.prevKey } };
}

export function monthlyTotals(expenses, endKey, count, categoryId = null) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const key = shiftMonth(endKey, -i);
    const [from, to] = monthRange(key);
    let list = expensesInRange(expenses, from, to);
    if (categoryId) list = list.filter((e) => e.categoryId === categoryId);
    out.push({ key, total: list.reduce((s, e) => s + e.amount, 0) });
  }
  return out;
}

// ---------- limits ----------

export function limitLevel(spent, limit) {
  if (!limit) return 'none';
  if (spent > limit) return 'over';
  if (spent >= limit * WARN_RATIO) return 'warn';
  return 'ok';
}

const LEVEL_RANK = { none: 0, ok: 0, warn: 1, over: 2 };

// Returns the level reached if adding moved spending into a higher level, else null.
export function crossedLevel(before, after, limit) {
  const a = limitLevel(before, limit);
  const b = limitLevel(after, limit);
  return LEVEL_RANK[b] > LEVEL_RANK[a] ? b : null;
}

// ---------- search ----------

export function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function searchExpenses(expenses, f) {
  const q = normalize(f.text);
  return expenses.filter((e) => {
    if (q && !normalize(e.note).includes(q)) return false;
    if (f.categoryId && e.categoryId !== f.categoryId) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.min != null && e.amount < f.min) return false;
    if (f.max != null && e.amount > f.max) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

// ---------- suggestions ----------

export function buildNoteIndex(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const k = normalize(e.note);
    if (!k) continue;
    const cur = map.get(k);
    if (!cur) {
      map.set(k, { note: e.note.trim(), count: 1, lastDate: e.date, lastAt: e.createdAt, categoryId: e.categoryId });
    } else {
      cur.count += 1;
      if (e.date > cur.lastDate || (e.date === cur.lastDate && e.createdAt > cur.lastAt)) {
        cur.lastDate = e.date; cur.lastAt = e.createdAt; cur.categoryId = e.categoryId; cur.note = e.note.trim();
      }
    }
  }
  return [...map.values()];
}

export function suggestNotes(index, text, limit = 5) {
  const q = normalize(text);
  const scored = index
    .map((it) => {
      const n = normalize(it.note);
      if (q && n === q) return null;
      let rank;
      if (!q) rank = 2;
      else if (n.startsWith(q)) rank = 0;
      else if (n.split(/\s+/).some((w) => w.startsWith(q))) rank = 1;
      else return null;
      return { it, rank };
    })
    .filter(Boolean);
  scored.sort((a, b) => a.rank - b.rank || b.it.count - a.it.count || b.it.lastDate.localeCompare(a.it.lastDate));
  return scored.slice(0, limit).map((s) => s.it);
}

// ---------- export ----------

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Semicolon-separated with comma decimals: opens correctly in Italian Excel.
export function toCSV(expenses, categories) {
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const rows = [['Data', 'Importo', 'Categoria', 'Nota', 'Ricorrente']];
  const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    rows.push([e.date, (e.amount / 100).toFixed(2).replace('.', ','), names[e.categoryId] || '', e.note || '',
      e.recurringId ? 'sì' : '']);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function reminderICS(timeHHMM, todayISO) {
  const [hh, mm] = timeHHMM.split(':');
  const d = todayISO.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spese//Promemoria//IT', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:spese-promemoria-${d}${hh}${mm}@spese.app`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${hh}${mm}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:Segna le spese di oggi',
    'DESCRIPTION:Apri Spese dalla schermata Home e segna le spese di oggi.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Segna le spese di oggi', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ---------- backup validation ----------

export function validateBackup(data) {
  if (!data || typeof data !== 'object') return 'File non valido.';
  if (data.app !== 'spese') return 'Questo file non è un backup di Spese.';
  for (const k of ['expenses', 'categories', 'recurring']) {
    if (!Array.isArray(data[k])) return `Backup incompleto: manca "${k}".`;
  }
  const ok = data.expenses.every((e) => e && typeof e.id === 'string' && Number.isInteger(e.amount)
    && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.categoryId === 'string');
  if (!ok) return 'Il backup contiene spese non valide.';
  return null;
}
