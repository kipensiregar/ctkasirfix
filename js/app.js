import { openDB, onBlocked, getSetting, count, STORES } from './db.js';
import { requestPersistence, isStandalone, isIOS } from './storage.js';
import { banner, removeBanner, toast, esc, daysSince, closeAllModals } from './ui.js';
import * as placeholder from './pages/placeholder.js';
import * as pengaturan from './pages/pengaturan.js';
import * as kasir from './pages/kasir.js';
import * as stok from './pages/stok.js';
import * as dapur from './pages/dapur.js';
import * as antrean from './pages/antrean.js';
import { listKitchenOrders, listOpenTransactions } from './services/sales.js';

// Semua halaman di-import statis agar ikut tersimpan oleh Service Worker.
const ROUTES = {
  kasir,
  dapur,
  antrean,
  laporan: placeholder.make('Laporan', '📊', 'Omzet harian dan bulanan, produk terlaris, dan keuntungan.'),
  stok,
  pengaturan,
};
const DEFAULT_ROUTE = 'kasir';

const view = document.getElementById('view');
let currentCleanup = null;

async function render() {
  const name = (location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE).split('?')[0];
  const page = ROUTES[name] || ROUTES[DEFAULT_ROUTE];
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  closeAllModals();
  if (typeof currentCleanup === 'function') currentCleanup();
  currentCleanup = null;
  try {
    currentCleanup = await page.render(view);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h2>Terjadi kesalahan</h2><p class="muted">${esc(err.message || err)}</p></div>`;
  }
  view.focus({ preventScroll: true });
  updateBadges();
}

// ---------- Jumlah pesanan di menu Dapur & Antrean ----------
async function updateBadges() {
  try {
    const [k, o] = await Promise.all([listKitchenOrders(), listOpenTransactions()]);
    setBadge('dapur', k.length);
    setBadge('antrean', o.length);
  } catch (_) { /* abaikan */ }
}
function setBadge(route, n) {
  const a = document.querySelector(`#tabs a[data-route="${route}"]`);
  if (!a) return;
  let b = a.querySelector('.nav-badge');
  if (!n) { b?.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; a.appendChild(b); }
  b.textContent = n;
}
window.addEventListener('ct:data-changed', updateBadges);

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
    let updateRequested = false;

    const showUpdate = (worker) => {
      const el = banner('update',
        `<span>Versi baru aplikasi tersedia. Data Anda tetap aman.</span>
         <button class="btn" type="button">Perbarui sekarang</button>`, { info: true });
      el.querySelector('button').onclick = () => {
        updateRequested = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      };
    };

    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });

    // Muat ulang HANYA jika pengguna menekan "Perbarui sekarang".
    // (Saat kunjungan pertama, SW juga mengambil alih halaman — jangan reload saat itu.)
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !updateRequested) return;
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
  let snoozed = false;
  try { snoozed = sessionStorage.getItem('ct-backup-snooze') === '1'; } catch (_) { /* abaikan */ }
  if (days >= 7 && !snoozed) {
    const el = banner('backup',
      `<span>${days === Infinity ? 'Data belum pernah di-backup.' : `Backup terakhir ${days} hari lalu.`}
       Data hanya tersimpan di iPad ini.</span>
       <span class="banner-actions">
         <button type="button" class="btn ghost" data-snooze>Nanti</button>
         <a class="btn" href="#/pengaturan">Backup sekarang</a>
       </span>`);
    el.querySelector('a').onclick = () => removeBanner('backup');
    el.querySelector('[data-snooze]').onclick = () => {
      try { sessionStorage.setItem('ct-backup-snooze', '1'); } catch (_) { /* abaikan */ }
      removeBanner('backup');
    };
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
