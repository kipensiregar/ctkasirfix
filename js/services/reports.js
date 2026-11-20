// Perhitungan laporan penjualan.
// Aturan: hanya transaksi LUNAS (status 'paid') yang dihitung, berdasarkan TANGGAL BAYAR (paidDateKey).
// Angka diambil dari snapshot di detail transaksi (nama, harga jual, harga modal saat itu),
// sehingga laporan lama tidak berubah walau produk diedit atau dihapus.
import { openDB, getAll, localDateKey } from '../db.js';

/** 'YYYY-MM-DD' → Date lokal (jam 00:00). */
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return localDateKey(d);
}
export function daysBetween(fromKey, toKey) {
  return Math.round((parseDateKey(toKey) - parseDateKey(fromKey)) / 86400000);
}

/** Periode cepat. */
export function presetRange(name, today = localDateKey()) {
  const t = parseDateKey(today);
  switch (name) {
    case 'kemarin': { const k = addDays(today, -1); return { from: k, to: k }; }
    case '7hari': return { from: addDays(today, -6), to: today };
    case 'bulanini': return { from: localDateKey(new Date(t.getFullYear(), t.getMonth(), 1)), to: today };
    case 'bulanlalu': return {
      from: localDateKey(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
      to: localDateKey(new Date(t.getFullYear(), t.getMonth(), 0)),
    };
    default: return { from: today, to: today };
  }
}

/** Ambil transaksi (berdasarkan rentang tanggal dibuat, lewat index) + detail item, dalam satu transaksi DB baca. */
async function loadRange(fromKey, toKey) {
  const db = await openDB();
  // Transaksi dibayar pada hari yang sama atau tak lama setelah dibuat; beri kelonggaran 7 hari.
  const lo = parseDateKey(addDays(fromKey, -7)).toISOString();
  const hi = parseDateKey(addDays(toKey, 2)).toISOString();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transactions', 'transactionItems'], 'readonly');
    const out = { trx: [], items: new Map() };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.objectStore('transactions').index('createdAt').getAll(IDBKeyRange.bound(lo, hi)).onsuccess = (e) => {
      out.trx = e.target.result;
      const idx = tx.objectStore('transactionItems').index('transactionId');
      for (const t of out.trx) {
        if (t.status !== 'paid') continue;
        idx.getAll(t.id).onsuccess = (ev) => out.items.set(t.id, ev.target.result);
      }
    };
  });
}

/**
 * Hitung laporan untuk rentang tanggal (inklusif).
 * @returns {Promise<object>}
 */
export async function buildReport(fromKey, toKey) {
  if (toKey < fromKey) [fromKey, toKey] = [toKey, fromKey];
  const [{ trx, items }, categories] = await Promise.all([loadRange(fromKey, toKey), getAll('categories')]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const inRange = (k) => k && k >= fromKey && k <= toKey;
  const singleDay = fromKey === toKey;

  const paid = trx
    .filter((t) => t.status === 'paid' && inRange(t.paidDateKey || t.dateKey))
    .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));

  // Kerangka grafik: per jam (1 hari) atau per tanggal.
  const buckets = new Map();
  if (singleDay) for (let h = 0; h < 24; h++) buckets.set(h, { key: h, omzet: 0, count: 0 });
  else for (let k = fromKey; k <= toKey; k = addDays(k, 1)) buckets.set(k, { key: k, omzet: 0, count: 0 });

  const r = {
    from: fromKey, to: toKey, singleDay,
    omzet: 0, count: paid.length, qty: 0,
    cost: 0, profit: 0, qtyWithCost: 0, omzetWithCost: 0,
    missingCost: new Set(),
    products: new Map(), categories: new Map(),
    cancelled: { qty: 0, amount: 0, voids: 0 },
    transactions: paid,
  };

  for (const t of paid) {
    r.omzet += t.total;
    const when = t.paidAt || t.createdAt;
    const bkey = singleDay ? new Date(when).getHours() : (t.paidDateKey || t.dateKey);
    const b = buckets.get(bkey);
    if (b) { b.omzet += t.total; b.count += 1; }

    for (const it of items.get(t.id) || []) {
      if (!(it.qty > 0)) continue;
      const sub = it.price * it.qty;
      r.qty += it.qty;
      const pk = it.productId || it.name;
      const p = r.products.get(pk) || { name: it.name, qty: 0, omzet: 0, profit: 0, costKnown: true };
      p.name = it.name;
      p.qty += it.qty;
      p.omzet += sub;
      if (it.cost != null) {
        const c = it.cost * it.qty;
        r.cost += c;
        r.profit += sub - c;
        r.qtyWithCost += it.qty;
        r.omzetWithCost += sub;
        p.profit += sub - c;
      } else {
        p.costKnown = false;
        r.missingCost.add(it.name);
      }
      r.products.set(pk, p);
      const cn = (it.categoryId && catName.get(it.categoryId)) || 'Tanpa kategori';
      r.categories.set(cn, (r.categories.get(cn) || 0) + sub);
    }
  }

  // Pembatalan (porsi yang dibatalkan lewat Koreksi) dalam rentang ini.
  for (const t of trx) {
    for (const c of t.cancellations || []) {
      if (inRange(localDateKey(new Date(c.at)))) { r.cancelled.qty += c.qty; r.cancelled.amount += c.amount; }
    }
    if (t.status === 'void' && t.voidAt && inRange(localDateKey(new Date(t.voidAt)))) r.cancelled.voids += 1;
  }

  r.avg = r.count ? Math.round(r.omzet / r.count) : 0;
  r.buckets = [...buckets.values()];
  r.productList = [...r.products.values()];
  r.categoryList = [...r.categories].map(([name, omzet]) => ({ name, omzet })).sort((a, b) => b.omzet - a.omzet);
  r.missingCost = [...r.missingCost].sort();
  return r;
}

/** Baris CSV (dipisah titik koma agar langsung rapi di Excel versi Indonesia). */
export async function buildCsv(report) {
  const { items } = await loadRange(report.from, report.to);
  const q = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Tanggal bayar', 'Jam', 'No. pesanan', 'Meja', 'Nama pemesan', 'Menu', 'Jumlah', 'Harga', 'Subtotal', 'Harga modal', 'Laba']];
  for (const t of [...report.transactions].reverse()) {
    const d = new Date(t.paidAt || t.createdAt);
    for (const it of items.get(t.id) || []) {
      if (!(it.qty > 0)) continue;
      const sub = it.price * it.qty;
      rows.push([
        t.paidDateKey || t.dateKey,
        d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        t.queueNo, t.tableNo || '', t.customerName || '', it.name, it.qty, it.price, sub,
        it.cost ?? '', it.cost != null ? sub - it.cost * it.qty : '',
      ]);
    }
  }
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}
