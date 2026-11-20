// Stok — tahap awal: daftar produk (tambah, edit, hapus).
// Stok masuk/keluar & riwayat pergerakan menyusul.
import { listProducts, listCategories, saveProduct, deleteProduct } from '../services/products.js';
import { esc, toast, rupiah, parseMoney, openModal } from '../ui.js';

export async function render(view) {
  const [products, categories] = await Promise.all([listProducts(), listCategories()]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  view.innerHTML = `
    <div class="page-head">
      <h1>Produk</h1>
      <button type="button" class="btn" id="btn-add">+ Tambah produk</button>
    </div>
    <input type="search" id="prod-search" class="search" placeholder="Cari produk…" autocomplete="off">
    <div class="card list-card" id="prod-list"></div>
    <p class="small muted">Stok masuk/keluar dan riwayat pergerakan stok akan ditambahkan di tahap modul Stok.</p>`;

  const listEl = view.querySelector('#prod-list');
  const renderList = (q = '') => {
    const s = q.trim().toLowerCase();
    const rows = products.filter((p) => !s || p.name.toLowerCase().includes(s));
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted" style="text-align:center;padding:24px;margin:0">${
        products.length ? 'Produk tidak ditemukan.' : 'Belum ada produk. Ketuk “Tambah produk”.'}</p>`;
      return;
    }
    listEl.innerHTML = rows.map((p) => `
      <button type="button" class="list-row" data-edit="${esc(p.id)}">
        <span class="lr-main">
          <span class="lr-title">${esc(p.name)}</span>
          <span class="small muted">${esc(catName.get(p.categoryId) || 'Tanpa kategori')}${
            p.cost != null ? ` · modal ${rupiah(p.cost)}` : ''}</span>
        </span>
        <span class="lr-side">
          <b>${rupiah(p.price)}</b>
          <span class="small ${p.trackStock && p.stock <= 5 ? 'text-warn' : 'muted'}">${
            p.trackStock ? `Stok ${p.stock}` : 'Stok tidak dihitung'}</span>
        </span>
      </button>`).join('');
  };
  renderList();

  view.querySelector('#prod-search').addEventListener('input', (e) => renderList(e.target.value));
  view.querySelector('#btn-add').addEventListener('click', () => openForm(null));
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) openForm(products.find((p) => p.id === b.dataset.edit));
  });

  function openForm(p) {
    const fmt = (n) => (n == null ? '' : new Intl.NumberFormat('id-ID').format(n));
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
        <label class="check"><input type="checkbox" id="pf-track" ${p?.trackStock ? 'checked' : ''}> Hitung stok produk ini</label>
        <div id="pf-stock-wrap" ${p?.trackStock ? '' : 'hidden'}>
          <label for="pf-stock">Stok tersedia</label>
          <input id="pf-stock" type="text" inputmode="numeric" class="money" value="${fmt(p?.trackStock ? p.stock : 0)}">
        </div>
        <div class="btn-row">
          <button type="submit" class="btn" id="pf-save">Simpan</button>
          ${p ? '<button type="button" class="btn danger" id="pf-del">Hapus</button>' : ''}
        </div>
      </form>`);

    el.querySelectorAll('input.money').forEach((inp) => inp.addEventListener('input', () => {
      const v = parseMoney(inp.value);
      inp.value = inp.value.trim() === '' ? '' : new Intl.NumberFormat('id-ID').format(v);
    }));
    const track = el.querySelector('#pf-track');
    track.addEventListener('change', () => { el.querySelector('#pf-stock-wrap').hidden = !track.checked; });

    el.querySelector('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#pf-save');
      btn.disabled = true;
      const val = (id) => el.querySelector(id).value.trim();
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
        window.dispatchEvent(new HashChangeEvent('hashchange'));
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
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
    setTimeout(() => { if (!el.contains(document.activeElement)) el.querySelector('#pf-name').focus(); }, 50);
  }
}
