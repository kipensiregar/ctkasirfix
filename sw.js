/* Service Worker CT Catering POS
 * Strategi: semua aset aplikasi disimpan saat instalasi (precache) lalu
 * dilayani dari cache (cache-first). Aplikasi tidak butuh jaringan sama sekali
 * setelah caching awal selesai.
 *
 * SETIAP RILIS: naikkan CACHE_VERSION dan pastikan semua file ada di ASSETS.
 * Service Worker TIDAK pernah menyentuh IndexedDB, jadi update tidak merusak data.
 */
const CACHE_VERSION = 'v0.7.0';
const CACHE_NAME = `ct-pos-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/backup.js',
  './js/storage.js',
  './js/ui.js',
  './js/version.js',
  './js/pages/pengaturan.js',
  './js/pages/kasir.js',
  './js/pages/stok.js',
  './js/pages/dapur.js',
  './js/pages/antrean.js',
  './js/pages/payment.js',
  './js/pages/laporan.js',
  './js/services/products.js',
  './js/services/sales.js',
  './js/services/stock.js',
  './js/services/reports.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' memastikan file diambil baru dari server, bukan cache HTTP lama.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // Sengaja TIDAK memanggil skipWaiting otomatis: versi baru menunggu sampai
  // pengguna menekan "Perbarui", supaya tidak mengganggu transaksi yang sedang berjalan.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('ct-pos-') && k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (msg.type === 'GET_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      let cached = 0;
      for (const url of ASSETS) if (await cache.match(url)) cached++;
      event.source.postMessage({
        type: 'STATUS', version: CACHE_VERSION, cached, total: ASSETS.length,
      });
    })());
  }
});

// Simpan handle cache agar tidak membuka ulang untuk setiap file.
let cachePromise = null;
const getCache = () => (cachePromise ||= caches.open(CACHE_NAME));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tidak ada aset eksternal

  // Navigasi halaman (termasuk dibuka dari Home Screen): selalu index.html dari cache.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await getCache();
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return new Response('<h1>Aplikasi belum tersimpan untuk offline</h1><p>Buka sekali saat ada internet.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
    })());
    return;
  }

  // Aset: cache-first, lalu jaringan (dan simpan) sebagai cadangan.
  event.respondWith((async () => {
    const cache = await getCache();
    // Pencocokan persis (cepat). ignoreSearch hanya sebagai cadangan.
    const cached = (await cache.match(req)) || (url.search && await cache.match(req, { ignoreSearch: true }));
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
