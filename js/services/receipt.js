// Struk & tagihan: isi dari transaksi + pengaturan usaha.
// Bisa ditampilkan, dicetak (AirPrint / dialog cetak), atau dibagikan sebagai gambar PNG.
// Semua dibuat di perangkat — tidak perlu internet.
import { getSetting } from '../db.js';
import { getTransactionDetail } from './sales.js';
import { esc, rupiah, toast, openModal, shareOrDownload } from '../ui.js';

const LOGO_URL = './icons/icon-192.png';

export async function getReceiptSettings() {
  const [name, address, phone, footer, showLogo, width] = await Promise.all([
    getSetting('businessName', 'CT Catering'),
    getSetting('businessAddress', ''),
    getSetting('businessPhone', ''),
    getSetting('receiptFooter', 'Terima kasih atas kunjungan Anda'),
    getSetting('receiptShowLogo', true),
    getSetting('receiptWidth', 58),
  ]);
  return { name, address, phone, footer, showLogo: showLogo !== false, width: width === 80 ? 80 : 58 };
}

const num = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/** Data struk yang siap ditampilkan / digambar. */
export function receiptModel(detail, settings) {
  const t = detail.transaction;
  const paid = t.status === 'paid';
  const when = paid ? (t.paidAt || t.createdAt) : new Date().toISOString();
  return {
    settings,
    title: paid ? '' : 'TAGIHAN',
    paid,
    meta: [
      ['No.', `#${t.queueNo}`],
      ['Tanggal', `${fmtDate(when)} ${fmtTime(when)}`],
      ...(t.tableNo ? [['Meja', t.tableNo]] : []),
      ...(t.customerName ? [['Nama', t.customerName]] : []),
    ],
    items: detail.items.filter((it) => it.qty > 0).map((it) => ({
      name: it.name, qty: it.qty, price: it.price, subtotal: it.price * it.qty, note: it.note || '',
    })),
    count: detail.items.reduce((a, it) => a + (it.qty > 0 ? it.qty : 0), 0),
    total: t.total,
    cash: paid ? t.cashReceived : null,
    change: paid ? t.change : null,
    number: t.number,
  };
}

/** HTML struk (dipakai untuk pratinjau dan cetak). */
export function receiptHtml(m) {
  const s = m.settings;
  return `
    <div class="receipt w${s.width}">
      ${s.showLogo ? `<img class="rc-logo" src="${LOGO_URL}" alt="">` : ''}
      <div class="rc-name">${esc(s.name)}</div>
      ${s.address ? `<div class="rc-center">${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div class="rc-center">Telp. ${esc(s.phone)}</div>` : ''}
      ${m.title ? `<div class="rc-title">${m.title}</div>` : ''}
      <div class="rc-sep"></div>
      ${m.meta.map(([k, v]) => `<div class="rc-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
      <div class="rc-sep"></div>
      ${m.items.map((it) => `
        <div class="rc-item">${esc(it.name)}</div>
        <div class="rc-row"><span>${it.qty} x ${num(it.price)}</span><span>${num(it.subtotal)}</span></div>
        ${it.note ? `<div class="rc-note">(${esc(it.note)})</div>` : ''}`).join('')}
      <div class="rc-sep"></div>
      <div class="rc-row rc-total"><span>TOTAL</span><span>${num(m.total)}</span></div>
      ${m.paid ? `
        <div class="rc-row"><span>Tunai</span><span>${num(m.cash)}</span></div>
        <div class="rc-row"><span>Kembali</span><span>${num(m.change)}</span></div>` : `
        <div class="rc-center rc-due">Belum dibayar</div>`}
      <div class="rc-sep"></div>
      <div class="rc-center small-rc">${m.count} porsi</div>
      ${s.footer ? `<div class="rc-center rc-footer">${esc(s.footer)}</div>` : ''}
    </div>`;
}

// ---------- Gambar PNG (canvas) ----------

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Gambar struk ke PNG. Lebar mengikuti kertas: 58 mm ≈ 384 px, 80 mm ≈ 576 px (×2 agar tajam). */
export async function receiptPng(m) {
  const S = 2;
  const W = (m.settings.width === 80 ? 576 : 384);
  const pad = 16;
  const inner = W - pad * 2;
  const FONT = '"SF Mono", Menlo, Consolas, "Courier New", monospace';
  const fs = m.settings.width === 80 ? 20 : 17;
  const lh = Math.round(fs * 1.45);
  const logo = m.settings.showLogo ? await loadImage(LOGO_URL) : null;

  // Susun perintah gambar dulu agar tinggi kanvas diketahui.
  const meas = document.createElement('canvas').getContext('2d');
  const ops = [];
  let y = pad;
  const text = (str, align = 'left', { bold = false, size = fs } = {}) => {
    meas.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    for (const ln of wrap(meas, str, inner)) { ops.push({ t: 'text', str: ln, align, bold, size, y }); y += Math.round(size * 1.45); }
  };
  const row = (l, r, bold = false) => { ops.push({ t: 'row', l, r, bold, y }); y += lh; };
  const sep = () => { ops.push({ t: 'sep', y: y + lh / 2 }); y += lh; };

  if (logo) { ops.push({ t: 'logo', y }); y += 96 + 8; }
  text(m.settings.name, 'center', { bold: true, size: fs + 4 });
  if (m.settings.address) text(m.settings.address, 'center');
  if (m.settings.phone) text(`Telp. ${m.settings.phone}`, 'center');
  if (m.title) { y += 4; text(m.title, 'center', { bold: true, size: fs + 2 }); }
  sep();
  for (const [k, v] of m.meta) row(k, v);
  sep();
  for (const it of m.items) {
    text(it.name);
    row(`${it.qty} x ${num(it.price)}`, num(it.subtotal));
    if (it.note) text(`(${it.note})`);
  }
  sep();
  row('TOTAL', num(m.total), true);
  if (m.paid) { row('Tunai', num(m.cash)); row('Kembali', num(m.change)); } else text('Belum dibayar', 'center', { bold: true });
  sep();
  text(`${m.count} porsi`, 'center');
  if (m.settings.footer) text(m.settings.footer, 'center');
  y += pad;

  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = y * S;
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, y);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  for (const o of ops) {
    if (o.t === 'logo') ctx.drawImage(logo, (W - 96) / 2, o.y, 96, 96);
    else if (o.t === 'text') {
      ctx.font = `${o.bold ? 'bold ' : ''}${o.size}px ${FONT}`;
      ctx.textAlign = o.align;
      ctx.fillText(o.str, o.align === 'center' ? W / 2 : pad, o.y);
    } else if (o.t === 'row') {
      ctx.font = `${o.bold ? 'bold ' : ''}${o.bold ? fs + 2 : fs}px ${FONT}`;
      ctx.textAlign = 'left'; ctx.fillText(o.l, pad, o.y);
      ctx.textAlign = 'right'; ctx.fillText(o.r, W - pad, o.y);
    } else if (o.t === 'sep') {
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad, o.y); ctx.lineTo(W - pad, o.y); ctx.stroke();
    }
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

// ---------- Cetak ----------

/** Cetak struk lewat dialog cetak perangkat (AirPrint di iPad). */
export function printReceipt(m) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = receiptHtml(m);
  // Ukuran kertas mengikuti pengaturan.
  let pageStyle = document.getElementById('print-page-style');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'print-page-style';
    document.head.appendChild(pageStyle);
  }
  // Tanpa memaksa ukuran kertas: struk tetap selebar 58/80 mm di kertas apa pun (A4 atau gulung).
  pageStyle.textContent = `@page { margin: 4mm; } /* struk ${m.settings.width}mm */`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Tunggu logo termuat sebelum mencetak.
  const img = root.querySelector('img');
  const go = () => { try { window.print(); } catch (_) { toast('Cetak tidak didukung di perangkat ini. Pakai "Bagikan gambar".', { error: true }); } };
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
}

// ---------- Modal Struk ----------

/** Buka struk / tagihan untuk satu transaksi. */
export async function openReceipt(transactionId) {
  const [detail, settings] = await Promise.all([getTransactionDetail(transactionId), getReceiptSettings()]);
  if (!detail) { toast('Transaksi tidak ditemukan.', { error: true }); return; }
  showReceiptModal(receiptModel(detail, settings));
}

export function showReceiptModal(m) {
  const { el } = openModal(`
    <div class="modal-head"><h2>${m.paid ? 'Struk' : 'Tagihan'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Tutup">✕</button></div>
    <div class="receipt-preview">${receiptHtml(m)}</div>
    <div class="btn-row">
      <button type="button" class="btn secondary" id="rc-share">Bagikan gambar</button>
      <button type="button" class="btn" id="rc-print">Cetak</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">Cetak memakai printer AirPrint. Tanpa printer, pakai <b>Bagikan gambar</b> untuk mengirim lewat WhatsApp atau AirDrop.</p>`);
  el.querySelector('#rc-print').addEventListener('click', () => printReceipt(m));
  el.querySelector('#rc-share').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const blob = await receiptPng(m);
      const file = new File([blob], `${m.paid ? 'struk' : 'tagihan'}-${m.number || 'contoh'}.png`, { type: 'image/png' });
      await shareOrDownload(file, m.paid ? 'Struk' : 'Tagihan');
    } catch (err) {
      toast('Gagal membuat gambar: ' + err.message, { error: true });
    } finally {
      btn.disabled = false;
    }
  });
}

/** Contoh struk untuk Pengaturan. */
export async function previewSample() {
  const settings = await getReceiptSettings();
  const now = new Date().toISOString();
  showReceiptModal(receiptModel({
    transaction: {
      status: 'paid', queueNo: '001', number: 'contoh', paidAt: now, createdAt: now,
      tableNo: '5', customerName: 'Bu Rina', total: 85000, cashReceived: 100000, change: 15000,
    },
    items: [
      { name: 'Ayam Napinadar', qty: 2, price: 35000, note: 'pedas' },
      { name: 'Nasi Putih', qty: 2, price: 5000 },
      { name: 'Es Teh Manis', qty: 1, price: 5000 },
    ],
  }, settings));
}
