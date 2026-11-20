// Dapur: daftar pesanan yang harus disiapkan. Centang item yang sudah dihidangkan,
// lalu tekan "Hidangkan" untuk menyelesaikan pesanan.
import { listKitchenOrders, setItemServed, serveOrder, whoLine } from '../services/sales.js';
import { esc, toast } from '../ui.js';

function elapsed(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  return `${Math.floor(m / 60)} jam ${m % 60} menit lalu`;
}

export async function render(view) {
  let orders = await listKitchenOrders();

  const draw = () => {
    if (!orders.length) {
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
      <div class="page-head"><h1>Dapur</h1><span class="muted">${orders.length} pesanan aktif</span></div>
      <div class="kitchen-grid">
        ${orders.map((o) => {
          const late = (Date.now() - new Date(o.createdAt).getTime()) / 60000 >= 15;
          const done = o.items.filter((it) => it.served).length;
          return `
          <article class="ticket${o.status === 'diproses' ? ' in-progress' : ''}" data-order="${esc(o.id)}">
            <header class="ticket-head">
              <div>
                <div class="ticket-who">${esc(whoLine(o) || 'Tanpa nama')}</div>
                <div class="small muted">#${esc(o.queueNo)}${o.isAddition ? ' · <span class="tag-add">Tambahan</span>' : ''}</div>
              </div>
              <div class="ticket-time${late ? ' late' : ''}" data-time="${esc(o.createdAt)}">${elapsed(o.createdAt)}</div>
            </header>
            <ul class="ticket-items">
              ${o.items.map((it) => `
                <li class="${it.served ? 'served' : ''}">
                  <button type="button" class="serve-row" data-item="${esc(it.itemId || '')}" ${it.itemId ? '' : 'disabled'}
                    aria-pressed="${it.served ? 'true' : 'false'}">
                    <span class="ti-text">
                      <span class="ti-name"><b>${it.qty}×</b> ${esc(it.name)}</span>
                      ${it.note ? `<span class="ti-note">${esc(it.note)}</span>` : ''}
                    </span>
                    <span class="check">${it.served ? '✓' : ''}</span>
                  </button>
                </li>`).join('')}
            </ul>
            ${o.note ? `<p class="ticket-note">📝 ${esc(o.note)}</p>` : ''}
            <button type="button" class="btn btn-serve" data-serve="${esc(o.id)}">
              Hidangkan ${done ? `(${done}/${o.items.length})` : ''} ✓
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
        const orderId = row.closest('[data-order]').dataset.order;
        const o = orders.find((x) => x.id === orderId);
        const it = o.items.find((x) => x.itemId === row.dataset.item);
        const updated = await setItemServed(orderId, it.itemId, !it.served);
        orders = orders.map((x) => (x.id === orderId ? updated : x));
        draw();
      } else if (serveBtn) {
        serveBtn.disabled = true;
        const o = orders.find((x) => x.id === serveBtn.dataset.serve);
        await serveOrder(o.id);
        orders = orders.filter((x) => x.id !== o.id);
        draw();
        toast(`${whoLine(o) || '#' + o.queueNo} sudah dihidangkan.`);
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
    const changed = fresh.length !== orders.length || fresh.some((o, i) => o.id !== orders[i]?.id || o.updatedAt !== orders[i]?.updatedAt);
    if (changed) { orders = fresh; draw(); return; }
    view.querySelectorAll('[data-time]').forEach((el) => { el.textContent = elapsed(el.dataset.time); });
  }, 20000);

  return () => { clearInterval(timer); view.removeEventListener('click', onClick); };
}
