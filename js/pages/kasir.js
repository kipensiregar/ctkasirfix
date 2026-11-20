import { getSetting, setSetting } from '../db.js';
import { listProducts, listCategories } from '../services/products.js';
import { checkout } from '../services/sales.js';
import { esc, toast, rupiah, parseMoney, openModal } from '../ui.js';

const DRAFT_KEY = 'cartDraft';

export async function render(view) {
  const [products, categories, draft] = await Promise.all([
    listProducts(), listCategories(), getSetting(DRAFT_KEY, null),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const usedCats = categories.filter((c) => products.some((p) => p.categoryId === c.id));

  const state = {
    cart: new Map(), // productId -> qty (urutan sesuai saat ditambahkan)
    cat: 'all',
    q: '',
  };
  // Pulihkan keranjang yang belum dibayar (mis. setelah refresh / aplikasi tertutup).
  if (draft && Array.isArray(draft.items)) {
    for (const { productId, qty } of draft.items) {
      if (productById.has(productId) && Number.isInteger(qty) && qty > 0) state.cart.set(productId, qty);
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
      <aside class="pos-cart card">
        <div class="cart-head">
          <h2>Pesanan</h2>
          <button type="button" class="link-btn" id="cart-clear">Kosongkan</button>
        </div>
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-foot">
          <div class="cart-row"><span class="muted">Jumlah item</span><span id="cart-count">0</span></div>
          <div class="cart-row total"><span>Total</span><span id="cart-total">Rp0</span></div>
          <button type="button" class="btn btn-pay" id="btn-pay">Bayar</button>
        </div>
      </aside>
    </div>`;

  const grid = view.querySelector('#pos-grid');
  const cartEl = view.querySelector('#cart-items');

  // ---------- Draf ----------
  let draftTimer = null;
  const saveDraftNow = () => {
    clearTimeout(draftTimer);
    draftTimer = null;
    const items = [...state.cart].map(([productId, qty]) => ({ productId, qty }));
    return setSetting(DRAFT_KEY, items.length ? { items } : null).catch(() => {});
  };
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 250);
  };

  // ---------- Perhitungan ----------
  const totals = () => {
    let total = 0, count = 0;
    for (const [id, qty] of state.cart) {
      const p = productById.get(id);
      if (p) { total += p.price * qty; count += qty; }
    }
    return { total, count };
  };

  // ---------- Render katalog ----------
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
      const inCart = state.cart.get(p.id) || 0;
      const left = p.trackStock ? (p.stock ?? 0) - inCart : null;
      const out = p.trackStock && left <= 0;
      const cat = p.categoryId ? catById.get(p.categoryId)?.name : '';
      return `
        <button type="button" class="product-card${inCart ? ' in-cart' : ''}${out ? ' out' : ''}" data-add="${esc(p.id)}">
          ${inCart ? `<span class="qty-badge">${inCart}</span>` : ''}
          <span class="pc-initial">${esc(p.name.trim().charAt(0).toUpperCase())}</span>
          <span class="pc-name">${esc(p.name)}</span>
          ${cat ? `<span class="pc-cat">${esc(cat)}</span>` : ''}
          <span class="pc-price">${rupiah(p.price)}</span>
          ${p.trackStock ? `<span class="pc-stock${left <= 5 ? ' low' : ''}">${out ? 'Stok habis' : `Stok ${left}`}</span>` : ''}
        </button>`;
    }).join('');
  };

  // ---------- Render keranjang ----------
  const renderCart = () => {
    if (!state.cart.size) {
      cartEl.innerHTML = `<p class="muted cart-empty">Ketuk produk untuk menambahkan ke pesanan.</p>`;
    } else {
      cartEl.innerHTML = [...state.cart].map(([id, qty]) => {
        const p = productById.get(id);
        return `
          <div class="cart-item">
            <div class="ci-info">
              <div class="ci-name">${esc(p.name)}</div>
              <div class="ci-price muted small">${rupiah(p.price)}</div>
            </div>
            <div class="stepper">
              <button type="button" data-dec="${esc(id)}" aria-label="Kurangi">−</button>
              <span>${qty}</span>
              <button type="button" data-inc="${esc(id)}" aria-label="Tambah">+</button>
            </div>
            <div class="ci-sub">${rupiah(p.price * qty)}</div>
          </div>`;
      }).join('');
    }
    const { total, count } = totals();
    view.querySelector('#cart-count').textContent = count;
    view.querySelector('#cart-total').textContent = rupiah(total);
    view.querySelector('#btn-pay').disabled = count === 0;
    view.querySelector('#cart-clear').hidden = count === 0;
  };

  const refresh = () => { renderGrid(); renderCart(); saveDraft(); };

  const add = (id, delta) => {
    const p = productById.get(id);
    if (!p) return;
    const next = (state.cart.get(id) || 0) + delta;
    if (delta > 0 && p.trackStock && next > (p.stock ?? 0)) {
      toast(`Stok ${p.name} tidak cukup (sisa ${p.stock ?? 0}).`, { error: true });
      return;
    }
    if (next <= 0) state.cart.delete(id);
    else state.cart.set(id, next);
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
  view.querySelector('#pos-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) { state.cat = b.dataset.cat; renderGrid(); }
  });
  view.querySelector('#pos-search').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
  view.querySelector('#cart-clear').addEventListener('click', () => {
    if (!state.cart.size || !confirm('Kosongkan semua item di pesanan ini?')) return;
    state.cart.clear();
    refresh();
  });
  view.querySelector('#btn-pay').addEventListener('click', () => openPayment());

  // ---------- Pembayaran ----------
  function openPayment() {
    const { total, count } = totals();
    if (!count) return;
    const suggestions = cashSuggestions(total);
    const { el, close } = openModal(`
      <div class="modal-head"><h2>Pembayaran Tunai</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
      <div class="pay-total"><span class="muted">Total</span><b>${rupiah(total)}</b></div>
      <label for="pay-cash">Uang diterima</label>
      <input id="pay-cash" type="text" inputmode="numeric" autocomplete="off" class="money-input" placeholder="0">
      <div class="quick-cash">
        ${suggestions.map((v, i) => `<button type="button" class="chip" data-cash="${v}">${i === 0 ? 'Uang pas' : rupiah(v)}</button>`).join('')}
      </div>
      <div class="pay-change"><span>Kembalian</span><b id="pay-change">—</b></div>
      <details class="pay-more">
        <summary>Nama pelanggan &amp; catatan (opsional)</summary>
        <label for="pay-name">Nama pelanggan</label>
        <input id="pay-name" type="text" maxlength="60" autocomplete="off">
        <label for="pay-note">Catatan untuk dapur</label>
        <textarea id="pay-note" maxlength="200"></textarea>
      </details>
      <button type="button" class="btn btn-pay" id="pay-submit" disabled>Simpan Transaksi</button>`);

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
        const res = await checkout(
          [...state.cart].map(([productId, qty]) => ({ productId, qty })),
          {
            cashReceived: parseMoney(cashInput.value),
            customerName: el.querySelector('#pay-name').value,
            note: el.querySelector('#pay-note').value,
          });
        state.cart.clear();
        await saveDraftNow();
        close();
        showSuccess(res);
      } catch (err) {
        toast(err.message || 'Transaksi gagal disimpan.', { error: true, ms: 6000 });
        saving = false;
        submit.textContent = 'Simpan Transaksi';
        update();
      }
    });
    setTimeout(() => { if (!el.contains(document.activeElement)) cashInput.focus(); }, 50);
  }

  function showSuccess({ transaction: t }) {
    const { el, close } = openModal(`
      <div class="success">
        <div class="success-icon">✓</div>
        <h2>Transaksi tersimpan</h2>
        <div class="queue-no">#${esc(t.queueNo)}</div>
        <p class="muted small">Pesanan sudah dikirim ke Dapur${t.customerName ? ` · ${esc(t.customerName)}` : ''}</p>
        <table class="simple">
          <tr><td>Total</td><td>${rupiah(t.total)}</td></tr>
          <tr><td>Tunai</td><td>${rupiah(t.cashReceived)}</td></tr>
        </table>
        <div class="pay-change big"><span>Kembalian</span><b>${rupiah(t.change)}</b></div>
        <button type="button" class="btn btn-pay" id="btn-new">Transaksi Baru</button>
      </div>`, { dismissible: false });
    el.querySelector('#btn-new').addEventListener('click', async () => {
      close();
      // Muat ulang halaman kasir lewat router (stok terbaru).
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  }

  refresh();
  // Saat pindah halaman: simpan draf yang masih tertunda.
  const flush = () => { if (draftTimer) saveDraftNow(); };
  window.addEventListener('pagehide', flush);
  return () => { flush(); window.removeEventListener('pagehide', flush); };
}

/** Saran uang tunai: uang pas lalu pecahan umum di atas total. */
function cashSuggestions(total) {
  const out = [total];
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 5);
}
