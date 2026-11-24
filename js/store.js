// Persistence: the whole state lives in one IndexedDB record (falls back to localStorage).

const DB_NAME = 'spese';
const STORE = 'kv';
const KEY = 'state';

export const DEFAULT_CATEGORIES = [
  { id: 'spesa', name: 'Spesa', icon: 'cart', color: 'green' },
  { id: 'casa', name: 'Casa', icon: 'home', color: 'indigo' },
  { id: 'bollette', name: 'Bollette', icon: 'bolt', color: 'amber' },
  { id: 'trasporti', name: 'Trasporti', icon: 'car', color: 'sky' },
  { id: 'fuori', name: 'Fuori', icon: 'utensils', color: 'orange' },
  { id: 'svago', name: 'Svago', icon: 'sparkle', color: 'violet' },
  { id: 'salute', name: 'Salute', icon: 'heart', color: 'rose' },
  { id: 'abbigliamento', name: 'Abbigliamento', icon: 'shirt', color: 'teal' },
  { id: 'altro', name: 'Altro', icon: 'dots', color: 'slate' },
].map((c, i) => ({ ...c, limit: null, order: i }));

export function emptyState() {
  return {
    version: 1,
    expenses: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    recurring: [],
    settings: { totalLimit: null, reminderTime: '21:00', lastBackup: null },
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = typeof indexedDB === 'undefined' ? Promise.reject(new Error('no idb')) : openDB();
  return dbPromise;
}

export async function loadState() {
  let raw = null;
  try {
    const d = await db();
    raw = await new Promise((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try { raw = JSON.parse(localStorage.getItem(DB_NAME) || 'null'); } catch { raw = null; }
  }
  if (!raw) return emptyState();
  const base = emptyState();
  return { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
}

export async function saveState(state) {
  const plain = JSON.parse(JSON.stringify(state));
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(plain, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.setItem(DB_NAME, JSON.stringify(plain));
  }
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

export function uid() {
  return (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
}
