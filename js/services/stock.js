// Stok masuk, keluar, penyesuaian + riwayat pergerakan stok + kategori.
// Setiap perubahan stok selalu tercatat di stockMovements dalam transaksi yang sama.
import { withTx, getAll, uid } from '../db.js';

export const MOVE_LABELS = {
  initial: 'Stok awal',
  in: 'Stok masuk',
  out: 'Stok keluar',
  adjust: 'Penyesuaian',
  sale: 'Penjualan',
  cancel: 'Pembatalan pesanan',
};

/**
 * @param {string} productId
 * @param {'in'|'out'|'adjust'} type
 * @param {number} qty  in/out: jumlah (>0). adjust: jumlah stok fisik sebenarnya (>=0).
 * @param {string} note
 */
export function recordStock(productId, type, qty, note = '') {
  if (!['in', 'out', 'adjust'].includes(type)) return Promise.reject(new Error('Jenis stok tidak dikenal.'));
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > 1e9) return Promise.reject(new Error('Jumlah harus angka bulat.'));
  if (type !== 'adjust' && n === 0) return Promise.reject(new Error('Jumlah harus lebih dari 0.'));
  const cleanNote = String(note || '').trim().slice(0, 120);
  const now = new Date().toISOString();

  return withTx(['products', 'stockMovements'], 'readwrite', (s, ctx) => {
    s.products.get(productId).onsuccess = (e) => {
      const p = e.target.result;
      if (!p || p.deleted) { ctx.fail(new Error('Produk tidak ditemukan.')); return; }
      if (!p.trackStock) { ctx.fail(new Error(`Stok ${p.name} tidak dihitung. Aktifkan "Hitung stok" dulu.`)); return; }
      const before = p.stock ?? 0;
      let delta;
      if (type === 'in') delta = n;
      else if (type === 'out') {
        if (n > before) { ctx.fail(new Error(`Stok keluar melebihi stok tersedia (${before}).`)); return; }
        delta = -n;
      } else delta = n - before;
      if (type === 'adjust' && delta === 0) { ctx.fail(new Error('Stok fisik sama dengan stok tercatat.')); return; }

      const stockAfter = before + delta;
      s.products.put({ ...p, stock: stockAfter, updatedAt: now });
      const move = {
        id: uid(), productId: p.id, productName: p.name, type,
        qty: delta, stockBefore: before, stockAfter, note: cleanNote, createdAt: now,
      };
      s.stockMovements.put(move);
      ctx.result = move;
    };
  });
}

export async function listMovements({ productId = '', type = '' } = {}) {
  const all = await getAll('stockMovements');
  return all
    .filter((m) => (!productId || m.productId === productId) && (!type || m.type === type))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Kategori ----------

function checkName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Nama kategori wajib diisi.');
  if (n.length > 40) throw new Error('Nama kategori terlalu panjang.');
  return n;
}

export function addCategory(name) {
  let n;
  try { n = checkName(name); } catch (e) { return Promise.reject(e); }
  return withTx(['categories'], 'readwrite', (s, ctx) => {
    s.categories.getAll().onsuccess = (e) => {
      if (e.target.result.some((c) => c.name.toLowerCase() === n.toLowerCase())) {
        ctx.fail(new Error(`Kategori "${n}" sudah ada.`));
        return;
      }
      const cat = { id: uid(), name: n, createdAt: new Date().toISOString() };
      s.categories.put(cat);
      ctx.result = cat;
    };
  });
}

export function renameCategory(id, name) {
  let n;
  try { n = checkName(name); } catch (e) { return Promise.reject(e); }
  return withTx(['categories'], 'readwrite', (s, ctx) => {
    s.categories.getAll().onsuccess = (e) => {
      const all = e.target.result;
      const cat = all.find((c) => c.id === id);
      if (!cat) { ctx.fail(new Error('Kategori tidak ditemukan.')); return; }
      if (all.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) {
        ctx.fail(new Error(`Kategori "${n}" sudah ada.`));
        return;
      }
      s.categories.put({ ...cat, name: n, updatedAt: new Date().toISOString() });
    };
  });
}

/** Hapus kategori; produk di dalamnya menjadi "Tanpa kategori". */
export function deleteCategory(id) {
  return withTx(['categories', 'products'], 'readwrite', (s) => {
    s.products.getAll().onsuccess = (e) => {
      const now = new Date().toISOString();
      for (const p of e.target.result) {
        if (p.categoryId === id) s.products.put({ ...p, categoryId: null, updatedAt: now });
      }
      s.categories.delete(id);
    };
  });
}
