// Dapur: satu kartu per pesanan. Tambahan dari Koreksi tampil di bawah pesanan awal
// dalam kartu yang sama. Centang item yang sudah dihidangkan, lalu "Hidangkan" untuk
// menyelesaikan seluruh kartu. Pesanan yang sudah dibayar otomatis hilang dari sini.
import { listKitchenOrders, groupKitchenOrders, setItemServed, serveOrders, whoLine } from '../services/sales.js';
import { esc, toast } from '../ui.js';

function elapsed(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  return `${Math.floor(m / 60)} jam ${m % 60} menit lalu`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

function itemRows(o) {
  return o.items.map((it) => `
    <li class="${it.served ? 'served' : ''}">
      <button type="button" class="serve-row" data-order="${esc(o.id)}" data-item="${esc(it.itemId || '')}"
        ${it.itemId ? '' : 'disabled'} aria-pressed="${it.served ? 'true' : 'false'}">
        <span class="ti-text">
          <span class="ti-name"><b>${it.qty}×</b> ${esc(it.name)}</span>
          ${it.note ? `<span class="ti-note">${esc(it.note)}</span>` : ''}
        </span>
        <span class="serve-check">${it.served ? '✓' : ''}</span>
      </button>
    </li>`).join('');
}

export async function render(view) {
  let orders = await listKitchenOrders();

  const draw = () => {
    const groups = groupKitchenOrders(orders);
    if (!groups.length) {
      view.innerHTML = `
        <h1>Dapur</h1>
        <div class="card placeholder">
          <div class="ph-icon">🍳</div>
          <p><b>Tidak ada pesanan yang menunggu.</b></p>
          <p class="small">Pesanan dari kasir akan muncul di sini.</p>
        </div>`;
      return;
    }
    view.innerHTML = `
      <div class="page-head"><h1>Dapur</h1><span class="muted">${groups.length} pesanan aktif</span></div>
      <div class="kitchen-grid">
        ${groups.map((g) => {
          const late = (Date.now() - new Date(g.createdAt).getTime()) / 60000 >= 15;
          const done = g.items.filter((it) => it.served).length;
          return `
          <article class="ticket${done ? ' in-progress' : ''}" data-group="${esc(g.key)}">
            <header class="ticket-head">
              <div>
                <div class="ticket-who">${esc(whoLine(g) || 'Tanpa nama')}</div>
                <div class="small muted">#${esc(g.queueNo)}${g.orders.length > 1 ? ` · ${g.orders.length - 1} tambahan` : ''}</div>
              </div>
              <div class="ticket-time${late ? ' late' : ''}" data-time="${esc(g.createdAt)}">${elapsed(g.createdAt)}</div>
            </header>
            ${g.orders.map((o, i) => {
              const pending = o.items.some((it) => !it.served);
              return `
              ${i > 0 ? `<div class="round-sep${pending ? ' is-new' : ''}">
                  <span>Tambahan${g.orders.length > 2 ? ` ${i}` : ''}</span>
                  <span class="small">${clock(o.createdAt)}</span>
                </div>` : ''}
              <ul class="ticket-items">${itemRows(o)}</ul>
              ${o.note ? `<p class="ticket-note">📝 ${esc(o.note)}</p>` : ''}`;
            }).join('')}
            <button type="button" class="btn btn-serve" data-serve="${esc(g.key)}">
              Hidangkan ${done ? `(${done}/${g.items.length})` : ''} ✓
            </button>
          </article>`;
        }).join('')}
      </div>`;
  };
  draw();

  view.addEventListener('click', onClick);
  async function onClick(e) {
    const row = e.target.closest('.serve-row');
    const serveBtn = e.target.closest('[data-serve]');
    try {
      if (row && row.dataset.item) {
        const o = orders.find((x) => x.id === row.dataset.order);
        const it = o.items.find((x) => x.itemId === row.dataset.item);
        const updated = await setItemServed(o.id, it.itemId, !it.served);
        orders = orders.map((x) => (x.id === o.id ? updated : x));
        draw();
      } else if (serveBtn) {
        serveBtn.disabled = true;
        const g = groupKitchenOrders(orders).find((x) => x.key === serveBtn.dataset.serve);
        await serveOrders(g.orders.map((o) => o.id));
        const ids = new Set(g.orders.map((o) => o.id));
        orders = orders.filter((x) => !ids.has(x.id));
        draw();
        toast(`${whoLine(g) || '#' + g.queueNo} sudah dihidangkan.`);
        window.dispatchEvent(new Event('ct:data-changed'));
      }
    } catch (err) {
      toast(err.message || 'Gagal menyimpan.', { error: true });
      if (serveBtn) serveBtn.disabled = false;
    }
  }

  // Perbarui waktu tunggu & pesanan baru secara berkala.
  const timer = setInterval(async () => {
    if (document.querySelector('.modal-backdrop')) return;
    const fresh = await listKitchenOrders();
    const key = (list) => list.map((o) => `${o.id}:${o.updatedAt}`).sort().join('|');
    if (key(fresh) !== key(orders)) { orders = fresh; draw(); window.dispatchEvent(new Event('ct:data-changed')); return; }
    view.querySelectorAll('[data-time]').forEach((el) => { el.textContent = elapsed(el.dataset.time); });
  }, 20000);

  return () => { clearInterval(timer); view.removeEventListener('click', onClick); };
}
