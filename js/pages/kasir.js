// Kasir: mencatat pesanan lalu mengirimnya ke dapur. Pembayaran dilakukan di Antrean.
// Mode tambahan (Koreksi): #/kasir?tambah=<transactionId>
import { getSetting, setSetting, get } from '../db.js';
import { listProducts, listCategories } from '../services/products.js';
import { sendToKitchen, listOpenTransactions, whoLine } from '../services/sales.js';
import { esc, toast, rupiah, openModal } from '../ui.js';

const DRAFT_KEY = 'cartDraft';
const DRAFT_ADD_KEY = 'cartDraftAdd';

export async function render(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const addToId = params.get('tambah');

  // ---- Mode tambahan: pastikan pesanan masih terbuka ----
  let target = null;
  if (addToId) {
    target = await get('transactions', addToId);
    if (!target || target.status !== 'open') {
      toast('Pesanan itu sudah dibayar atau tidak ada.', { error: true });
      location.hash = '#/antrean';
      return;
    }
  }

  const draftKey = target ? DRAFT_ADD_KEY : DRAFT_KEY;
  const [products, categories, rawDraft] = await Promise.all([
    listProducts(), listCategories(), getSetting(draftKey, null),
  ]);
  // Draf tambahan hanya berlaku untuk pesanan yang sama.
  const draft = target && rawDraft?.transactionId !== target.id ? null : rawDraft;

  const productById = new Map(products.map((p) => [p.id, p]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const usedCats = categories.filter((c) => products.some((p) => p.categoryId === c.id));
  // Warna lembut per kategori (daun, kunyit, cabai, terong, kecap, laut).
  const TINTS = [
    ['#e3f4ea', '#17723f'], ['#fdf0cf', '#94640a'], ['#fde3dc', '#ad3720'],
    ['#eee6f7', '#6a4697'], ['#f1e7dd', '#70492b'], ['#dff0f5', '#1d6b85'],
  ];
  const tintOf = new Map(categories.map((c, i) => [c.id, TINTS[i % TINTS.length]]));

  const state = {
    cart: new Map(), // productId -> { qty, note }
    cat: 'all',
    q: '',
    tableNo: target ? target.tableNo : String(draft?.tableNo || ''),
    customerName: target ? target.customerName : String(draft?.customerName || ''),
  };
  for (const it of draft?.items || []) {
    if (productById.has(it.productId) && Number.isInteger(it.qty) && it.qty > 0) {
      state.cart.set(it.productId, { qty: it.qty, note: String(it.note || '') });
    }
  }

  if (!products.length) {
    view.innerHTML = `
      <div class="card placeholder">
        <div class="ph-icon">🧾</div>
        <p><b>Belum ada produk.</b></p>
        <p class="small">Tambahkan produk di halaman Stok terlebih dahulu.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn" href="#/stok">Tambah produk</a></div>
      </div>`;
    return;
  }

  view.innerHTML = `
    <div class="pos">
      <section class="pos-catalog">
        <input type="search" id="pos-search" class="search" placeholder="Cari produk…" autocomplete="off" enterkeyhint="search">
        <div class="chips" id="pos-cats">
          <button type="button" class="chip" data-cat="all">Semua</button>
          ${usedCats.map((c) => `<button type="button" class="chip" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        </div>
        <div class="product-grid" id="pos-grid"></div>
      </section>
      <aside class="pos-cart card${target ? ' add-mode' : ''}">
        ${target ? `
        <div class="add-banner">
          <div>
            <div class="small">Tambahan untuk</div>
            <div class="add-who">${esc(whoLine(target))} <span class="muted small">#${esc(target.queueNo)}</span></div>
          </div>
          <a class="btn secondary" href="#/antrean" id="add-cancel">Batal</a>
        </div>` : `
        <div class="cart-head">
          <h2>Pesanan</h2>
          <button type="button" class="link-btn" id="cart-clear">Kosongkan</button>
        </div>
        <div class="cart-who">
          <div class="who-table">
            <label for="cart-table">No. meja</label>
            <input id="cart-table" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="—">
          </div>
          <div class="who-name">
            <label for="cart-name">Nama pemesan</label>
            <input id="cart-name" type="text" maxlength="60" autocomplete="off" placeholder="mis. Bu Rina">
          </div>
        </div>`}
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-foot">
          ${target ? `<div class="cart-row"><span class="muted">Pesanan sebelumnya</span><span>${rupiah(target.total)}</span></div>` : ''}
          <div class="cart-row"><span class="muted">${target ? 'Tambahan' : 'Jumlah item'}</span><span id="cart-count">0</span></div>
          <div class="cart-row total"><span>${target ? 'Total baru' : 'Total'}</span><span id="cart-total">Rp0</span></div>
          <button type="button" class="btn btn-pay" id="btn-send">${target ? 'Kirim Tambahan ke Dapur' : 'Kirim ke Dapur'}</button>
        </div>
      </aside>
    </div>`;

  const grid = view.querySelector('#pos-grid');
  const cartEl = view.querySelector('#cart-items');

  // ---------- Draf (keranjang tahan refresh) ----------
  let draftTimer = null;
  const saveDraftNow = () => {
    clearTimeout(draftTimer);
    draftTimer = null;
    const items = [...state.cart].map(([productId, l]) => ({ productId, qty: l.qty, note: l.note }));
    let value = null;
    if (target) {
      if (items.length) value = { transactionId: target.id, items };
    } else if (items.length || state.tableNo.trim() || state.customerName.trim()) {
      value = { items, tableNo: state.tableNo, customerName: state.customerName };
    }
    return setSetting(draftKey, value).catch(() => {});
  };
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 250);
  };

  const totals = () => {
    let total = 0, count = 0;
    for (const [id, l] of state.cart) {
      const p = productById.get(id);
      if (p) { total += p.price * l.qty; count += l.qty; }
    }
    return { total, count };
  };

  // ---------- Katalog ----------
  const renderGrid = () => {
    const q = state.q.trim().toLowerCase();
    const list = products.filter((p) =>
      (state.cat === 'all' || p.categoryId === state.cat) &&
      (!q || p.name.toLowerCase().includes(q)));
    view.querySelectorAll('#pos-cats .chip').forEach((b) => b.classList.toggle('active', b.dataset.cat === state.cat));
    if (!list.length) {
      grid.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center;padding:30px">Produk tidak ditemukan.</p>`;
      return;
    }
    grid.innerHTML = list.map((p) => {
      const inCart = state.cart.get(p.id)?.qty || 0;
      const left = p.trackStock ? (p.stock ?? 0) - inCart : null;
      const out = p.trackStock && left <= 0;
      const cat = p.categoryId ? catById.get(p.categoryId)?.name : '';
      const [tint, tintInk] = tintOf.get(p.categoryId) || TINTS[0];
      return `
        <button type="button" class="product-card${inCart ? ' in-cart' : ''}${out ? ' out' : ''}" data-add="${esc(p.id)}"
          style="--tint:${tint};--tint-ink:${tintInk}">
          ${inCart ? `<span class="qty-badge">${inCart}</span>` : ''}
          <span class="pc-initial">${esc(p.name.trim().charAt(0).toUpperCase())}</span>
          <span class="pc-name">${esc(p.name)}</span>
          ${cat ? `<span class="pc-cat">${esc(cat)}</span>` : ''}
          <span class="pc-price">${rupiah(p.price)}</span>
          ${p.trackStock ? `<span class="pc-stock${left <= 5 ? ' low' : ''}">${out ? 'Stok habis' : `Stok ${left}`}</span>` : ''}
        </button>`;
    }).join('');
  };

  // ---------- Keranjang ----------
  const renderCart = () => {
    if (!state.cart.size) {
      cartEl.innerHTML = `<p class="muted cart-empty">Ketuk produk untuk menambahkan ke pesanan.</p>`;
    } else {
      cartEl.innerHTML = [...state.cart].map(([id, l]) => {
        const p = productById.get(id);
        return `
          <div class="cart-item">
            <div class="ci-info">
              <div class="ci-name">${esc(p.name)}</div>
              <div class="ci-price muted small">${rupiah(p.price)}</div>
            </div>
            <div class="ci-sub">${rupiah(p.price * l.qty)}</div>
            <div class="stepper">
              <button type="button" data-dec="${esc(id)}" aria-label="Kurangi">−</button>
              <span>${l.qty}</span>
              <button type="button" data-inc="${esc(id)}" aria-label="Tambah">+</button>
            </div>
            <input type="text" class="ci-note" data-note="${esc(id)}" maxlength="120"
              placeholder="Catatan… (mis. pedas, tanpa bawang)" value="${esc(l.note)}" autocomplete="off">
          </div>`;
      }).join('');
    }
    const { total, count } = totals();
    view.querySelector('#cart-count').textContent = target ? rupiah(total) : count;
    view.querySelector('#cart-total').textContent = rupiah(target ? target.total + total : total);
    view.querySelector('#btn-send').disabled = count === 0;
    const clear = view.querySelector('#cart-clear');
    if (clear) clear.hidden = count === 0 && !state.tableNo && !state.customerName;
  };

  const refresh = () => { renderGrid(); renderCart(); saveDraft(); };

  const add = (id, delta) => {
    const p = productById.get(id);
    if (!p) return;
    const line = state.cart.get(id) || { qty: 0, note: '' };
    const next = line.qty + delta;
    if (delta > 0 && p.trackStock && next > (p.stock ?? 0)) {
      toast(`Stok ${p.name} tidak cukup (sisa ${p.stock ?? 0}).`, { error: true });
      return;
    }
    if (next <= 0) state.cart.delete(id);
    else state.cart.set(id, { ...line, qty: next });
    refresh();
  };

  // ---------- Event ----------
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) add(b.dataset.add, 1);
  });
  cartEl.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) add(inc.dataset.inc, 1);
    if (dec) add(dec.dataset.dec, -1);
  });
  cartEl.addEventListener('input', (e) => {
    const n = e.target.closest('[data-note]');
    if (!n) return;
    const line = state.cart.get(n.dataset.note);
    if (line) { line.note = n.value; saveDraft(); }
  });
  view.querySelector('#pos-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) { state.cat = b.dataset.cat; renderGrid(); }
  });
  view.querySelector('#pos-search').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });

  const tableInput = view.querySelector('#cart-table');
  const nameInput = view.querySelector('#cart-name');
  if (tableInput) {
    tableInput.value = state.tableNo;
    nameInput.value = state.customerName;
    tableInput.addEventListener('input', () => { state.tableNo = tableInput.value; saveDraft(); renderCart(); });
    nameInput.addEventListener('input', () => { state.customerName = nameInput.value; saveDraft(); renderCart(); });
  }

  view.querySelector('#cart-clear')?.addEventListener('click', () => {
    if (!confirm('Kosongkan pesanan ini?')) return;
    state.cart.clear();
    state.tableNo = state.customerName = '';
    tableInput.value = nameInput.value = '';
    refresh();
  });
  view.querySelector('#add-cancel')?.addEventListener('click', () => {
    state.cart.clear();
    saveDraftNow();
  });

  // ---------- Kirim ke dapur ----------
  const sendBtn = view.querySelector('#btn-send');
  let sending = false;

  async function doSend(transactionId) {
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Mengirim…';
    try {
      const { transaction: t } = await sendToKitchen(
        [...state.cart].map(([productId, l]) => ({ productId, qty: l.qty, note: l.note })),
        { tableNo: state.tableNo, customerName: state.customerName, transactionId });
      state.cart.clear();
      if (!target) state.tableNo = state.customerName = '';
      await saveDraftNow();
      window.dispatchEvent(new Event('ct:data-changed'));
      if (target || transactionId) {
        toast(`Tambahan ${whoLine(t)} dikirim ke dapur.`);
        location.hash = '#/antrean';
      } else {
        toast(`Pesanan #${t.queueNo} · ${whoLine(t)} dikirim ke dapur.`, { ms: 4000 });
        window.dispatchEvent(new HashChangeEvent('hashchange')); // muat ulang (stok terbaru)
      }
    } catch (err) {
      toast(err.message || 'Gagal mengirim pesanan.', { error: true, ms: 6000 });
      sending = false;
      sendBtn.textContent = target ? 'Kirim Tambahan ke Dapur' : 'Kirim ke Dapur';
      renderCart();
    }
  }

  sendBtn.addEventListener('click', async () => {
    if (sending || !state.cart.size) return;
    if (target) { doSend(target.id); return; }

    if (!state.tableNo.trim() && !state.customerName.trim()) {
      toast('Isi nomor meja atau nama pemesan dulu.', { error: true });
      tableInput.focus();
      return;
    }
    // Meja yang sama masih punya pesanan belum bayar → tawarkan untuk digabung.
    const table = state.tableNo.trim();
    if (table) {
      const open = (await listOpenTransactions()).filter((t) => (t.tableNo || '').toLowerCase() === table.toLowerCase());
      if (open.length) {
        const t = open[open.length - 1];
        const { el, close } = openModal(`
          <div class="modal-head"><h2>Meja ${esc(table)} belum bayar</h2>
            <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
          <p>Meja ini masih punya pesanan <b>#${esc(t.queueNo)}</b>${t.customerName ? ` (${esc(t.customerName)})` : ''}
             senilai <b>${rupiah(t.total)}</b>.</p>
          <div class="btn-col">
            <button type="button" class="btn" id="m-join">Tambahkan ke pesanan #${esc(t.queueNo)}</button>
            <button type="button" class="btn secondary" id="m-new">Buat pesanan terpisah</button>
          </div>`);
        el.querySelector('#m-join').onclick = () => { close(); doSend(t.id); };
        el.querySelector('#m-new').onclick = () => { close(); doSend(undefined); };
        return;
      }
    }
    doSend(undefined);
  });

  refresh();
  const flush = () => { if (draftTimer) saveDraftNow(); };
  window.addEventListener('pagehide', flush);
  return () => { flush(); window.removeEventListener('pagehide', flush); };
}
