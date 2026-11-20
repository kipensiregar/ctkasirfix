import { openDB, onBlocked, getSetting, count, STORES } from './db.js';
import { requestPersistence, isStandalone, isIOS } from './storage.js';
import { banner, removeBanner, toast, esc, daysSince } from './ui.js';
import * as placeholder from './pages/placeholder.js';
import * as pengaturan from './pages/pengaturan.js';

// Semua halaman di-import statis agar ikut tersimpan oleh Service Worker.
const ROUTES = {
  kasir: placeholder.make('Kasir', '🧾', 'Katalog produk, keranjang, pembayaran tunai, dan penyimpanan transaksi.'),
  dapur: placeholder.make('Dapur', '🍳', 'Pesanan masuk dari kasir dengan status menunggu, diproses, dan selesai.'),
  antrean: placeholder.make('Antrean', '🔢', 'Daftar pesanan aktif, nomor pesanan, dan riwayat.'),
  laporan: placeholder.make('Laporan', '📊', 'Omzet harian dan bulanan, produk terlaris, dan keuntungan.'),
  stok: placeholder.make('Stok', '📦', 'Produk, kategori, harga jual dan modal, serta pergerakan stok.'),
  pengaturan,
};
const DEFAULT_ROUTE = 'kasir';

const view = document.getElementById('view');
let currentCleanup = null;

async function render() {
  const name = (location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE).split('?')[0];
  const page = ROUTES[name] || ROUTES[DEFAULT_ROUTE];
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  if (typeof currentCleanup === 'function') currentCleanup();
  currentCleanup = null;
  try {
    currentCleanup = await page.render(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h2>Terjadi kesalahan</h2><p class="muted">${esc(err.message || err)}</p></div>`;
  }
  view.focus({ preventScroll: true });
}

// ---------- Status jaringan (informasi saja — aplikasi tidak membutuhkannya) ----------
function updateNet() {
  const el = document.getElementById('net-status');
  const online = navigator.onLine;
  el.classList.toggle('offline', !online);
  el.querySelector('.net-label').textContent = online ? 'Online' : 'Offline';
}

// ---------- Service Worker & pembaruan ----------
async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    banner('sw', 'Browser ini tidak mendukung mode offline. Gunakan Safari terbaru di iPad.');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    const showUpdate = (worker) => {
      const el = banner('update',
        `<span>Versi baru aplikasi tersedia. Data Anda tetap aman.</span>
         <button class="btn" type="button">Perbarui sekarang</button>`, { info: true });
      el.querySelector('button').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
    };

    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });

    // Cek pembaruan saat aplikasi kembali dibuka (hanya berhasil jika ada internet).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    });
  } catch (err) {
    console.error('SW gagal', err);
    banner('sw', 'Mode offline belum aktif. Buka aplikasi sekali lagi saat ada internet.');
  }
}

// ---------- Peringatan khusus iPad ----------
function installHint() {
  if (isStandalone()) { removeBanner('install'); return; }
  if (isIOS()) {
    banner('install',
      `<span><b>Pasang ke Layar Utama</b> agar data aman dan bisa dibuka offline:
       ketuk tombol <b>Bagikan</b> di Safari → <b>Tambah ke Layar Utama</b>.</span>`);
  }
}

async function backupReminder() {
  let total = 0;
  for (const s of STORES) if (s !== 'settings') total += await count(s);
  if (total === 0) return;
  const days = daysSince(await getSetting('lastBackupAt'));
  if (days >= 7) {
    const el = banner('backup',
      `<span>${days === Infinity ? 'Data belum pernah di-backup.' : `Backup terakhir ${days} hari lalu.`}
       Data hanya tersimpan di perangkat ini.</span>
       <a class="btn secondary" href="#/pengaturan">Backup sekarang</a>`);
    el.querySelector('a').onclick = () => removeBanner('backup');
  }
}

async function applyBrand() {
  const name = await getSetting('businessName');
  if (name) document.getElementById('brand-name').textContent = name;
}
window.addEventListener('ct:brand-changed', applyBrand);

// ---------- Start ----------
async function start() {
  updateNet();
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  try {
    await openDB();
  } catch (err) {
    view.innerHTML = `<div class="card"><h2>Database tidak dapat dibuka</h2>
      <p class="muted">${esc(err.message || err)}</p>
      <p class="small muted">Pastikan Safari tidak dalam mode Penjelajahan Pribadi.</p></div>`;
    return;
  }
  onBlocked(() => toast('Aplikasi dibuka di tab lain dengan versi baru. Muat ulang halaman ini.', { error: true, ms: 8000 }));

  window.addEventListener('hashchange', render);
  await render();

  registerSW();
  installHint();
  applyBrand();
  backupReminder();
  requestPersistence();
}

start();
