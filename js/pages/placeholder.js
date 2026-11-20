// Halaman sementara untuk modul yang belum dibangun.
import { esc } from '../ui.js';

export function make(title, icon, desc) {
  return {
    render(view) {
      view.innerHTML = `
        <h1>${esc(title)}</h1>
        <div class="card placeholder">
          <div class="ph-icon">${icon}</div>
          <p><b>Modul ${esc(title)} akan dibangun di tahap berikutnya.</b></p>
          <p class="small">${esc(desc)}</p>
        </div>`;
    },
  };
}
