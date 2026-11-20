# CT Catering POS

Aplikasi kasir offline untuk CT Catering. Berjalan sepenuhnya di browser (iPad/Safari, tablet, laptop), tanpa backend, tanpa CDN.

## Tahap saat ini: fondasi offline (v0.1.0)

- Service Worker menyimpan semua aset → aplikasi terbuka tanpa internet.
- IndexedDB dengan sistem migrasi (`js/db.js`) untuk: products, categories, transactions, transactionItems, orders, stockMovements, settings.
- Backup ke file JSON (lembar Bagikan di iPad → Files/AirDrop) dan restore dengan validasi format & versi. Restore atomik: kalau gagal, data lama utuh.
- Panel **Pengaturan → Status Offline** untuk mengecek kesiapan offline, instalasi di Layar Utama, dan penyimpanan permanen.
- Pengingat backup jika lebih dari 7 hari.
- Modul Kasir, Dapur, Antrean, Laporan, Stok: menyusul.

## Struktur

```
index.html              Kerangka & navigasi
sw.js                   Service Worker (daftar ASSETS + CACHE_VERSION)
manifest.webmanifest    Manifest PWA
css/app.css             Gaya (putih + hijau, ramah sentuh)
js/app.js               Router, registrasi SW, banner
js/db.js                IndexedDB + migrasi
js/backup.js            Backup/restore
js/storage.js           Status instalasi & penyimpanan
js/ui.js                Util tampilan
js/version.js           Versi aplikasi
js/pages/               Halaman
```

Tanpa langkah build: semua file statis, langsung bisa di-hosting di GitHub Pages.

## Deploy ke GitHub Pages

1. Unggah seluruh isi folder ini ke repository GitHub (root branch `main`).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Buka alamat `https://<user>.github.io/<repo>/` di Safari iPad **saat ada internet**.
4. Tunggu hingga **Pengaturan → Status Offline** menunjukkan "Siap".
5. Ketuk **Bagikan → Tambah ke Layar Utama**. Selanjutnya selalu buka dari ikon di Layar Utama.

## Aturan rilis

1. Setiap file baru **wajib** ditambahkan ke `ASSETS` di `sw.js`.
2. Naikkan `CACHE_VERSION` di `sw.js` dan `APP_VERSION` di `js/version.js`.
3. Perubahan skema database **hanya** lewat migrasi baru di `js/db.js` (naikkan `DB_VERSION`). Jangan ubah migrasi lama.
4. Jika skema berubah, tambahkan konversi di `migrateBackup()` (`js/backup.js`) supaya backup lama tetap bisa di-restore.
5. Pengguna memilih kapan memperbarui (tombol "Perbarui sekarang"); pembaruan tidak menyentuh IndexedDB.

## Catatan iPad

- Data hanya ada di iPad itu dan di aplikasi yang dipasang dari Layar Utama. Data di tab Safari biasa terpisah.
- Menghapus ikon aplikasi dari Layar Utama **menghapus datanya**. Backup dulu.
- Jangan gunakan mode Penjelajahan Pribadi.

## Uji lokal

```
python3 -m http.server 8080
```
Lalu buka http://localhost:8080.
