# Warung Medan POS

## Cara upload yang benar

Ekstrak file ZIP ini terlebih dahulu. Upload **isi folder `warung_medan_pos_fixed`**, bukan file ZIP dan bukan folder pembungkusnya.

Di GitHub, saat membuka repository, file-file ini harus terlihat langsung:

```text
.github/workflows/build_apk.yml
lib/main.dart
lib/helpers/database_helper.dart
pubspec.yaml
```

Jangan sampai tampil seperti ini:

```text
warung_medan_pos_fixed/lib/main.dart
```

Setelah semua file berada di root repository:

1. Commit perubahan ke branch `main`.
2. Buka tab **Actions**.
3. Pilih **Build Android APK**.
4. Klik **Run workflow**.
5. Tunggu sampai status **Success**.
6. Buka artifact `warung-medan-apk`.

Workflow memiliki pemeriksaan source. Jika file ter-upload di lokasi yang salah, proses akan berhenti dan tidak akan membuat APK Flutter Demo.