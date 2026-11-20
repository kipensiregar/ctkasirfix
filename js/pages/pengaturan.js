import { STORES, DB_VERSION, count, getSetting, setSetting } from '../db.js';
import { saveBackup, readBackupFile, restoreData } from '../backup.js';
import { isStandalone, isIOS, isPersisted, requestPersistence, estimate, formatBytes, getSWStatus } from '../storage.js';
import { APP_VERSION } from '../version.js';
import { esc, toast, formatDateTime, daysSince, removeBanner } from '../ui.js';

const STORE_LABELS = {
  products: 'Produk', categories: 'Kategori', transactions: 'Transaksi',
  transactionItems: 'Detail transaksi', orders: 'Pesanan dapur',
  stockMovements: 'Pergerakan stok', settings: 'Pengaturan',
};

const badge = (state, text) => `<span class="badge ${state}">${esc(text)}</span>`;

export async function render(view) {
  view.innerHTML = `
    <h1>Pengaturan</h1>
    <div class="grid-2">
      <section class="card" id="offline-card">
        <h2>Status Offline</h2>
        <ul class="status-list" id="offline-status"><li class="muted">Memeriksa…</li></ul>
        <div class="btn-row">
          <button class="btn secondary" type="button" id="btn-recheck">Periksa ulang</button>
        </div>
      </section>

      <section class="card">
        <h2>Identitas Usaha</h2>
        <form id="form-identity" autocomplete="off">
          <label for="f-name">Nama usaha</label>
          <input id="f-name" type="text" maxlength="60" required>
          <label for="f-address">Alamat</label>
          <textarea id="f-address" maxlength="200"></textarea>
          <label for="f-phone">Telepon</label>
          <input id="f-phone" type="tel" maxlength="20">
          <div class="btn-row"><button class="btn" type="submit">Simpan</button></div>
        </form>
      </section>

      <section class="card">
        <h2>Backup &amp; Restore</h2>
        <p class="small muted">Data hanya tersimpan di perangkat ini. Simpan file backup secara rutin
          ke app <b>Files</b>, iCloud Drive, atau kirim lewat AirDrop.</p>
        <p>Backup terakhir: <b id="last-backup">—</b></p>
        <div class="btn-row">
          <button class="btn" type="button" id="btn-backup">Buat backup</button>
          <label class="btn secondary file-btn" style="margin:0">
            Restore dari file
            <input type="file" id="file-restore" accept="application/json,.json">
          </label>
        </div>
      </section>

      <section class="card">
        <h2>Isi Database</h2>
        <table class="simple" id="db-counts"></table>
        <p class="small muted" style="margin-bottom:0">Versi aplikasi ${esc(APP_VERSION)} · skema data v${DB_VERSION}</p>
      </section>
    </div>`;

  // ---- Identitas ----
  const form = view.querySelector('#form-identity');
  form.querySelector('#f-name').value = await getSetting('businessName', 'CT Catering');
  form.querySelector('#f-address').value = await getSetting('businessAddress', '');
  form.querySelector('#f-phone').value = await getSetting('businessPhone', '');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.querySelector('#f-name').value.trim();
    if (!name) { toast('Nama usaha wajib diisi.', { error: true }); return; }
    try {
      await setSetting('businessName', name);
      await setSetting('businessAddress', form.querySelector('#f-address').value.trim());
      await setSetting('businessPhone', form.querySelector('#f-phone').value.trim());
      window.dispatchEvent(new Event('ct:brand-changed'));
      toast('Identitas usaha tersimpan.');
    } catch (err) {
      toast('Gagal menyimpan: ' + err.message, { error: true });
    }
  });

  // ---- Backup ----
  const refreshLastBackup = async () => {
    const at = await getSetting('lastBackupAt');
    const d = daysSince(at);
    view.querySelector('#last-backup').textContent =
      at ? `${formatDateTime(at)} (${d === 0 ? 'hari ini' : d + ' hari lalu'})` : 'belum pernah';
  };
  refreshLastBackup();

  const btnBackup = view.querySelector('#btn-backup');
  btnBackup.addEventListener('click', async () => {
    btnBackup.disabled = true;
    try {
      const r = await saveBackup();
      if (r !== 'cancelled') {
        toast('Backup dibuat. Pastikan file tersimpan di Files atau tempat aman.');
        removeBanner('backup');
      }
      refreshLastBackup();
    } catch (err) {
      toast('Backup gagal: ' + err.message, { error: true, ms: 6000 });
    } finally {
      btnBackup.disabled = false;
    }
  });

  // ---- Restore ----
  const fileInput = view.querySelector('#file-restore');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const backup = await readBackupFile(file);
      const c = backup.counts || {};
      const ok = confirm(
        `Restore akan MENGGANTI seluruh data di perangkat ini dengan isi backup:\n\n` +
        `• Dibuat: ${formatDateTime(backup.exportedAt)}\n` +
        `• Produk: ${c.products ?? '?'} · Transaksi: ${c.transactions ?? '?'}\n\n` +
        `Disarankan membuat backup data saat ini terlebih dahulu. Lanjutkan?`);
      if (!ok) return;
      await restoreData(backup);
      toast('Restore berhasil.');
      window.dispatchEvent(new Event('ct:brand-changed'));
      await render(view);
    } catch (err) {
      toast('Restore gagal: ' + err.message + ' Data lama tidak diubah.', { error: true, ms: 7000 });
    }
  });

  // ---- Status ----
  view.querySelector('#btn-recheck').addEventListener('click', async () => {
    await requestPersistence();
    renderStatus(view);
  });
  renderStatus(view);
  renderCounts(view);
}

async function renderStatus(view) {
  const list = view.querySelector('#offline-status');
  if (!list) return;
  const rows = [];

  const sw = await getSWStatus();
  if (!('serviceWorker' in navigator)) {
    rows.push(['Mode offline', badge('bad', 'Tidak didukung')]);
  } else if (!sw) {
    rows.push(['Mode offline', badge('warn', 'Sedang disiapkan — muat ulang sekali')]);
  } else if (sw.cached === sw.total) {
    rows.push(['Mode offline', badge('ok', `Siap (${sw.cached}/${sw.total} file)`)]);
  } else {
    rows.push(['Mode offline', badge('warn', `Belum lengkap (${sw.cached}/${sw.total})`)]);
  }

  const standalone = isStandalone();
  rows.push(['Terpasang di Layar Utama',
    standalone ? badge('ok', 'Ya') : badge(isIOS() ? 'bad' : 'warn', isIOS() ? 'Belum — wajib di iPad' : 'Belum')]);

  const persisted = await isPersisted();
  rows.push(['Penyimpanan permanen',
    persisted === true ? badge('ok', 'Aktif')
      : persisted === false ? badge('warn', standalone ? 'Belum diizinkan' : 'Pasang ke Layar Utama')
        : badge('warn', 'Tidak diketahui')]);

  rows.push(['Database lokal', badge('ok', 'Aktif')]);

  const est = await estimate();
  if (est) rows.push(['Ruang terpakai', `<span class="muted">${formatBytes(est.usage)} dari ${formatBytes(est.quota)}</span>`]);

  rows.push(['Versi', `<span class="muted">${esc(APP_VERSION)}${sw ? ' · cache ' + esc(sw.version) : ''}</span>`]);

  list.innerHTML = rows.map(([k, v]) => `<li><span>${esc(k)}</span>${v}</li>`).join('');
}

async function renderCounts(view) {
  const table = view.querySelector('#db-counts');
  if (!table) return;
  const rows = [];
  for (const s of STORES) rows.push(`<tr><td>${esc(STORE_LABELS[s])}</td><td>${await count(s)}</td></tr>`);
  table.innerHTML = rows.join('');
}
