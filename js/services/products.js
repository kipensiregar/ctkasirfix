// Produk & kategori.
// Produk tidak pernah dihapus permanen (hanya ditandai deleted) agar riwayat tetap utuh.
import { getAll, withTx, uid } from '../db.js';

const byName = (a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });

export async function listProducts({ includeDeleted = false } = {}) {
  const rows = await getAll('products');
  return rows.filter((p) => includeDeleted || !p.deleted).sort(byName);
}

export async function listCategories() {
  return (await getAll('categories')).sort(byName);
}

function toInt(v, label, { allowNull = false } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (allowNull) return null;
    throw new Error(`${label} wajib diisi.`);
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d-]/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new Error(`${label} harus angka 0 atau lebih.`);
  if (n > 1e12) throw new Error(`${label} terlalu besar.`);
  return n;
}

/**
 * Simpan produk baru / perubahan produk.
 * input: { id?, name, categoryName, price, cost, trackStock, stock }
 * Perubahan stok lewat form dicatat sebagai pergerakan stok "adjust".
 */
export function saveProduct(input) {
  const name = String(input.name || '').trim();
  if (!name) return Promise.reject(new Error('Nama produk wajib diisi.'));
  if (name.length > 80) return Promise.reject(new Error('Nama produk terlalu panjang.'));
  let price, cost, stock;
  try {
    price = toInt(input.price, 'Harga jual');
    cost = toInt(input.cost, 'Harga modal', { allowNull: true });
    stock = input.trackStock ? toInt(input.stock, 'Stok') : null;
  } catch (err) {
    return Promise.reject(err);
  }
  const categoryName = String(input.categoryName || '').trim();
  const now = new Date().toISOString();

  return withTx(['products', 'categories', 'stockMovements'], 'readwrite', (s, ctx) => {
    const finish = (categoryId) => {
      const writeProduct = (existing) => {
        if (input.id && (!existing || existing.deleted)) { ctx.fail(new Error('Produk tidak ditemukan.')); return; }
        const product = {
          ...(existing || { id: uid(), createdAt: now }),
          name, categoryId, price, cost,
          trackStock: !!input.trackStock,
          stock: input.trackStock ? stock : (existing?.stock ?? null),
          updatedAt: now,
        };
        const before = existing && existing.trackStock ? (existing.stock ?? 0) : 0;
        if (product.trackStock && stock !== before) {
          s.stockMovements.put({
            id: uid(), productId: product.id, productName: name,
            type: existing ? 'adjust' : 'initial',
            qty: stock - before, stockAfter: stock, note: 'Diubah dari form produk',
            createdAt: now,
          });
        }
        s.products.put(product);
        ctx.result = product;
      };
      if (input.id) s.products.get(input.id).onsuccess = (e) => writeProduct(e.target.result);
      else writeProduct(null);
    };

    if (!categoryName) { finish(null); return; }
    // Cari kategori dengan nama sama (tanpa beda huruf besar/kecil), buat jika belum ada.
    s.categories.getAll().onsuccess = (e) => {
      const found = e.target.result.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
      if (found) { finish(found.id); return; }
      const cat = { id: uid(), name: categoryName, createdAt: now };
      s.categories.put(cat);
      finish(cat.id);
    };
  });
}

export function deleteProduct(id) {
  return withTx(['products'], 'readwrite', (s, ctx) => {
    s.products.get(id).onsuccess = (e) => {
      const p = e.target.result;
      if (!p) { ctx.fail(new Error('Produk tidak ditemukan.')); return; }
      s.products.put({ ...p, deleted: true, deletedAt: new Date().toISOString() });
    };
  });
}
