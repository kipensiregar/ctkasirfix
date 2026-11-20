// Status penyimpanan & instalasi — penting untuk keandalan di iPad.

export function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export function isIOS() {
  const ua = navigator.userAgent;
  // iPadOS 13+ melapor sebagai "Macintosh" — deteksi lewat layar sentuh.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Minta browser agar data tidak dihapus otomatis saat ruang penyimpanan menipis. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isPersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try { return await navigator.storage.persisted(); } catch { return null; }
}

export async function estimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Tanyakan status cache ke Service Worker. */
export function getSWStatus(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl) return resolve(null);
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(null); }, timeoutMs);
    function onMsg(e) {
      if (e.data && e.data.type === 'STATUS') {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(e.data);
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg);
    ctrl.postMessage({ type: 'GET_STATUS' });
  });
}
