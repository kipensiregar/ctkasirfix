// Antrean: meja/pesanan yang belum dibayar + riwayat hari ini.
// Ketuk kartu → lihat daftar pesanan → Koreksi (tambah menu) atau Bayar.
import {
  listOpenTransactions, listPaidToday, getTransactionDetail, kitchenSummary, whoLine,
} from '../services/sales.js';
import { openPayment } from './payment.js';
import { esc, rupiah, openModal } from '../ui.js';

const time = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export async function render(view) {
  const [open, paid] = await Promise.all([listOpenTransactions(), listPaidToday()]);
  const details = new Map();
  await Promise.all(open.map(async (t) => details.set(t.id, await getTransactionDetail(t.id))));

  view.innerHTML = `
    <div class="page-head"><h1>Menunggu Bayar</h1><span class="muted">${open.length} pesanan</span></div>
    ${open.length ? `<div class="bill-grid">${open.map((t) => {
      const d = details.get(t.id);
      const ks = kitchenSummary(d.items);
      const agg = aggregate(d.items);
      return `
        <button type="button" class="bill-card" data-open="${esc(t.id)}">
          <span class="bill-top">
            <span class="bill-who">${t.tableNo ? `<span class="table-no">${esc(t.tableNo)}</span>` : ''}
              <span><b>${esc(t.tableNo ? (t.customerName || `Meja ${t.tableNo}`) : t.customerName)}</b>
              <span class="small muted">#${esc(t.queueNo)} · ${time(t.createdAt)}</span></span></span>
            <span class="bill-total">${rupiah(t.total)}</span>
          </span>
          <span class="bill-items">${agg.slice(0, 4).map((a) => `<span>• ${esc(a.name)} ×${a.qty}</span>`).join('')}
            ${agg.length > 4 ? `<span class="muted">+${agg.length - 4} menu lain</span>` : ''}</span>
          <span class="badge ${ks.state}">${esc(ks.label)}</span>
        </button>`;
    }).join('')}</div>` : `
      <div class="card placeholder"><div class="ph-icon">🔢</div>
        <p><b>Tidak ada pesanan yang menunggu pembayaran.</b></p></div>`}

    <h2 style="margin-top:28px">Lunas hari ini <span class="muted small">(${paid.length})</span></h2>
    <div class="card list-card">${paid.length ? paid.map((t) => `
      <button type="button" class="list-row" data-paid="${esc(t.id)}">
        <span class="lr-main"><span class="lr-title">${esc(whoLine(t) || 'Tanpa nama')}</span>
          <span class="small muted">#${esc(t.queueNo)} · dibayar ${time(t.paidAt || t.createdAt)}</span></span>
        <span class="lr-side"><b>${rupiah(t.total)}</b><span class="badge ok">Lunas</span></span>
      </button>`).join('') : '<p class="muted" style="text-align:center;padding:20px;margin:0">Belum ada.</p>'}
    </div>`;

  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showDetail(b.dataset.open)));
  view.querySelectorAll('[data-paid]').forEach((b) => b.addEventListener('click', () => showDetail(b.dataset.paid)));

  async function showDetail(id) {
    const d = await getTransactionDetail(id);
    if (!d) return;
    const t = d.transaction;
    const isOpen = t.status === 'open';
    const ks = kitchenSummary(d.items);
    const rounds = groupByRound(d.items);
    const { el, close } = openModal(`
      <div class="modal-head">
        <div><h2>${esc(whoLine(t) || 'Tanpa nama')}</h2>
          <div class="small muted">#${esc(t.queueNo)} · dibuat ${time(t.createdAt)}${t.paidAt ? ` · lunas ${time(t.paidAt)}` : ''}</div></div>
        <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button>
      </div>
      <div class="detail-status">${isOpen ? `<span class="badge warn">Belum bayar</span>` : `<span class="badge ok">Lunas</span>`}
        <span class="badge ${ks.state}">${esc(ks.label)}</span></div>
      ${rounds.map(([round, items]) => `
        ${rounds.length > 1 ? `<div class="round-label">${round === 1 ? 'Pesanan awal' : `Tambahan ${round - 1}`}</div>` : ''}
        <ul class="detail-items">${items.map((it) => `
          <li>
            <span class="di-main"><span>${it.served ? '<span class="dot-ok">✓</span>' : '<span class="dot-wait">•</span>'}
              <b>${it.qty}×</b> ${esc(it.name)}</span>
              ${it.note ? `<span class="ti-note">${esc(it.note)}</span>` : ''}</span>
            <span class="di-sub">${rupiah(it.subtotal)}</span>
          </li>`).join('')}</ul>`).join('')}
      <div class="cart-row total"><span>Total</span><span>${rupiah(t.total)}</span></div>
      ${!isOpen ? `<table class="simple"><tr><td>Tunai</td><td>${rupiah(t.cashReceived)}</td></tr>
        <tr><td>Kembalian</td><td>${rupiah(t.change)}</td></tr></table>` : ''}
      ${isOpen ? `<div class="btn-row two">
        <a class="btn secondary" href="#/kasir?tambah=${encodeURIComponent(t.id)}" id="d-fix">Koreksi (tambah menu)</a>
        <button type="button" class="btn" id="d-pay">Bayar</button>
      </div>` : ''}`, { wide: true });
    el.querySelector('#d-fix')?.addEventListener('click', () => close());
    el.querySelector('#d-pay')?.addEventListener('click', () => {
      close();
      openPayment(t, () => {
        window.dispatchEvent(new Event('ct:data-changed'));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    });
  }

  const timer = setInterval(async () => {
    if (document.querySelector('.modal-backdrop')) return;
    const fresh = await listOpenTransactions();
    if (fresh.length !== open.length || fresh.some((t, i) => t.updatedAt !== open[i]?.updatedAt)) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, 20000);
  return () => clearInterval(timer);
}

function aggregate(items) {
  const m = new Map();
  for (const it of items) {
    const a = m.get(it.productId || it.name) || { name: it.name, qty: 0 };
    a.qty += it.qty;
    m.set(it.productId || it.name, a);
  }
  return [...m.values()];
}

function groupByRound(items) {
  const m = new Map();
  for (const it of items) {
    const r = it.round || 1;
    if (!m.has(r)) m.set(r, []);
    m.get(r).push(it);
  }
  return [...m].sort((a, b) => a[0] - b[0]);
}
