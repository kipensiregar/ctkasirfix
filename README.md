# CT Catering POS

Aplikasi kasir offline untuk CT Catering. Berjalan sepenuhnya di browser (iPad/Safari, tablet, laptop), tanpa backend, tanpa CDN.

## Riwayat tahap

### v0.7.1 — Logo CT Catering & sunting stok

- Logo CT Catering di header dan sebagai ikon aplikasi (Layar Utama iPad, 192/512, maskable). Sumber: `icons/` (dibuat dari logo asli, dikompres).
- Stok produk bisa disunting langsung di form edit ("Stok tersedia"); selisih tercatat di Riwayat Stok (naik = Stok masuk, turun = Penyesuaian). Tombol "± Stok" menjadi "Sunting stok".
- Catatan iPad: ikon di Layar Utama tidak berubah otomatis. Untuk memakai ikon baru: Backup → hapus ikon lama → Tambah ke Layar Utama lagi → Restore.

### v0.7.0 — Modul Laporan

- Periode: Hari ini, Kemarin, 7 hari, Bulan ini, Bulan lalu, atau rentang tanggal sendiri (tersimpan di URL).
- Angka utama: omzet, jumlah transaksi lunas, rata-rata per transaksi, porsi terjual, laba kotor.
- Laba dihitung dari harga modal yang tersimpan saat penjualan; jika ada menu tanpa harga modal, ditampilkan cakupannya (mis. "dari 70% porsi") dan daftar menunya.
- Grafik omzet per jam (1 hari) atau per hari; ketuk batang untuk angka.
- Produk terlaris (urut porsi/omzet), omzet per kategori, pembatalan dalam periode.
- Riwayat penjualan + rincian; **Ekspor CSV** (pemisah titik koma, siap dibuka Excel).
- Aturan: hanya transaksi lunas, berdasarkan tanggal bayar. Pesanan belum bayar & porsi yang dibatalkan tidak masuk omzet.

### v0.6.0 — Koreksi pesanan (kurangi/batal) & urutan antrean

- **Koreksi** menampilkan semua menu yang sudah dipesan dengan − / +:
  - − membatalkan porsi: stok dikembalikan (tercatat "Pembatalan pesanan"), tiket dapur diperbarui (porsi yang belum dihidangkan dikurangi lebih dulu), total turun.
  - + atau ketuk katalog: tambahan dikirim ke dapur sebagai tiket *Tambahan* (bisa diberi catatan).
  - Ringkasan: pesanan sebelumnya, perubahan (+/−), total baru. Koreksi yang belum disimpan tetap ada setelah refresh.
  - Semua menu dikurangi ke 0 → **Batalkan Seluruh Pesanan** (status `void`, hilang dari antrean & dapur, stok kembali).
- **Antrean** diurutkan: nomor meja (1, 2, … 10) lalu nama pemesan A–Z.
- Header tanpa efek kaca buram (blur).

### v0.5.0 — Tampilan baru

- Desain lebih lapang: panel putih tanpa garis tebal, bayangan tipis, latar abu-hijau muda.
- Navigasi dengan ikon (SVG lokal); di iPad tegak ikon + label kecil.
- Warna lembut per kategori di kartu menu (daun, kunyit, cabai, terong, kecap, laut).
- Huruf bawaan perangkat (SF Pro di iPad) — tanpa file font tambahan.
- Pengingat backup bisa ditunda ("Nanti") untuk sesi ini.
- Perbaikan: jendela pop-up otomatis tertutup saat pindah halaman.
- Animasi minimal; menghormati pengaturan "Kurangi Gerakan" di iPad.

### v0.4.0 — Modul Stok

- Tab **Produk**: ringkasan jumlah produk, stok menipis (≤5), stok habis (bisa diketuk sebagai filter); tombol **± Stok** per produk.
- **± Stok**: Masuk, Keluar (alasan cepat: Rusak, Basi, Dipakai sendiri, Hilang), Penyesuaian (isi jumlah stok fisik, selisih dihitung otomatis). Pratinjau stok akhir sebelum disimpan; stok tidak bisa minus.
- Stok produk yang sudah dihitung tidak lagi diubah lewat form edit, agar setiap perubahan tercatat di riwayat.
- Tab **Riwayat Stok**: semua pergerakan (stok awal, masuk, keluar, penyesuaian, penjualan) dengan filter produk & jenis.
- Tab **Kategori**: tambah, ganti nama, hapus (produk di dalamnya menjadi tanpa kategori).

### v0.3.0 — Alur rumah makan: Kasir → Dapur → Antrean → Bayar

- **Kasir**: pilih menu, catatan per item, No. meja / nama (wajib salah satu) → **Kirim ke Dapur**. Belum ada pembayaran.
- Meja yang sama masih belum bayar → ditawarkan *tambahkan ke pesanan itu* atau *pesanan terpisah*.
- **Dapur**: kartu per pesanan, centang item yang sudah dihidangkan, tombol **Hidangkan** untuk menyelesaikan. Pesanan tambahan muncul sebagai kartu terpisah berlabel *Tambahan*. Waktu tunggu > 15 menit ditandai merah.
- **Antrean**: daftar *Menunggu Bayar* per meja; ketuk untuk melihat rincian (per ronde, status hidang, catatan) → **Koreksi** (tambah menu) atau **Bayar** (tunai + kembalian). Ada daftar *Lunas hari ini*.
- Angka di menu Dapur/Antrean = jumlah pesanan aktif.
- Data: transaksi dibuat berstatus `open` saat dikirim ke dapur, menjadi `paid` saat dibayar (`paidAt`, `paidDateKey`). Stok dikurangi saat dikirim ke dapur. Tidak ada perubahan skema IndexedDB.

### v0.2.1 — No. meja & nama pemesan

- Kolom No. meja dan Nama pemesan di panel Pesanan (opsional), ikut tersimpan ke transaksi dan pesanan dapur.
- Aplikasi tidak lagi memuat ulang sendiri saat kunjungan pertama.

### v0.2.0 — Modul Kasir

- Katalog kartu, pencarian, filter kategori, keranjang +/−, total.
- Pembayaran tunai dengan saran nominal & kembalian; nama pelanggan & catatan dapur (opsional).
- Simpan transaksi atomik: transaksi + detail (snapshot nama/harga/modal) + pesanan dapur (status *menunggu*) + pengurangan stok + nomor urut harian (#001, #002, …).
- Keranjang yang belum dibayar tetap ada setelah refresh.
- Halaman Stok (sementara): tambah/edit/hapus produk, kategori, harga jual & modal, opsi hitung stok.
- Belum: cetak struk (printer ditentukan nanti).

### v0.1.0 — Fondasi offline

- Service Worker menyimpan semua aset → aplikasi terbuka tanpa internet.
- IndexedDB dengan sistem migrasi (`js/db.js`) untuk: products, categories, transactions, transactionItems, orders, stockMovements, settings.
- Backup ke file JSON (lembar Bagikan di iPad → Files/AirDrop) dan restore dengan validasi format & versi. Restore atomik: kalau gagal, data lama utuh.
- Panel **Pengaturan → Status Offline** untuk mengecek kesiapan offline, instalasi di Layar Utama, dan penyimpanan permanen.
- Pengingat backup jika lebih dari 7 hari.

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
js/pages/               Halaman (kasir, stok, pengaturan, placeholder)
js/services/            Logika data (products, sales)
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
