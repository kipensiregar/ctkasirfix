// Util tampilan kecil.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
export function toast(message, { error = false, ms = 3000 } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  el.textContent = message;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/** Tampilkan banner di bawah header. key mencegah banner ganda. */
export function banner(key, html, { info = false } = {}) {
  const host = document.getElementById('banners');
  let el = host.querySelector(`[data-key="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.key = key;
    host.appendChild(el);
  }
  el.className = 'banner' + (info ? ' info' : '');
  el.innerHTML = html;
  return el;
}

export function removeBanner(key) {
  document.querySelector(`#banners [data-key="${key}"]`)?.remove();
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const rpFmt = new Intl.NumberFormat('id-ID');
export function rupiah(n) {
  return 'Rp' + rpFmt.format(Math.round(Number(n) || 0));
}

/** "Rp 25.000" / "25000" / "25.000" → 25000 */
export function parseMoney(s) {
  const digits = String(s ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/**
 * Modal sederhana yang ramah sentuh.
 * @returns {{el:HTMLElement, close:Function}}
 */
const openModals = new Set();
/** Tutup semua modal (dipanggil saat pindah halaman). */
export function closeAllModals() {
  [...openModals].forEach((close) => close());
}

export function openModal(html, { onClose, dismissible = true, wide = false } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  const el = backdrop.firstElementChild;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    backdrop.remove();
    if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissible) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  openModals.add(close);
  return { el, close };
}

export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/**
 * Simpan file: di iPad lewat lembar Bagikan (Files / AirDrop / WhatsApp),
 * selain itu diunduh. @returns {'shared'|'downloaded'|'cancelled'}
 */
export async function shareOrDownload(file, title = '') {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
