// Lapisan database IndexedDB untuk CT Catering POS.
// Aturan: skema HANYA boleh berubah lewat migrasi baru di MIGRATIONS
// (naikkan DB_VERSION). Jangan pernah mengubah migrasi yang sudah dirilis.

export const DB_NAME = 'ct-catering-pos';
export const DB_VERSION = 1;

export const STORES = [
  'products',
  'categories',
  'transactions',
  'transactionItems',
  'orders',
  'stockMovements',
  'settings',
];

// Setiap entri dijalankan berurutan saat database perlu di-upgrade.
// Parameter: (db, tx) — tx adalah transaksi versionchange.
const MIGRATIONS = {
  1(db) {
    const products = db.createObjectStore('products', { keyPath: 'id' });
    products.createIndex('categoryId', 'categoryId');
    products.createIndex('name', 'name');

    db.createObjectStore('categories', { keyPath: 'id' });

    const trx = db.createObjectStore('transactions', { keyPath: 'id' });
    trx.createIndex('createdAt', 'createdAt');
    trx.createIndex('number', 'number', { unique: true });
    trx.createIndex('status', 'status');

    // Detail transaksi menyimpan SNAPSHOT nama, harga jual, harga modal & jumlah,
    // sehingga laporan lama tidak berubah saat produk diedit/dihapus.
    const items = db.createObjectStore('transactionItems', { keyPath: 'id' });
    items.createIndex('transactionId', 'transactionId');
    items.createIndex('productId', 'productId');

    const orders = db.createObjectStore('orders', { keyPath: 'id' });
    orders.createIndex('transactionId', 'transactionId');
    orders.createIndex('status', 'status');
    orders.createIndex('createdAt', 'createdAt');

    const moves = db.createObjectStore('stockMovements', { keyPath: 'id' });
    moves.createIndex('productId', 'productId');
    moves.createIndex('createdAt', 'createdAt');

    db.createObjectStore('settings', { keyPath: 'key' });
  },
};

let dbPromise = null;
const listeners = new Set();

/** Daftarkan callback saat database ditutup karena versi baru dibuka di tab lain. */
export function onBlocked(fn) { listeners.add(fn); }

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('Browser ini tidak mendukung IndexedDB.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      const from = event.oldVersion;
      for (let v = from + 1; v <= DB_VERSION; v++) {
        const migrate = MIGRATIONS[v];
        if (!migrate) throw new Error(`Migrasi versi ${v} tidak ditemukan`);
        migrate(db, tx);
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Tab lain membuka versi lebih baru: tutup koneksi agar upgrade tidak macet.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        listeners.forEach((fn) => fn());
      };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => listeners.forEach((fn) => fn());
  });
  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Jalankan beberapa operasi dalam SATU transaksi atomik.
 * Jika ada yang gagal, semua dibatalkan (tidak ada data setengah tersimpan).
 *   await withTx(['transactions','transactionItems'], 'readwrite', (s) => { s.transactions.put(...); ... })
 */
export async function withTx(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = {};
    for (const name of storeNames) stores[name] = tx.objectStore(name);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaksi database dibatalkan'));
    try {
      result = work(stores, tx);
    } catch (err) {
      try { tx.abort(); } catch (_) { /* sudah selesai */ }
      reject(err);
    }
  });
}

export async function getAll(store) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).get(key));
}

export async function count(store) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).count());
}

export function put(store, value) {
  return withTx([store], 'readwrite', (s) => { s[store].put(value); });
}

export function remove(store, key) {
  return withTx([store], 'readwrite', (s) => { s[store].delete(key); });
}

// ---------- Pengaturan (key/value) ----------
export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  return put('settings', { key, value, updatedAt: new Date().toISOString() });
}

// ---------- Util ----------
export function uid() {
  if (self.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Cadangan untuk iPadOS lama
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
