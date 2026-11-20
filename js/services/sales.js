// Alur penjualan "bayar belakangan" (seperti rumah makan):
//   1. Kasir mengirim pesanan ke dapur  → transaksi status 'open' + tiket dapur.
//   2. Pesanan tambahan (Koreksi)       → item ditambahkan ke transaksi yang sama + tiket dapur baru.
//   3. Dapur mencentang item dihidangkan → tiket 'diproses', lalu 'selesai'.
//   4. Antrean → Bayar                  → transaksi status 'paid'.
// Setiap langkah adalah SATU transaksi IndexedDB atomik.
import { withTx, getMany, getAllByIndex, get, uid, localDateKey } from '../db.js';

const clean = (s, max) => String(s || '').trim().slice(0, max);

/** "Meja 5 · Bu Rina" */
export function whoLine({ tableNo, customerName } = {}) {
  const t = clean(tableNo, 10);
  return [t ? `Meja ${t}` : '', clean(customerName, 60)].filter(Boolean).join(' · ');
}

function normalizeLines(cart) {
  // Satu baris per produk; jumlah digabung, catatan digabung.
  const merged = new Map();
  for (const l of cart || []) {
    if (!l || !l.productId || !(l.qty > 0)) continue;
    if (!Number.isInteger(l.qty) || l.qty > 9999) throw new Error('Jumlah produk tidak valid.');
    const prev = merged.get(l.productId);
    const note = clean(l.note, 120);
    if (prev) {
      prev.qty += l.qty;
      if (note) prev.note = prev.note ? `${prev.note}; ${note}` : note;
    } else {
      merged.set(l.productId, { productId: l.productId, qty: l.qty, note });
    }
  }
  return [...merged.values()];
}

/**
 * Kirim pesanan ke dapur.
 * @param {{productId:string, qty:number, note?:string}[]} cart
 * @param {{tableNo?:string, customerName?:string, note?:string, transactionId?:string}} info
 *        transactionId diisi untuk pesanan TAMBAHAN ke meja yang sudah ada.
 * @returns {Promise<{transaction:object, order:object}>}
 */
export function sendToKitchen(cart, info = {}) {
  let lines;
  try { lines = normalizeLines(cart); } catch (e) { return Promise.reject(e); }
  if (!lines.length) return Promise.reject(new Error('Pesanan masih kosong.'));
  const tableNo = clean(info.tableNo, 10);
  const customerName = clean(info.customerName, 60);
  const note = clean(info.note, 200);
  if (!info.transactionId && !tableNo && !customerName) {
    return Promise.reject(new Error('Isi nomor meja atau nama pemesan dulu.'));
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const dateKey = localDateKey(now);

  return withTx(
    ['products', 'transactions', 'transactionItems', 'orders', 'stockMovements', 'settings'],
    'readwrite',
    (s, ctx) => {
      getMany(s.products, lines.map((l) => l.productId), (products) => {
        // 1. Validasi produk & stok.
        for (let i = 0; i < lines.length; i++) {
          const p = products[i];
          if (!p || p.deleted) { ctx.fail(new Error('Ada produk yang sudah dihapus. Hapus dari pesanan.')); return; }
          if (p.trackStock && (p.stock ?? 0) < lines[i].qty) {
            ctx.fail(new Error(`Stok ${p.name} tidak cukup (sisa ${p.stock ?? 0}).`));
            return;
          }
        }

        const writeAll = (trx, isNew) => {
          ctx.result = writeRound(s, trx, lines, products, { isNew, createdAt, dateKey, note });
        };

        if (info.transactionId) {
          // Pesanan tambahan untuk meja yang belum bayar.
          s.transactions.get(info.transactionId).onsuccess = (e) => {
            const trx = e.target.result;
            if (!trx) { ctx.fail(new Error('Pesanan meja tidak ditemukan.')); return; }
            if (trx.status !== 'open') { ctx.fail(new Error('Pesanan ini sudah dibayar. Buat pesanan baru.')); return; }
            writeAll({ rounds: 1, ...trx }, false);
          };
          return;
        }

        // Pesanan baru: nomor urut harian.
        const seqKey = `seq:${dateKey}`;
        s.settings.get(seqKey).onsuccess = (e) => {
          const seq = (e.target.result?.value || 0) + 1;
          s.settings.put({ key: seqKey, value: seq, updatedAt: createdAt });
          const queueNo = String(seq).padStart(3, '0');
          writeAll({
            id: uid(), number: `${dateKey.replace(/-/g, '')}-${queueNo}`, queueNo, dateKey,
            createdAt, status: 'open', paymentMethod: null,
            subtotal: 0, discount: 0, total: 0, itemCount: 0, rounds: 0,
            cashReceived: null, change: null, paidAt: null, paidDateKey: null,
            tableNo, customerName, note,
          }, true);
        };
      });
    },
  );
}

/**
 * Tulis satu "ronde" pesanan (pesanan awal atau tambahan) di dalam transaksi DB yang sedang berjalan:
 * detail item (snapshot) + pengurangan stok + update total transaksi + tiket dapur.
 * products[i] harus sejajar dengan lines[i].
 */
function writeRound(s, trx, lines, products, { isNew, createdAt, dateKey, note = '' }) {
  const rounds = trx.rounds || 0;
  const items = lines.map((l, i) => {
    const p = products[i];
    const item = {
      id: uid(), transactionId: trx.id, productId: p.id,
      name: p.name, categoryId: p.categoryId ?? null,
      price: p.price, cost: p.cost ?? null, qty: l.qty,
      subtotal: p.price * l.qty, note: l.note || '',
      round: rounds + 1, seq: i, createdAt,
    };
    s.transactionItems.put(item);
    if (p.trackStock) {
      const stockAfter = (p.stock ?? 0) - l.qty;
      p.stock = stockAfter;
      s.products.put({ ...p, stock: stockAfter, updatedAt: createdAt });
      s.stockMovements.put({
        id: uid(), productId: p.id, productName: p.name, type: 'sale',
        qty: -l.qty, stockAfter, refId: trx.id, note: `Pesanan #${trx.queueNo}`, createdAt,
      });
    }
    return item;
  });

  const added = items.reduce((a, it) => a + it.subtotal, 0);
  const updated = {
    ...trx,
    rounds: rounds + 1,
    subtotal: trx.subtotal + added,
    total: trx.total + added,
    itemCount: trx.itemCount + items.reduce((a, it) => a + it.qty, 0),
    updatedAt: createdAt,
  };
  s.transactions.put(updated);

  const order = {
    id: uid(), transactionId: trx.id, number: trx.number, queueNo: trx.queueNo, dateKey,
    round: updated.rounds, isAddition: !isNew,
    tableNo: updated.tableNo, customerName: updated.customerName,
    status: 'menunggu', note,
    items: items.map((it) => ({ itemId: it.id, name: it.name, qty: it.qty, note: it.note, served: false, servedAt: null })),
    createdAt, updatedAt: createdAt, completedAt: null,
  };
  s.orders.put(order);
  return { transaction: updated, order };
}

/**
 * Koreksi pesanan meja yang belum bayar.
 * desired: jumlah AKHIR per produk yang diinginkan, mis. [{productId, qty: 1, note}].
 *   - lebih besar dari sebelumnya → selisihnya dikirim ke dapur sebagai tambahan
 *   - lebih kecil → selisihnya dibatalkan: stok dikembalikan, tiket dapur diperbarui
 *   - produk yang tidak disebut → tidak berubah
 * Jika semua item dibatalkan, pesanan berstatus 'void' (dibatalkan) dan hilang dari antrean.
 */
export function correctOrder(transactionId, desired) {
  const want = new Map();
  for (const d of desired || []) {
    if (!d || !d.productId) continue;
    if (!Number.isInteger(d.qty) || d.qty < 0 || d.qty > 9999) return Promise.reject(new Error('Jumlah produk tidak valid.'));
    want.set(d.productId, { qty: d.qty, note: clean(d.note, 120) });
  }
  const now = new Date();
  const createdAt = now.toISOString();
  const dateKey = localDateKey(now);

  return withTx(
    ['products', 'transactions', 'transactionItems', 'orders', 'stockMovements', 'settings'],
    'readwrite',
    (s, ctx) => {
      s.transactions.get(transactionId).onsuccess = (e) => {
        const trx0 = e.target.result;
        if (!trx0) { ctx.fail(new Error('Pesanan tidak ditemukan.')); return; }
        if (trx0.status !== 'open') { ctx.fail(new Error('Pesanan ini sudah dibayar atau dibatalkan.')); return; }

        s.transactionItems.index('transactionId').getAll(transactionId).onsuccess = (e2) => {
          const items = e2.target.result.filter((it) => it.qty > 0);
          s.orders.index('transactionId').getAll(transactionId).onsuccess = (e3) => {
            const orders = e3.target.result;
            const served = new Map();
            for (const o of orders) for (const it of o.items || []) {
              if (it.itemId) served.set(it.itemId, !!it.served || o.status === 'selesai');
            }

            const existing = new Map();
            for (const it of items) existing.set(it.productId, (existing.get(it.productId) || 0) + it.qty);

            const adds = [];
            const cancels = [];
            for (const [productId, w] of want) {
              const diff = w.qty - (existing.get(productId) || 0);
              if (diff > 0) adds.push({ productId, qty: diff, note: w.note });
              else if (diff < 0) cancels.push({ productId, qty: -diff });
            }
            if (!adds.length && !cancels.length) { ctx.fail(new Error('Tidak ada perubahan.')); return; }

            const ids = [...new Set([...adds, ...cancels].map((x) => x.productId))];
            getMany(s.products, ids, (prods) => {
              const prodById = new Map(ids.map((id, i) => [id, prods[i]]));
              for (const a of adds) {
                const p = prodById.get(a.productId);
                if (!p || p.deleted) { ctx.fail(new Error('Ada produk tambahan yang sudah dihapus.')); return; }
                if (p.trackStock && (p.stock ?? 0) < a.qty) {
                  ctx.fail(new Error(`Stok ${p.name} tidak cukup (sisa ${p.stock ?? 0}).`));
                  return;
                }
              }

              // ---- Pembatalan: kurangi item yang belum dihidangkan & terbaru dulu ----
              let trx = { rounds: 1, cancellations: [], ...trx0 };
              const orderById = new Map(orders.map((o) => [o.id, { ...o, items: (o.items || []).map((x) => ({ ...x })) }]));
              const touchedOrders = new Set();
              for (const c of cancels) {
                let left = c.qty;
                const mine = items
                  .filter((it) => it.productId === c.productId)
                  .sort((a, b) => (Number(!!served.get(a.id)) - Number(!!served.get(b.id))) || b.createdAt.localeCompare(a.createdAt));
                for (const it of mine) {
                  if (!left) break;
                  const k = Math.min(left, it.qty);
                  left -= k;
                  const upd = { ...it, qty: it.qty - k, cancelledQty: (it.cancelledQty || 0) + k, subtotal: it.price * (it.qty - k), updatedAt: createdAt };
                  s.transactionItems.put(upd);
                  trx = {
                    ...trx,
                    subtotal: trx.subtotal - it.price * k,
                    total: trx.total - it.price * k,
                    itemCount: trx.itemCount - k,
                    cancellations: [...trx.cancellations, { at: createdAt, productId: it.productId, name: it.name, qty: k, amount: it.price * k }],
                  };
                  // Tiket dapur
                  for (const o of orderById.values()) {
                    const ti = o.items.find((x) => x.itemId === it.id);
                    if (!ti) continue;
                    ti.qty -= k;
                    if (ti.qty <= 0) o.items = o.items.filter((x) => x !== ti);
                    touchedOrders.add(o.id);
                  }
                  // Stok kembali
                  const p = prodById.get(it.productId);
                  if (p && !p.deleted && p.trackStock) {
                    p.stock = (p.stock ?? 0) + k;
                    s.products.put({ ...p, updatedAt: createdAt });
                    s.stockMovements.put({
                      id: uid(), productId: p.id, productName: p.name, type: 'cancel',
                      qty: k, stockAfter: p.stock, refId: trx.id, note: `Batal pesanan #${trx.queueNo}`, createdAt,
                    });
                  }
                }
              }
              for (const id of touchedOrders) {
                const o = orderById.get(id);
                if (!o.items.length) {
                  s.orders.put({ ...o, status: 'batal', completedAt: createdAt, updatedAt: createdAt });
                } else {
                  s.orders.put({ ...o, updatedAt: createdAt });
                }
              }

              // ---- Tambahan ----
              let order = null;
              trx.updatedAt = createdAt;
              if (adds.length) {
                const r = writeRound(s, trx, adds, adds.map((a) => prodById.get(a.productId)), { isNew: false, createdAt, dateKey });
                trx = r.transaction;
                order = r.order;
              } else if (trx.itemCount <= 0) {
                trx = { ...trx, status: 'void', voidAt: createdAt, total: 0, subtotal: 0, itemCount: 0 };
                s.transactions.put(trx);
              } else {
                s.transactions.put(trx);
              }
              ctx.result = {
                transaction: trx, order,
                added: adds.reduce((a, x) => a + x.qty, 0),
                cancelled: cancels.reduce((a, x) => a + x.qty, 0),
              };
            });
          };
        };
      };
    },
  );
}

/** Bayar tunai pesanan yang masih terbuka. */
export function payTransaction(transactionId, cashReceived) {
  const cash = Number(cashReceived);
  if (!Number.isFinite(cash) || cash < 0) return Promise.reject(new Error('Uang diterima tidak valid.'));
  return withTx(['transactions'], 'readwrite', (s, ctx) => {
    s.transactions.get(transactionId).onsuccess = (e) => {
      const trx = e.target.result;
      if (!trx) { ctx.fail(new Error('Transaksi tidak ditemukan.')); return; }
      if (trx.status !== 'open') { ctx.fail(new Error('Transaksi ini sudah dibayar.')); return; }
      if (cash < trx.total) { ctx.fail(new Error('Uang diterima kurang dari total.')); return; }
      const now = new Date();
      const paid = {
        ...trx, status: 'paid', paymentMethod: 'cash',
        cashReceived: cash, change: cash - trx.total,
        paidAt: now.toISOString(), paidDateKey: localDateKey(now), updatedAt: now.toISOString(),
      };
      s.transactions.put(paid);
      ctx.result = paid;
    };
  });
}

// ---------- Dapur ----------

/** Centang / batalkan centang satu item pada tiket dapur. */
export function setItemServed(orderId, itemId, served) {
  return withTx(['orders'], 'readwrite', (s, ctx) => {
    s.orders.get(orderId).onsuccess = (e) => {
      const o = e.target.result;
      if (!o) { ctx.fail(new Error('Pesanan tidak ditemukan.')); return; }
      const now = new Date().toISOString();
      const items = o.items.map((it) => (it.itemId === itemId
        ? { ...it, served: !!served, servedAt: served ? now : null } : it));
      const anyServed = items.some((it) => it.served);
      const updated = {
        ...o, items, updatedAt: now,
        status: o.status === 'selesai' ? 'selesai' : (anyServed ? 'diproses' : 'menunggu'),
      };
      s.orders.put(updated);
      ctx.result = updated;
    };
  });
}

/** Tandai seluruh tiket sudah dihidangkan. */
export function serveOrder(orderId) {
  return withTx(['orders'], 'readwrite', (s, ctx) => {
    s.orders.get(orderId).onsuccess = (e) => {
      const o = e.target.result;
      if (!o) { ctx.fail(new Error('Pesanan tidak ditemukan.')); return; }
      const now = new Date().toISOString();
      const updated = {
        ...o, status: 'selesai', completedAt: now, updatedAt: now,
        items: o.items.map((it) => (it.served ? it : { ...it, served: true, servedAt: now })),
      };
      s.orders.put(updated);
      ctx.result = updated;
    };
  });
}

// ---------- Baca data ----------

export async function listKitchenOrders() {
  // Hanya pesanan aktif (index status), bukan seluruh riwayat.
  const [waiting, working] = await Promise.all([
    getAllByIndex('orders', 'status', 'menunggu'),
    getAllByIndex('orders', 'status', 'diproses'),
  ]);
  return [...waiting, ...working]
    .map((o) => ({ ...o, items: (o.items || []).map((it) => ({ served: false, ...it })) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listOpenTransactions() {
  const all = await getAllByIndex('transactions', 'status', 'open');
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listPaidToday() {
  const today = localDateKey();
  // Lunas hari ini = dibuat paling lama beberapa hari lalu; baca lewat index tanggal.
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const all = await getAllByIndex('transactions', 'createdAt', IDBKeyRange.lowerBound(since));
  return all
    .filter((t) => t.status === 'paid' && (t.paidDateKey || t.dateKey) === today)
    .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));
}

/** Transaksi + item + tiket dapur + status hidang per item. */
export async function getTransactionDetail(id) {
  const trx = await get('transactions', id);
  if (!trx) return null;
  const [items, myOrders] = await Promise.all([
    getAllByIndex('transactionItems', 'transactionId', id),
    getAllByIndex('orders', 'transactionId', id),
  ]);
  const served = new Map();
  for (const o of myOrders) for (const it of o.items || []) if (it.itemId) served.set(it.itemId, !!it.served || o.status === 'selesai');
  const myItems = items
    .filter((it) => it.qty > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0))
    .map((it) => ({ ...it, served: served.get(it.id) ?? myOrders.some((o) => o.status === 'selesai') }));
  return { transaction: trx, items: myItems, orders: myOrders };
}

/** Ringkasan status dapur untuk satu transaksi. */
export function kitchenSummary(items) {
  const total = items.length;
  const done = items.filter((it) => it.served).length;
  if (!total) return { label: '—', state: 'warn' };
  if (done === total) return { label: 'Semua dihidangkan', state: 'ok' };
  if (done === 0) return { label: 'Menunggu dapur', state: 'warn' };
  return { label: `Dihidangkan ${done}/${total}`, state: 'warn' };
}
