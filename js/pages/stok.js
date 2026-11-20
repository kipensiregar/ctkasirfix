// Stok: produk, stok masuk/keluar/penyesuaian, riwayat pergerakan, kategori.
// Tab lewat URL: #/stok, #/stok?tab=riwayat, #/stok?tab=kategori
import { listProducts, listCategories, saveProduct, deleteProduct } from '../services/products.js';
import {
  recordStock, listMovements, MOVE_LABELS, addCategory, renameCategory, deleteCategory,
} from '../services/stock.js';
import { esc, toast, rupiah, parseMoney, openModal, formatDateTime } from '../ui.js';

const LOW = 5;
const fmtNum = (n) => new Intl.NumberFormat('id-ID').format(n);
const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export async function render(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = ['produk', 'riwayat', 'kategori'].includes(params.get('tab')) ? params.get('tab') : 'produk';
  const [products, categories] = await Promise.all([listProducts(), listCategories()]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  view.innerHTML = `
    <div class="page-head">
      <h1>Stok</h1>
      ${tab === 'produk' ? '<button type="button" class="btn" id="btn-add">+ Tambah produk</button>' : ''}
      ${tab === 'kategori' ? '<button type="button" class="btn" id="btn-add-cat">+ Tambah kategori</button>' : ''}
    </div>
    <nav class="seg" aria-label="Bagian stok">
      <a href="#/stok" class="${tab === 'produk' ? 'active' : ''}">Produk</a>
      <a href="#/stok?tab=riwayat" class="${tab === 'riwayat' ? 'active' : ''}">Riwayat Stok</a>
      <a href="#/stok?tab=kategori" class="${tab === 'kategori' ? 'active' : ''}">Kategori</a>
    </nav>
    <div id="stok-body"></div>`;
  const body = view.querySelector('#stok-body');

  if (tab === 'produk') renderProducts(body, view, products, categories, catName);
  else if (tab === 'riwayat') await renderHistory(body, products);
  else renderCategories(body, view, products, categories);
}

// =====================================================================
// PRODUK
// =====================================================================
function renderProducts(body, view, products, categories, catName) {
  const tracked = products.filter((p) => p.trackStock);
  const low = tracked.filter((p) => p.stock > 0 && p.stock <= LOW);
  const empty = tracked.filter((p) => p.stock <= 0);
  const filter = { q: '', mode: 'all' };

  body.innerHTML = `
    <div class="stat-row">
      <button type="button" class="stat" data-mode="all"><span class="stat-num">${products.length}</span><span>Produk</span></button>
      <button type="button" class="stat warn" data-mode="low"><span class="stat-num">${low.length}</span><span>Stok menipis (≤${LOW})</span></button>
      <button type="button" class="stat bad" data-mode="empty"><span class="stat-num">${empty.length}</span><span>Stok habis</span></button>
    </div>
    <input type="search" id="prod-search" class="search" placeholder="Cari produk…" autocomplete="off">
    <div class="card list-card" id="prod-list"></div>`;

  const listEl = body.querySelector('#prod-list');
  const renderList = () => {
    const s = filter.q.trim().toLowerCase();
    body.querySelectorAll('.stat').forEach((b) => b.classList.toggle('active', b.dataset.mode === filter.mode));
    const rows = products.filter((p) =>
      (!s || p.name.toLowerCase().includes(s)) &&
      (filter.mode === 'all' ||
        (filter.mode === 'low' && p.trackStock && p.stock > 0 && p.stock <= LOW) ||
        (filter.mode === 'empty' && p.trackStock && p.stock <= 0)));
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted" style="text-align:center;padding:24px;margin:0">${
        products.length ? 'Tidak ada produk yang cocok.' : 'Belum ada produk. Ketuk “Tambah produk”.'}</p>`;
      return;
    }
    listEl.innerHTML = rows.map((p) => {
      const st = !p.trackStock ? '' : p.stock <= 0 ? 'bad' : p.stock <= LOW ? 'warn' : 'ok';
      return `
      <div class="prod-row">
        <button type="button" class="list-row" data-edit="${esc(p.id)}">
          <span class="lr-main">
            <span class="lr-title">${esc(p.name)}</span>
            <span class="small muted">${esc(catName.get(p.categoryId) || 'Tanpa kategori')} · ${rupiah(p.price)}${
              p.cost != null ? ` · modal ${rupiah(p.cost)}` : ''}</span>
          </span>
          <span class="lr-side">
            ${p.trackStock ? `<span class="badge ${st}">Stok ${fmtNum(p.stock)}</span>` : '<span class="small muted">Stok tidak dihitung</span>'}
          </span>
        </button>
        ${p.trackStock ? `<button type="button" class="btn secondary btn-stock" data-stock="${esc(p.id)}">± Stok</button>` : ''}
      </div>`;
    }).join('');
  };
  renderList();

  body.querySelector('#prod-search').addEventListener('input', (e) => { filter.q = e.target.value; renderList(); });
  body.querySelectorAll('.stat').forEach((b) => b.addEventListener('click', () => { filter.mode = b.dataset.mode; renderList(); }));
  view.querySelector('#btn-add').addEventListener('click', () => openProductForm(null, categories, catName));
  listEl.addEventListener('click', (e) => {
    const st = e.target.closest('[data-stock]');
    if (st) { openStockForm(products.find((p) => p.id === st.dataset.stock)); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) openProductForm(products.find((p) => p.id === ed.dataset.edit), categories, catName);
  });
}

function moneyInputs(el) {
  el.querySelectorAll('input.money').forEach((inp) => inp.addEventListener('input', () => {
    inp.value = inp.value.trim() === '' ? '' : fmtNum(parseMoney(inp.value));
  }));
}

function openProductForm(p, categories, catName) {
  const fmt = (n) => (n == null ? '' : fmtNum(n));
  const tracked = !!p?.trackStock;
  const { el, close } = openModal(`
    <div class="modal-head"><h2>${p ? 'Edit produk' : 'Tambah produk'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
    <form id="pf" autocomplete="off">
      <label for="pf-name">Nama produk</label>
      <input id="pf-name" type="text" maxlength="80" required value="${esc(p?.name || '')}">
      <label for="pf-cat">Kategori</label>
      <input id="pf-cat" type="text" maxlength="40" list="pf-cats" placeholder="mis. Makanan, Minuman"
        value="${esc(p ? catName.get(p.categoryId) || '' : '')}">
      <datalist id="pf-cats">${categories.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <div class="form-2">
        <div><label for="pf-price">Harga jual (Rp)</label>
          <input id="pf-price" type="text" inputmode="numeric" class="money" required value="${fmt(p?.price)}"></div>
        <div><label for="pf-cost">Harga modal (Rp, opsional)</label>
          <input id="pf-cost" type="text" inputmode="numeric" class="money" value="${fmt(p?.cost)}"></div>
      </div>
      <label class="toggle" for="pf-track">
        <span class="toggle-text">
          <span class="toggle-title">Hitung stok</span>
          <span class="toggle-sub">Untuk produk yang jumlahnya terbatas, mis. minuman kemasan</span>
        </span>
        <input type="checkbox" class="switch" id="pf-track" ${tracked ? 'checked' : ''}>
      </label>
      ${tracked ? `
        <p class="small muted" id="pf-stock-info">Stok saat ini <b>${fmtNum(p.stock)}</b>. Ubah lewat tombol <b>± Stok</b> agar tercatat di riwayat.</p>` : `
        <div id="pf-stock-wrap" hidden>
          <label for="pf-stock">Stok awal</label>
          <input id="pf-stock" type="text" inputmode="numeric" class="money" value="0">
        </div>`}
      <div class="btn-row">
        <button type="submit" class="btn" id="pf-save">Simpan</button>
        ${p ? '<button type="button" class="btn danger" id="pf-del">Hapus</button>' : ''}
      </div>
    </form>`);

  moneyInputs(el);
  const track = el.querySelector('#pf-track');
  track.addEventListener('change', () => {
    const wrap = el.querySelector('#pf-stock-wrap');
    if (wrap) wrap.hidden = !track.checked;
    const info = el.querySelector('#pf-stock-info');
    if (info) info.hidden = !track.checked;
  });

  el.querySelector('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#pf-save');
    btn.disabled = true;
    const val = (id) => el.querySelector(id)?.value.trim() ?? '';
    try {
      await saveProduct({
        id: p?.id,
        name: val('#pf-name'),
        categoryName: val('#pf-cat'),
        price: val('#pf-price') === '' ? '' : parseMoney(val('#pf-price')),
        cost: val('#pf-cost') === '' ? '' : parseMoney(val('#pf-cost')),
        trackStock: track.checked,
        stock: val('#pf-stock') === '' ? '' : parseMoney(val('#pf-stock')),
      });
      close();
      toast('Produk tersimpan.');
      reload();
    } catch (err) {
      toast(err.message, { error: true, ms: 5000 });
      btn.disabled = false;
    }
  });

  el.querySelector('#pf-del')?.addEventListener('click', async () => {
    if (!confirm(`Hapus produk "${p.name}"?\nRiwayat transaksi yang sudah ada tidak berubah.`)) return;
    try {
      await deleteProduct(p.id);
      close();
      toast('Produk dihapus.');
      reload();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  setTimeout(() => { if (!el.contains(document.activeElement)) el.querySelector('#pf-name').focus(); }, 50);
}

const OUT_REASONS = ['Rusak', 'Basi / kedaluwarsa', 'Dipakai sendiri', 'Hilang'];

function openStockForm(p) {
  const { el, close } = openModal(`
    <div class="modal-head"><div><h2>${esc(p.name)}</h2>
      <div class="small muted">Stok tercatat: <b>${fmtNum(p.stock)}</b></div></div>
      <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
    <div class="seg seg-3" id="sf-type">
      <button type="button" data-type="in" class="active">Masuk</button>
      <button type="button" data-type="out">Keluar</button>
      <button type="button" data-type="adjust">Penyesuaian</button>
    </div>
    <label for="sf-qty" id="sf-qty-label">Jumlah masuk</label>
    <input id="sf-qty" type="text" inputmode="numeric" class="money money-input" autocomplete="off" placeholder="0">
    <p class="small muted" id="sf-hint"></p>
    <div class="quick-cash" id="sf-reasons" hidden>
      ${OUT_REASONS.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <label for="sf-note">Keterangan (opsional)</label>
    <input id="sf-note" type="text" maxlength="120" autocomplete="off" placeholder="mis. Belanja pasar">
    <div class="btn-row"><button type="button" class="btn btn-pay" id="sf-save" disabled>Simpan</button></div>`);

  let type = 'in';
  const qty = el.querySelector('#sf-qty');
  const hint = el.querySelector('#sf-hint');
  const save = el.querySelector('#sf-save');
  const note = el.querySelector('#sf-note');
  moneyInputs(el);

  const update = () => {
    const raw = qty.value.trim();
    const n = parseMoney(raw);
    let after = null;
    if (raw !== '') {
      if (type === 'in') after = p.stock + n;
      else if (type === 'out') after = p.stock - n;
      else after = n;
    }
    const valid = raw !== '' && (type === 'adjust' ? n !== p.stock : n > 0) && after >= 0;
    if (after === null) hint.textContent = '';
    else if (after < 0) hint.innerHTML = `<span class="text-bad">Melebihi stok tersedia (${fmtNum(p.stock)}).</span>`;
    else if (type === 'adjust') {
      const d = n - p.stock;
      hint.innerHTML = d === 0 ? 'Sama dengan stok tercatat.' :
        `Selisih <b>${d > 0 ? '+' : ''}${fmtNum(d)}</b> → stok menjadi <b>${fmtNum(after)}</b>`;
    } else hint.innerHTML = `Stok menjadi <b>${fmtNum(after)}</b>`;
    save.disabled = !valid;
  };

  el.querySelector('#sf-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    type = b.dataset.type;
    el.querySelectorAll('#sf-type button').forEach((x) => x.classList.toggle('active', x === b));
    el.querySelector('#sf-qty-label').textContent =
      { in: 'Jumlah masuk', out: 'Jumlah keluar', adjust: 'Jumlah stok fisik sebenarnya' }[type];
    el.querySelector('#sf-reasons').hidden = type !== 'out';
    note.placeholder = { in: 'mis. Belanja pasar', out: 'Alasan barang keluar', adjust: 'mis. Hasil hitung ulang' }[type];
    update();
    qty.focus();
  });
  el.querySelector('#sf-reasons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reason]');
    if (b) note.value = b.dataset.reason;
  });
  qty.addEventListener('input', update);

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const m = await recordStock(p.id, type, parseMoney(qty.value), note.value);
      close();
      toast(`${MOVE_LABELS[m.type]} ${p.name}: stok sekarang ${fmtNum(m.stockAfter)}.`);
      reload();
    } catch (err) {
      toast(err.message, { error: true, ms: 5000 });
      update();
    }
  });
  setTimeout(() => { if (!el.contains(document.activeElement)) qty.focus(); }, 50);
}

// =====================================================================
// RIWAYAT STOK
// =====================================================================
async function renderHistory(body, products) {
  const all = await listMovements();
  const names = new Map();
  for (const m of all) if (!names.has(m.productId)) names.set(m.productId, m.productName);
  for (const p of products) names.set(p.id, p.name);
  const opts = [...names].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'id'));
  const PAGE = 100;
  const f = { productId: '', type: '', limit: PAGE };

  body.innerHTML = `
    <div class="filter-row">
      <select id="h-prod" aria-label="Produk"><option value="">Semua produk</option>
        ${opts.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('')}</select>
      <select id="h-type" aria-label="Jenis"><option value="">Semua jenis</option>
        ${Object.entries(MOVE_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    </div>
    <div class="card list-card" id="h-list"></div>
    <div class="btn-row" style="justify-content:center"><button type="button" class="btn secondary" id="h-more" hidden>Tampilkan lebih banyak</button></div>`;

  const listEl = body.querySelector('#h-list');
  const more = body.querySelector('#h-more');
  const draw = () => {
    const rows = all.filter((m) => (!f.productId || m.productId === f.productId) && (!f.type || m.type === f.type));
    more.hidden = rows.length <= f.limit;
    if (!rows.length) {
      listEl.innerHTML = '<p class="muted" style="text-align:center;padding:24px;margin:0">Belum ada pergerakan stok.</p>';
      return;
    }
    listEl.innerHTML = rows.slice(0, f.limit).map((m) => `
      <div class="move-row">
        <span class="lr-main">
          <span class="lr-title">${esc(m.productName || names.get(m.productId) || '—')}</span>
          <span class="small muted">${esc(MOVE_LABELS[m.type] || m.type)} · ${formatDateTime(m.createdAt)}${m.note && m.note !== MOVE_LABELS[m.type] ? ` · ${esc(m.note)}` : ''}</span>
        </span>
        <span class="lr-side">
          <b class="${m.qty > 0 ? 'text-ok' : m.qty < 0 ? 'text-bad' : ''}">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</b>
          <span class="small muted">sisa ${fmtNum(m.stockAfter)}</span>
        </span>
      </div>`).join('');
  };
  body.querySelector('#h-prod').addEventListener('change', (e) => { f.productId = e.target.value; f.limit = PAGE; draw(); });
  body.querySelector('#h-type').addEventListener('change', (e) => { f.type = e.target.value; f.limit = PAGE; draw(); });
  more.addEventListener('click', () => { f.limit += PAGE; draw(); });
  draw();
}

// =====================================================================
// KATEGORI
// =====================================================================
function renderCategories(body, view, products, categories) {
  const count = (id) => products.filter((p) => p.categoryId === id).length;
  const none = products.filter((p) => !p.categoryId).length;
  body.innerHTML = `
    <div class="card list-card">${categories.length ? categories.map((c) => `
      <button type="button" class="list-row" data-cat="${esc(c.id)}">
        <span class="lr-main"><span class="lr-title">${esc(c.name)}</span></span>
        <span class="lr-side"><span class="small muted">${count(c.id)} produk</span></span>
      </button>`).join('') : '<p class="muted" style="text-align:center;padding:24px;margin:0">Belum ada kategori.</p>'}
    </div>
    ${none ? `<p class="small muted">${none} produk tanpa kategori.</p>` : ''}`;

  view.querySelector('#btn-add-cat').addEventListener('click', () => {
    const { el, close } = openModal(`
      <div class="modal-head"><h2>Tambah kategori</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
      <label for="cf-name">Nama kategori</label>
      <input id="cf-name" type="text" maxlength="40" autocomplete="off">
      <div class="btn-row"><button type="button" class="btn" id="cf-save">Simpan</button></div>`);
    el.querySelector('#cf-save').addEventListener('click', async () => {
      try { await addCategory(el.querySelector('#cf-name').value); close(); toast('Kategori ditambahkan.'); reload(); }
      catch (err) { toast(err.message, { error: true }); }
    });
    setTimeout(() => { if (!el.contains(document.activeElement)) el.querySelector('#cf-name').focus(); }, 50);
  });

  body.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    const c = categories.find((x) => x.id === b.dataset.cat);
    const n = count(c.id);
    const { el, close } = openModal(`
      <div class="modal-head"><h2>Edit kategori</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
      <label for="cf-name">Nama kategori</label>
      <input id="cf-name" type="text" maxlength="40" autocomplete="off" value="${esc(c.name)}">
      <div class="btn-row">
        <button type="button" class="btn" id="cf-save">Simpan</button>
        <button type="button" class="btn danger" id="cf-del">Hapus</button>
      </div>`);
    el.querySelector('#cf-save').addEventListener('click', async () => {
      try { await renameCategory(c.id, el.querySelector('#cf-name').value); close(); toast('Kategori diperbarui.'); reload(); }
      catch (err) { toast(err.message, { error: true }); }
    });
    el.querySelector('#cf-del').addEventListener('click', async () => {
      if (!confirm(`Hapus kategori "${c.name}"?${n ? `\n${n} produk akan menjadi "Tanpa kategori".` : ''}`)) return;
      try { await deleteCategory(c.id); close(); toast('Kategori dihapus.'); reload(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }));
}
