// Penyimpanan transaksi kasir — SATU transaksi database atomik:
// transaksi + detail (snapshot) + pesanan dapur + pengurangan stok + nomor urut harian.
// Jika satu bagian gagal (mis. stok kurang), tidak ada yang tersimpan.
import { withTx, getMany, uid, localDateKey } from '../db.js';

/**
 * @param {{productId:string, qty:number}[]} cart
 * @param {{cashReceived:number, customerName?:string, note?:string}} payment
 * @returns {Promise<{transaction:object, items:object[], order:object}>}
 */
export function checkout(cart, payment) {
  // Gabungkan baris dengan produk yang sama agar cek stok akurat.
  const merged = new Map();
  for (const l of cart || []) {
    if (l && l.productId && l.qty > 0) merged.set(l.productId, (merged.get(l.productId) || 0) + l.qty);
  }
  const lines = [...merged].map(([productId, qty]) => ({ productId, qty }));
  if (!lines.length) return Promise.reject(new Error('Keranjang masih kosong.'));
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty > 9999) return Promise.reject(new Error('Jumlah produk tidak valid.'));
  }
  const cash = Number(payment?.cashReceived);
  if (!Number.isFinite(cash) || cash < 0) return Promise.reject(new Error('Uang diterima tidak valid.'));

  const now = new Date();
  const createdAt = now.toISOString();
  const dateKey = localDateKey(now);
  const customerName = String(payment.customerName || '').trim().slice(0, 60);
  const note = String(payment.note || '').trim().slice(0, 200);

  return withTx(
    ['products', 'transactions', 'transactionItems', 'orders', 'stockMovements', 'settings'],
    'readwrite',
    (s, ctx) => {
      getMany(s.products, lines.map((l) => l.productId), (products) => {
        // 1. Validasi produk & stok, hitung total dari harga di database.
        let total = 0;
        for (let i = 0; i < lines.length; i++) {
          const p = products[i];
          if (!p || p.deleted) { ctx.fail(new Error('Ada produk di keranjang yang sudah dihapus. Hapus dari keranjang.')); return; }
          if (p.trackStock && (p.stock ?? 0) < lines[i].qty) {
            ctx.fail(new Error(`Stok ${p.name} tidak cukup (sisa ${p.stock ?? 0}).`));
            return;
          }
          total += p.price * lines[i].qty;
        }
        if (cash < total) { ctx.fail(new Error('Uang diterima kurang dari total.')); return; }

        // 2. Nomor urut harian.
        const seqKey = `seq:${dateKey}`;
        s.settings.get(seqKey).onsuccess = (e) => {
          const seq = (e.target.result?.value || 0) + 1;
          s.settings.put({ key: seqKey, value: seq, updatedAt: createdAt });
          const queueNo = String(seq).padStart(3, '0');
          const number = `${dateKey.replace(/-/g, '')}-${queueNo}`;
          const trxId = uid();

          // 3. Detail transaksi (snapshot) + stok.
          const items = lines.map((l, i) => {
            const p = products[i];
            const item = {
              id: uid(), transactionId: trxId, productId: p.id,
              name: p.name, categoryId: p.categoryId ?? null,
              price: p.price, cost: p.cost ?? null, qty: l.qty,
              subtotal: p.price * l.qty, createdAt,
            };
            s.transactionItems.put(item);
            if (p.trackStock) {
              const stockAfter = (p.stock ?? 0) - l.qty;
              s.products.put({ ...p, stock: stockAfter, updatedAt: createdAt });
              s.stockMovements.put({
                id: uid(), productId: p.id, productName: p.name, type: 'sale',
                qty: -l.qty, stockAfter, refId: trxId, note: `Penjualan #${queueNo}`, createdAt,
              });
            }
            return item;
          });

          const transaction = {
            id: trxId, number, queueNo, dateKey, createdAt,
            status: 'paid', paymentMethod: 'cash',
            subtotal: total, discount: 0, total,
            cashReceived: cash, change: cash - total,
            itemCount: lines.reduce((a, l) => a + l.qty, 0),
            customerName, note,
          };
          s.transactions.put(transaction);

          // 4. Pesanan untuk dapur.
          const order = {
            id: uid(), transactionId: trxId, number, queueNo, dateKey,
            status: 'menunggu', customerName, note,
            items: items.map((it) => ({ name: it.name, qty: it.qty })),
            createdAt, updatedAt: createdAt,
          };
          s.orders.put(order);

          ctx.result = { transaction, items, order };
        };
      });
    },
  );
}
