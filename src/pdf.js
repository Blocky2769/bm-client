// Shared BM PDF look — the header-band / detail-strip / totals / footer
// pattern used by WanBung's contribution report and SkulFi's fee receipt, so
// every BM app's PDF reads as one family. Import from '@bm/client/pdf'.
//
// jspdf is an OPTIONAL peer — only apps that import this subpath need it
// (it's ~130KB gzipped with transitive deps; lazy-import this module from a
// click handler so it stays out of the main bundle):
//
//   const { createA4, headerBand, detailStrip, totalBox, footerAllPages, savePdf }
//     = await import('@bm/client/pdf');
//
//   const pdf = createA4();
//   let y = headerBand(pdf, { color: [14,122,107], title: school.name,
//                             subtitle: 'Official Fee Receipt',
//                             rightTitle: `Ref: ${ref}`, rightSub: dateStr });
//   y = detailStrip(pdf, y, [['Student', name], ['Category', cat]]);
//   y = totalBox(pdf, y, { label: 'AMOUNT PAID', value: `K${amt}` });
//   footerAllPages(pdf, 'SkulFi · Powered by Blockchain Melanesia');
//   savePdf(pdf, `Receipt-${ref}`);
import jsPDF from 'jspdf';

// ── Palette (RGB) — the union of the colours BM PDFs use ─────────────────────
export const PDF_COLORS = {
  WHITE:  [255, 255, 255],
  LGRAY:  [245, 245, 245],
  MGRAY:  [170, 170, 170],
  DGRAY:  [80, 80, 80],
  DARK:   [26, 26, 46],     // #1A1A2E
  GOLD:   [232, 160, 32],   // #E8A020
  GREEN:  [39, 174, 96],
  ORANGE: [230, 126, 34],
  BLUE:   [44, 95, 138],
  RED:    [192, 57, 43],
  TEAL:   [22, 160, 133],
  PURPLE: [125, 60, 152],
};
const { WHITE, LGRAY, MGRAY, DARK, GOLD } = PDF_COLORS;

// A4 portrait + the shared geometry every helper needs.
export function createA4() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 14;
  return { doc, W, H, margin, contentW: W - margin * 2 };
}

export function hexToRgb(hex, fallback) {
  const n = String(hex || '').replace('#', '');
  if (n.length !== 6) return fallback;
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}

// Fetch an image URL into a data: URL for doc.addImage (null on any failure —
// callers should render a text-only header rather than fail the PDF).
export async function loadImageDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function imageFormat(dataUrl) {
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
}

// ── Header band: full-width colour block, optional logo, left title/subtitle/
//    meta, right-aligned title/sub. Returns the y to continue drawing at. ─────
export function headerBand(pdf, { color, height = 36, logoDataUrl = null, title, titleColor = WHITE, subtitle, meta, rightTitle, rightSub }) {
  const { doc, W, margin } = pdf;
  doc.setFillColor(...color);
  doc.rect(0, 0, W, height, 'F');

  let textX = margin;
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, imageFormat(logoDataUrl), margin, 8, 18, 18); textX = margin + 24; }
    catch { /* corrupt image — text-only header */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...titleColor);
  doc.text(title, textX, 16, { maxWidth: 110 });
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text(subtitle, textX, 23);
  }
  if (meta) {
    doc.setFontSize(7.5);
    doc.setTextColor(230, 230, 230);
    doc.text(meta, textX, 29);
  }
  if (rightTitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...WHITE);
    doc.text(rightTitle, W - margin, 14, { align: 'right' });
  }
  if (rightSub) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(230, 230, 230);
    doc.text(rightSub, W - margin, 20, { align: 'right' });
  }
  return height + 8;
}

// ── Detail strip: light rounded box of [label, value] columns. ───────────────
export function detailStrip(pdf, y, items, { height = 20 } = {}) {
  const { doc, margin, contentW } = pdf;
  const list = items.filter(Boolean);
  doc.setFillColor(...LGRAY);
  doc.roundedRect(margin, y, contentW, height, 2, 2, 'F');
  const colW = contentW / list.length;
  list.forEach(([label, value], i) => {
    const x = margin + i * colW + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MGRAY);
    doc.text(String(label).toUpperCase(), x, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    doc.text(String(value), x, y + 15, { maxWidth: colW - 6 });
  });
  return y + height + 10;
}

// ── KPI boxes: dark rounded tiles with a coloured value each. ────────────────
export function kpiBoxes(pdf, y, boxes, { height = 20 } = {}) {
  const { doc, margin, contentW } = pdf;
  const boxW = (contentW - 2 * (boxes.length - 1)) / boxes.length;
  boxes.forEach((box, i) => {
    const x = margin + i * (boxW + 2);
    doc.setFillColor(...DARK);
    doc.roundedRect(x, y, boxW, height, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MGRAY);
    doc.text(box.label, x + boxW / 2, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...(box.color || GOLD));
    doc.text(box.value, x + boxW / 2, y + 15, { align: 'center' });
  });
  return y + height + 6;
}

// ── Pill row: small filled status badges. ────────────────────────────────────
export function pillRow(pdf, y, pills) {
  const { doc, margin } = pdf;
  let x = margin;
  pills.forEach(pill => {
    const tw = doc.getTextWidth(pill.label) + 6;
    doc.setFillColor(...pill.color);
    doc.roundedRect(x, y, tw, 6, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...WHITE);
    doc.text(pill.label, x + 3, y + 4.2);
    x += tw + 3;
  });
  return y + 12;
}

// ── Total box: dark band, label left, big accent value right. ────────────────
export function totalBox(pdf, y, { label, value, valueColor = GOLD, height = 22 }) {
  const { doc, W, margin, contentW } = pdf;
  doc.setFillColor(...DARK);
  doc.roundedRect(margin, y, contentW, height, 2, 2, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MGRAY);
  doc.text(label, margin + 6, y + height / 2 + 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...valueColor);
  doc.text(value, W - margin - 6, y + height / 2 + 4, { align: 'right' });
  return y + height + 8;
}

// ── Totals row: dark band of centred label/value columns (report footers). ───
export function totalsRow(pdf, y, cols, { height = 18 } = {}) {
  const { doc, margin, contentW } = pdf;
  doc.setFillColor(...DARK);
  doc.roundedRect(margin, y, contentW, height, 2, 2, 'F');
  const colW = contentW / cols.length;
  cols.forEach(([label, val], i) => {
    const x = margin + i * colW + colW / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MGRAY);
    doc.text(label, x, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...GOLD);
    doc.text(val, x, y + 14, { align: 'center' });
  });
  return y + height + 6;
}

// ── Footer on every page: divider, left text, right page numbers. ────────────
export function footerAllPages(pdf, leftText) {
  const { doc, W, H, margin } = pdf;
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...MGRAY);
    doc.setLineWidth(0.3);
    doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MGRAY);
    doc.text(leftText, margin, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: 'right' });
  }
}

// ── Save with a filesystem-safe name. ────────────────────────────────────────
export function savePdf(pdf, name) {
  const safe = String(name)
    .replace(/—/g, '-')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
  pdf.doc.save(`${safe}.pdf`);
}
