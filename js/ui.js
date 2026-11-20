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

export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
