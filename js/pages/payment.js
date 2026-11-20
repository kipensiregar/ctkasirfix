// Modal pembayaran tunai — dipakai dari Antrean.
import { payTransaction, whoLine } from '../services/sales.js';
import { openReceipt } from '../services/receipt.js';
import { esc, toast, rupiah, parseMoney, openModal } from '../ui.js';

/** Saran uang tunai: uang pas lalu pecahan umum di atas total. */
export function cashSuggestions(total) {
  const out = [total];
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 5);
}

/**
 * Buka modal bayar untuk transaksi terbuka.
 * @param {object} trx  transaksi (status 'open')
 * @param {(paid:object)=>void} onPaid dipanggil setelah pengguna menutup layar kembalian
 */
export function openPayment(trx, onPaid) {
  const total = trx.total;
  const who = whoLine(trx);
  const { el, close } = openModal(`
    <div class="modal-head"><h2>Pembayaran Tunai</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
    <p class="who-line">${esc(who)} <span class="muted small">#${esc(trx.queueNo)}</span></p>
    <div class="pay-total"><span class="muted">Total</span><b>${rupiah(total)}</b></div>
    <label for="pay-cash">Uang diterima</label>
    <input id="pay-cash" type="text" inputmode="numeric" autocomplete="off" class="money-input" placeholder="0">
    <div class="quick-cash">
      ${cashSuggestions(total).map((v, i) => `<button type="button" class="chip" data-cash="${v}">${i === 0 ? 'Uang pas' : rupiah(v)}</button>`).join('')}
    </div>
    <div class="pay-change"><span>Kembalian</span><b id="pay-change">—</b></div>
    <button type="button" class="btn btn-pay" id="pay-submit" disabled>Simpan Pembayaran</button>`);

  const cashInput = el.querySelector('#pay-cash');
  const submit = el.querySelector('#pay-submit');
  const changeEl = el.querySelector('#pay-change');
  const update = () => {
    const cash = parseMoney(cashInput.value);
    cashInput.value = cash ? new Intl.NumberFormat('id-ID').format(cash) : '';
    const ok = cash >= total;
    changeEl.textContent = cash ? (ok ? rupiah(cash - total) : `Kurang ${rupiah(total - cash)}`) : '—';
    changeEl.classList.toggle('short', cash > 0 && !ok);
    submit.disabled = !ok;
  };
  cashInput.addEventListener('input', update);
  el.querySelector('.quick-cash').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cash]');
    if (b) { cashInput.value = b.dataset.cash; update(); }
  });

  let saving = false;
  submit.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    submit.disabled = true;
    submit.textContent = 'Menyimpan…';
    try {
      const paid = await payTransaction(trx.id, parseMoney(cashInput.value));
      close();
      showPaid(paid, onPaid);
    } catch (err) {
      toast(err.message || 'Pembayaran gagal disimpan.', { error: true, ms: 6000 });
      saving = false;
      submit.textContent = 'Simpan Pembayaran';
      update();
    }
  });
  setTimeout(() => { if (!el.contains(document.activeElement)) cashInput.focus(); }, 50);
}

function showPaid(t, onPaid) {
  const who = whoLine(t);
  const { el, close } = openModal(`
    <div class="success">
      <div class="success-icon">✓</div>
      <h2>Lunas</h2>
      <div class="queue-no">#${esc(t.queueNo)}</div>
      ${who ? `<p class="who-line">${esc(who)}</p>` : ''}
      <table class="simple">
        <tr><td>Total</td><td>${rupiah(t.total)}</td></tr>
        <tr><td>Tunai</td><td>${rupiah(t.cashReceived)}</td></tr>
      </table>
      <div class="pay-change big"><span>Kembalian</span><b>${rupiah(t.change)}</b></div>
      <div class="btn-row two">
        <button type="button" class="btn secondary" id="btn-receipt">Struk</button>
        <button type="button" class="btn" id="btn-done">Selesai</button>
      </div>
    </div>`, { dismissible: false });
  el.querySelector('#btn-done').addEventListener('click', () => { close(); onPaid && onPaid(t); });
  el.querySelector('#btn-receipt').addEventListener('click', () => openReceipt(t.id));
}
