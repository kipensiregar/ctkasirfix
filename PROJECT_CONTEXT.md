# PROJECT CONTEXT — CT CATERING POS

Dokumen lengkap ada di deskripsi Project "Aplikasi Full Offline" di Claude.

Ringkasan prinsip:

- Aplikasi kasir web offline-first (PWA), target utama iPad.
- Tanpa backend, tanpa database cloud, tanpa CDN, tanpa API eksternal.
- IndexedDB = penyimpanan utama. Service Worker = aset offline.
- GitHub Pages hanya untuk hosting statis.
- Detail transaksi menyimpan snapshot nama, harga, dan jumlah.
- Skema database hanya berubah lewat migrasi.
- Backup & restore dengan validasi format dan versi.
- Prioritas: keandalan offline → konsistensi data → kasir → dapur/antrean → stok → laporan → UI → fitur tambahan.

## Catatan keputusan

- **2026-11-20 — Tanpa langkah build untuk saat ini.** Vite tidak tersedia di lingkungan pengembangan awal. Aplikasi ditulis sebagai ES module murni (tanpa bundler), langsung jalan di GitHub Pages. Vite dapat ditambahkan nanti tanpa mengubah arsitektur; daftar precache di `sw.js` harus disesuaikan bila nama file menjadi ber-hash.
- **2026-11-20 — Printer struk ditunda.** Safari iPad tidak mendukung Web Bluetooth; pilihan printer diputuskan nanti.
- **2026-11-20 — Alur bayar belakangan.** Mengikuti cara kerja rumah makan: Kasir hanya mengirim pesanan ke dapur; pembayaran dilakukan di Antrean. Koreksi = menambah menu ke pesanan meja yang belum bayar. Laporan omzet nantinya memakai transaksi `paid` berdasarkan `paidDateKey`.
