// Backup & restore seluruh database ke/dari file JSON.
import { DB_VERSION, STORES, withTx, setSetting } from './db.js';
import { APP_VERSION } from './version.js';

export const BACKUP_APP_ID = 'ct-catering-pos';
export const BACKUP_FORMAT = 1;

const KEY_PATHS = {
  products: 'id', categories: 'id', transactions: 'id', transactionItems: 'id',
  orders: 'id', stockMovements: 'id', settings: 'key',
};

// Pengaturan yang tidak ikut ditimpa saat restore (milik perangkat ini).
const DEVICE_SETTINGS = new Set(['lastBackupAt']);

export async function exportData() {
  const data = {};
  await withTx(STORES, 'readonly', (s) => {
    for (const name of STORES) {
      s[name].getAll().onsuccess = (e) => { data[name] = e.target.result; };
    }
  });
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    schemaVersion: DB_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(STORES.map((n) => [n, data[n].length])),
    data,
  };
}

function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `backup-ct-catering-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/**
 * Simpan backup. Di iPad memakai lembar Bagikan (bisa simpan ke Files / AirDrop);
 * di perangkat lain mengunduh file.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function saveBackup() {
  const payload = await exportData();
  const json = JSON.stringify(payload);
  const name = backupFileName();
  const file = new File([json], name, { type: 'application/json' });

  let result;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup CT Catering POS' });
      result = 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      result = download(file, name);
    }
  } else {
    result = download(file, name);
  }
  await setSetting('lastBackupAt', payload.exportedAt);
  return result;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

/** Validasi isi file backup. Melempar Error dengan pesan berbahasa Indonesia. */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('File bukan backup yang valid.');
  if (obj.app !== BACKUP_APP_ID) throw new Error('File ini bukan backup CT Catering POS.');
  if (obj.format !== BACKUP_FORMAT) throw new Error(`Format backup (${obj.format}) tidak didukung.`);
  if (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    throw new Error('Versi data pada backup tidak dikenali.');
  }
  if (obj.schemaVersion > DB_VERSION) {
    throw new Error('Backup dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi terlebih dahulu.');
  }
  if (!obj.data || typeof obj.data !== 'object') throw new Error('Backup tidak berisi data.');
  for (const name of STORES) {
    const rows = obj.data[name] ?? [];
    if (!Array.isArray(rows)) throw new Error(`Bagian "${name}" pada backup rusak.`);
    const kp = KEY_PATHS[name];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || r[kp] === undefined || r[kp] === null || r[kp] === '') {
        throw new Error(`Ada data tanpa ID pada bagian "${name}".`);
      }
    }
  }
  return obj;
}

export async function readBackupFile(file) {
  if (!file) throw new Error('Tidak ada file dipilih.');
  if (file.size > 200 * 1024 * 1024) throw new Error('File terlalu besar.');
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    throw new Error('File tidak dapat dibaca (bukan JSON yang valid).');
  }
  return validateBackup(obj);
}

/**
 * Ganti seluruh data dengan isi backup — dalam SATU transaksi atomik.
 * Jika ada yang gagal, data lama tetap utuh.
 */
export async function restoreData(backup) {
  validateBackup(backup);
  // Tempat migrasi data backup lama → skema terbaru jika DB_VERSION naik nanti.
  const data = migrateBackup(backup);

  await withTx(STORES, 'readwrite', (s) => {
    for (const name of STORES) {
      const store = s[name];
      if (name === 'settings') {
        // Hapus pengaturan lama kecuali milik perangkat, lalu tulis dari backup.
        store.getAll().onsuccess = (e) => {
          for (const row of e.target.result) {
            if (!DEVICE_SETTINGS.has(row.key)) store.delete(row.key);
          }
          for (const row of data.settings) {
            if (!DEVICE_SETTINGS.has(row.key)) store.put(row);
          }
        };
      } else {
        store.clear();
        for (const row of data[name]) store.put(row);
      }
    }
  });
}

function migrateBackup(backup) {
  const data = {};
  for (const name of STORES) data[name] = backup.data[name] ?? [];
  // contoh nanti: if (backup.schemaVersion < 2) { ...ubah bentuk data... }
  return data;
}
