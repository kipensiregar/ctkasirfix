// Laporan penjualan: periode, angka utama, grafik omzet, produk terlaris, kategori, riwayat.
// Periode lewat URL agar tetap setelah refresh: #/laporan?from=2026-11-01&to=2026-11-20
import { buildReport, buildCsv, presetRange, parseDateKey, daysBetween } from '../services/reports.js';
import { getTransactionDetail, whoLine } from '../services/sales.js';
import { localDateKey } from '../db.js';
import { esc, rupiah, toast, openModal, shareOrDownload } from '../ui.js';

const PRESETS = [
  ['hariini', 'Hari ini'], ['kemarin', 'Kemarin'], ['7hari', '7 hari'],
  ['bulanini', 'Bulan ini'], ['bulanlalu', 'Bulan lalu'],
];
const fmtNum = (n) => new Intl.NumberFormat('id-ID').format(n);
const time = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (key, opts) => parseDateKey(key).toLocaleDateString('id-ID', opts);

/** Rp1,2 jt / Rp850 rb — untuk label sumbu yang sempit. */
function short(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} rb`;
  return String(n);
}

function periodTitle(from, to) {
  const today = localDateKey();
  if (from === to) {
    if (from === today) return 'Hari ini';
    return dayLabel(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayLabel(from, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export async function render(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const valid = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k || '');
  let { from, to } = presetRange('hariini');
  if (valid(params.get('from')) && valid(params.get('to'))) { from = params.get('from'); to = params.get('to'); }
  if (to < from) [from, to] = [to, from];
  if (daysBetween(from, to) > 370) from = localDateKey(new Date(parseDateKey(to).getTime() - 370 * 86400000));
  const activePreset = PRESETS.find(([k]) => { const r = presetRange(k); return r.from === from && r.to === to; })?.[0];

  view.innerHTML = `
    <div class="page-head"><h1>Laporan</h1></div>
    <div class="report-filters">
      <nav class="seg" aria-label="Periode">
        ${PRESETS.map(([k, l]) => `<button type="button" data-preset="${k}" class="${k === activePreset ? 'active' : ''}">${l}</button>`).join('')}
      </nav>
      <div class="date-range">
        <input type="date" id="r-from" value="${from}" max="${localDateKey()}" aria-label="Dari tanggal">
        <span class="muted">sampai</span>
        <input type="date" id="r-to" value="${to}" max="${localDateKey()}" aria-label="Sampai tanggal">
      </div>
    </div>
    <div id="report-body"><div class="loading">Menghitung…</div></div>`;

  const go = (f, t) => { location.hash = `#/laporan?from=${f}&to=${t}`; };
  view.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const r = presetRange(b.dataset.preset);
    go(r.from, r.to);
  }));
  const fromIn = view.querySelector('#r-from');
  const toIn = view.querySelector('#r-to');
  const onDate = () => { if (valid(fromIn.value) && valid(toIn.value)) go(fromIn.value, toIn.value); };
  fromIn.addEventListener('change', onDate);
  toIn.addEventListener('change', onDate);

  let r;
  try {
    r = await buildReport(from, to);
  } catch (err) {
    view.querySelector('#report-body').innerHTML = `<div class="card"><p>Laporan gagal dihitung: ${esc(err.message)}</p></div>`;
    return;
  }
  renderBody(view.querySelector('#report-body'), r);
}

function renderBody(body, r) {
  const title = periodTitle(r.from, r.to);
  if (!r.count) {
    body.innerHTML = `
      <p class="period-title">${esc(title)}</p>
      <div class="card placeholder"><div class="ph-icon">📊</div>
        <p><b>Belum ada penjualan lunas di periode ini.</b></p>
        <p class="small">Laporan menghitung pesanan yang sudah dibayar di menu Antrean.</p>
        ${r.cancelled.qty || r.cancelled.voids ? `<p class="small">Pembatalan: ${r.cancelled.qty} porsi (${rupiah(r.cancelled.amount)})</p>` : ''}
      </div>`;
    return;
  }

  const costCoverage = r.qty ? r.qtyWithCost / r.qty : 0;
  const margin = r.omzetWithCost ? Math.round((r.profit / r.omzetWithCost) * 100) : 0;

  body.innerHTML = `
    <p class="period-title">${esc(title)}</p>

    <section class="kpi-row">
      <div class="kpi hero">
        <span class="kpi-label">Omzet</span>
        <span class="kpi-value">${rupiah(r.omzet)}</span>
        <span class="kpi-sub">${fmtNum(r.count)} transaksi lunas</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Rata-rata per transaksi</span>
        <span class="kpi-value">${rupiah(r.avg)}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Porsi terjual</span>
        <span class="kpi-value">${fmtNum(r.qty)}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Laba kotor</span>
        <span class="kpi-value">${r.qtyWithCost ? rupiah(r.profit) : '—'}</span>
        <span class="kpi-sub">${!r.qtyWithCost ? 'Isi harga modal di Stok' :
          costCoverage < 1 ? `Dari ${Math.round(costCoverage * 100)}% porsi yang punya harga modal` : `Margin ${margin}%`}</span>
      </div>
    </section>
    ${r.missingCost.length ? `
      <p class="note-warn">Laba belum lengkap: ${r.missingCost.length} menu belum punya harga modal
        (${esc(r.missingCost.slice(0, 4).join(', '))}${r.missingCost.length > 4 ? ', …' : ''}).
        Isi di <a href="#/stok">Stok</a> — berlaku untuk penjualan berikutnya.</p>` : ''}

    <section class="card">
      <div class="card-head">
        <h2>Omzet ${r.singleDay ? 'per jam' : 'per hari'}</h2>
        <span class="small muted" id="bar-info">Ketuk batang untuk melihat angka</span>
      </div>
      ${barChart(r)}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <h2>Produk terlaris</h2>
          <div class="seg seg-sm" id="top-sort">
            <button type="button" data-sort="qty" class="active">Porsi</button>
            <button type="button" data-sort="omzet">Omzet</button>
          </div>
        </div>
        <div id="top-list"></div>
      </section>
      <section class="card">
        <h2>Omzet per kategori</h2>
        ${meterList(r.categoryList, r.omzet)}
        ${r.cancelled.qty || r.cancelled.voids ? `
          <p class="small muted cancel-line">Pembatalan di periode ini: <b>${fmtNum(r.cancelled.qty)} porsi</b>
            (${rupiah(r.cancelled.amount)})${r.cancelled.voids ? `, ${r.cancelled.voids} pesanan dibatalkan seluruhnya` : ''}.
            Tidak dihitung dalam omzet.</p>` : ''}
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <h2>Riwayat penjualan <span class="muted small">(${fmtNum(r.count)})</span></h2>
        <button type="button" class="btn secondary btn-sm" id="btn-csv">Ekspor CSV</button>
      </div>
      <div class="list-card flat" id="sales-list"></div>
      <div class="btn-row" style="justify-content:center"><button type="button" class="btn secondary" id="more" hidden>Tampilkan lebih banyak</button></div>
    </section>`;

  // ---- Grafik: ketuk batang ----
  const info = body.querySelector('#bar-info');
  body.querySelectorAll('.bar-col').forEach((col) => col.addEventListener('click', () => {
    body.querySelectorAll('.bar-col.sel').forEach((c) => c.classList.remove('sel'));
    col.classList.add('sel');
    info.innerHTML = `<b>${esc(col.dataset.label)}</b> · ${rupiah(Number(col.dataset.omzet))} · ${col.dataset.count} transaksi`;
  }));

  // ---- Produk terlaris ----
  const top = body.querySelector('#top-list');
  const drawTop = (by) => {
    const list = [...r.productList].sort((a, b) => b[by] - a[by] || b.omzet - a.omzet).slice(0, 10);
    const max = list[0]?.[by] || 1;
    top.innerHTML = `<ol class="rank-list">${list.map((p) => `
      <li>
        <span class="rk-name">${esc(p.name)}</span>
        <span class="rk-val">${by === 'qty' ? `${fmtNum(p.qty)} porsi` : rupiah(p.omzet)}</span>
        <span class="rk-bar"><span style="width:${Math.max(2, (p[by] / max) * 100)}%"></span></span>
        <span class="rk-sub small muted">${by === 'qty' ? rupiah(p.omzet) : `${fmtNum(p.qty)} porsi`}${
          p.costKnown ? ` · laba ${rupiah(p.profit)}` : ' · modal belum diisi'}</span>
      </li>`).join('')}</ol>`;
  };
  drawTop('qty');
  body.querySelector('#top-sort').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    body.querySelectorAll('#top-sort button').forEach((x) => x.classList.toggle('active', x === b));
    drawTop(b.dataset.sort);
  });

  // ---- Riwayat ----
  const listEl = body.querySelector('#sales-list');
  const more = body.querySelector('#more');
  let limit = 30;
  const drawList = () => {
    const showDate = !r.singleDay;
    listEl.innerHTML = r.transactions.slice(0, limit).map((t) => `
      <button type="button" class="list-row" data-trx="${esc(t.id)}">
        <span class="lr-main">
          <span class="lr-title">${esc(whoLine(t) || 'Tanpa nama')}</span>
          <span class="small muted">#${esc(t.queueNo)} · ${showDate ? `${dayLabel(t.paidDateKey || t.dateKey, { day: 'numeric', month: 'short' })}, ` : ''}${time(t.paidAt || t.createdAt)} · ${fmtNum(t.itemCount)} porsi</span>
        </span>
        <span class="lr-side"><b>${rupiah(t.total)}</b></span>
      </button>`).join('');
    more.hidden = r.transactions.length <= limit;
  };
  drawList();
  more.addEventListener('click', () => { limit += 50; drawList(); });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trx]');
    if (b) showDetail(b.dataset.trx);
  });

  // ---- Ekspor ----
  body.querySelector('#btn-csv').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const csv = await buildCsv(r);
      const name = r.from === r.to ? `penjualan-${r.from}.csv` : `penjualan-${r.from}_sd_${r.to}.csv`;
      const res = await shareOrDownload(new File([csv], name, { type: 'text/csv' }), 'Laporan penjualan');
      if (res !== 'cancelled') toast('File CSV dibuat. Bisa dibuka di Excel atau Google Sheets.');
    } catch (err) {
      toast('Ekspor gagal: ' + err.message, { error: true });
    } finally {
      btn.disabled = false;
    }
  });
}

/** Grafik batang satu warna, garis dasar di bawah, label sumbu seperlunya. */
function barChart(r) {
  const data = r.buckets;
  // Untuk 1 hari: tampilkan jam operasional saja (jam pertama s/d terakhir yang ada transaksi, minimal 08–21).
  let shown = data;
  if (r.singleDay) {
    const used = data.filter((b) => b.count).map((b) => b.key);
    const lo = Math.min(8, ...used);
    const hi = Math.max(21, ...used);
    shown = data.filter((b) => b.key >= lo && b.key <= hi);
  }
  const max = Math.max(...shown.map((b) => b.omzet), 1);
  const nice = niceMax(max);
  const every = shown.length > 20 ? Math.ceil(shown.length / 10) : 1;
  const label = (b) => (r.singleDay ? `${String(b.key).padStart(2, '0')}.00` :
    dayLabel(b.key, { weekday: 'short', day: 'numeric', month: 'short' }));
  const tick = (b) => (r.singleDay ? String(b.key).padStart(2, '0') : String(parseDateKey(b.key).getDate()));

  return `
    <div class="bar-chart" role="img" aria-label="Grafik omzet ${r.singleDay ? 'per jam' : 'per hari'}">
      <div class="bar-axis">
        <span>${short(nice)}</span><span>${short(nice / 2)}</span><span>0</span>
      </div>
      <div class="bar-plot">
        <div class="bar-grid"><span></span><span></span><span></span></div>
        <div class="bar-cols" style="--n:${shown.length}">
          ${shown.map((b, i) => `
            <button type="button" class="bar-col" data-label="${esc(label(b))}" data-omzet="${b.omzet}" data-count="${b.count}"
              aria-label="${esc(label(b))}: ${rupiah(b.omzet)}">
              <span class="bar" style="height:${b.omzet ? Math.max(1.5, (b.omzet / nice) * 100) : 0}%"></span>
              <span class="bar-tick">${i % every === 0 ? tick(b) : ''}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function meterList(list, total) {
  if (!list.length) return '<p class="muted">—</p>';
  const max = list[0].omzet || 1;
  return `<ul class="meter-list">${list.map((c) => `
    <li>
      <span class="mt-name">${esc(c.name)}</span>
      <span class="mt-val">${rupiah(c.omzet)} <span class="muted">· ${Math.round((c.omzet / total) * 100)}%</span></span>
      <span class="rk-bar"><span style="width:${Math.max(2, (c.omzet / max) * 100)}%"></span></span>
    </li>`).join('')}</ul>`;
}

async function showDetail(id) {
  const d = await getTransactionDetail(id);
  if (!d) return;
  const t = d.transaction;
  openModal(`
    <div class="modal-head">
      <div><h2>${esc(whoLine(t) || 'Tanpa nama')}</h2>
        <div class="small muted">#${esc(t.queueNo)} · ${parseDateKey(t.paidDateKey || t.dateKey).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · lunas ${time(t.paidAt || t.createdAt)}</div></div>
      <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button>
    </div>
    <ul class="detail-items">${d.items.map((it) => `
      <li><span class="di-main"><span><b>${it.qty}×</b> ${esc(it.name)}</span>
        ${it.note ? `<span class="ti-note">${esc(it.note)}</span>` : ''}</span>
        <span class="di-sub">${rupiah(it.subtotal)}</span></li>`).join('')}</ul>
    <div class="cart-row total"><span>Total</span><span>${rupiah(t.total)}</span></div>
    <table class="simple">
      <tr><td>Tunai</td><td>${rupiah(t.cashReceived)}</td></tr>
      <tr><td>Kembalian</td><td>${rupiah(t.change)}</td></tr>
      ${(t.cancellations || []).length ? `<tr><td>Dibatalkan</td><td>${t.cancellations.map((c) => `${c.qty}× ${esc(c.name)}`).join(', ')}</td></tr>` : ''}
    </table>`, { wide: true });
}
