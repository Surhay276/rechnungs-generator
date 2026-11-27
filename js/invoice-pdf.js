/**
 * Setzt die Rechnung als PDF: Maße, Schriftgrößen und Abstände entsprechen der Vorschau
 * (DIN-5008-nahe Ränder: oben 15 mm, rechts 20 mm, unten 12 mm, links 25 mm).
 * Mehrseitige Rechnungen: Tabellenkopf wiederholt sich, Fußzeile und Seitenzahl auf jeder Seite.
 */
import { PdfDocument, MM, wrapText } from './pdf.js?v=28';

export const FACTUR_X_FILE = 'factur-x.xml';

/** XMP-Erweiterung für Factur-X/ZUGFeRD: beschreibt die eingebettete XML (Pflicht für PDF/A-3). */
function facturXmp(conformance = 'EN 16931') {
  const prop = (name, description) => '<rdf:li rdf:parseType="Resource">'
    + `<pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType>`
    + `<pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`;
  return '<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">'
    + '<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">'
    + '<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>'
    + '<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>'
    + '<pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>'
    + prop('DocumentFileName', 'name of the embedded XML invoice file')
    + prop('DocumentType', 'INVOICE')
    + prop('Version', 'The actual version of the Factur-X data')
    + prop('ConformanceLevel', 'The conformance level of the Factur-X data')
    + '</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>\n'
    + '<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">'
    + `<fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${FACTUR_X_FILE}</fx:DocumentFileName>`
    + `<fx:Version>1.0</fx:Version><fx:ConformanceLevel>${conformance}</fx:ConformanceLevel></rdf:Description>`;
}

const INK = '#1d2939';
const INK_2 = '#344054';
const GRAY = '#667085';
const LINE = '#eaecf0';
const BASE = 9.5;
const LH = 1.45;

/**
 * @param view   Ergebnis von buildInvoiceView()
 * @param fonts  { regular, semibold, bold }: TrueType-Dateien als ArrayBuffer/Uint8Array
 * @param logo   { width, height, rgb, alpha }: Rohpixel des Logos (optional)
 * @param iccProfile  sRGB-Farbprofil: mit Profil entsteht ein PDF/A-3b (Langzeitarchiv)
 * @param einvoice    { xml, conformance }: eingebettete E-Rechnung (ZUGFeRD 2 / Factur-X), setzt iccProfile voraus
 * @returns Promise<Uint8Array>: die fertige PDF-Datei
 */
export async function createInvoicePdf(view, { fonts, logo = null, date = new Date(), iccProfile = null, einvoice = null }) {
  const doc = new PdfDocument();
  doc.info = { title: `${view.title} ${view.number}`, author: view.companyName, subject: `${view.title} ${view.number}`, creator: 'Rechnungsgenerator', date };
  if (iccProfile) doc.pdfa = { iccProfile, xmp: einvoice ? [facturXmp(einvoice.conformance)] : [] };
  if (einvoice) {
    if (!iccProfile) throw new Error('ZUGFeRD braucht PDF/A-3. Bitte das Farbprofil mitgeben.');
    doc.attach({ name: FACTUR_X_FILE, data: einvoice.xml, mime: 'text/xml', description: 'E-Rechnung (ZUGFeRD / Factur-X, EN 16931)', relationship: 'Alternative', modified: date });
  }
  const R = doc.addFont('Inter-Regular', fonts.regular);
  const S = doc.addFont('Inter-SemiBold', fonts.semibold);
  const B = doc.addFont('Inter-Bold', fonts.bold);
  const t = view.theme;

  const left = 25 * MM;
  const right = doc.width - 20 * MM;
  const W = right - left;
  const top = 15 * MM;
  const pageBottom = doc.height - 12 * MM;

  // ---------- Text-Helfer ----------
  /** Abstand von der Oberkante der Zeile bis zur Grundlinie: wie CSS (halber Durchschuss oben und unten). */
  const baseline = (font, size, lh) => ((lh - (font.ascent - font.descent) / font.unitsPerEm) * size) / 2 + (font.ascent / font.unitsPerEm) * size;
  /** Zeichnet umbrochenen Text ab Oberkante y, gibt die Höhe zurück. */
  function block(text, x, y, width, { font = R, size = BASE, lh = LH, color = INK, align = 'left', draw = true, nowrap = false } = {}) {
    const lines = nowrap ? [String(text ?? '')] : wrapText(text, font, size, width);
    if (draw) {
      lines.forEach((line, i) => {
        const w = font.width(line, size);
        const dx = align === 'right' ? width - w : align === 'center' ? (width - w) / 2 : 0;
        doc.text(line, x + dx, y + i * size * lh + baseline(font, size, lh), { font, size, color });
      });
    }
    return lines.length * size * lh;
  }
  const measure = (text, width, opts) => block(text, 0, 0, width, { ...opts, draw: false });
  const widest = (texts, font, size) => Math.max(0, ...texts.map((s) => font.width(s, size)));

  // ---------- Fußzeile (vorab messen, damit der Platz unten frei bleibt) ----------
  const footGap = 8 * MM;
  const footCols = [1.15, 1, 1].map((fr) => ((W - 2 * footGap) * fr) / 3.15);
  const footSize = 7.5;
  const footLines = view.footer.map((col, i) => col.flatMap((entry) => wrapText(entry.text, entry.bold ? B : R, footSize, footCols[i]).map((text) => ({ text, bold: entry.bold }))));
  const footHeight = 3.5 * MM + Math.max(1, ...footLines.map((l) => l.length)) * footSize * 1.5;
  const footTop = pageBottom - footHeight;
  const bodyBottom = footTop - 4 * MM; // wie .inv-body-end in der Vorschau

  // ---------- Seitenumbruch ----------
  let y = top;
  doc.addPage();
  function newPage() {
    doc.addPage();
    y = top;
    block(`${view.title} ${view.number} · Fortsetzung`, left, y, W, { size: 8, color: GRAY });
    y += 9 * MM;
  }
  const ensure = (h) => { if (y + h > bodyBottom) { newPage(); return true; } return false; };

  // ---------- Kopf: Titel links, Logo oder Firmenname rechts ----------
  const titleSize = 24;
  let headH = Math.max(18 * MM, titleSize * LH);
  block(view.title, left, y, W / 2, { font: B, size: titleSize, color: t.text });
  if (logo) {
    const scale = Math.min((55 * MM) / logo.width, (24 * MM) / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    doc.image(doc.addImage(logo), right - w, y, w, h);
    headH = Math.max(headH, h);
  } else {
    const h = block(view.brand, right - 70 * MM, y, 70 * MM, { font: B, size: 13, color: t.text, align: 'right' });
    headH = Math.max(headH, h);
  }
  y += headH;

  // ---------- Absenderzeile über der Anschrift ----------
  if (view.sender) {
    y += 8 * MM;
    const size = 7;
    const lines = wrapText(view.sender, R, size, W);
    const h = block(view.sender, left, y, W, { size, color: GRAY });
    doc.line(left, y + h + 1, left + widest(lines, R, size), y + h + 1, { color: '#d0d5dd', width: 0.75 });
    y += h + 1;
  }

  // ---------- Anschrift links, Rechnungsdaten rechts ----------
  y += 4 * MM;
  const dtW = widest(view.meta.map(([dt]) => dt), S, BASE);
  const ddW = Math.min(55 * MM, widest(view.meta.map(([, dd]) => dd), R, BASE));
  const metaW = dtW + 8 * MM + ddW;
  const metaX = right - metaW;
  let my = y;
  for (const [dt, dd] of view.meta) {
    const h1 = block(dt, metaX, my, dtW, { font: S, color: t.text });
    const h2 = block(dd, metaX + dtW + 8 * MM, my, ddW, { color: INK_2 });
    my += Math.max(h1, h2) + 1.8 * MM;
  }
  const recW = metaX - 12 * MM - left;
  let ry = y;
  ry += block(view.recipient.name, left, ry, recW, { font: B });
  ry += 0.5 * MM;
  if (view.recipient.address) ry += block(view.recipient.address, left, ry, recW, { color: INK_2 });
  y = Math.max(ry, my - 1.8 * MM, y + 24 * MM) + 8 * MM;

  // ---------- Kopfzeile (Anrede) ----------
  if (view.intro) {
    ensure(BASE * LH * 2);
    y += block(view.intro, left, y, W) + 5 * MM;
  }

  // ---------- Leistungen ----------
  const padX = 3 * MM;
  const headSize = 8.5;
  const cols = [
    { key: 'pos', head: 'Pos.', fixed: Math.max(11 * MM, S.width('Pos.', headSize) + 2 * padX + 1) },
    { key: 'description', head: 'Beschreibung' },
    { key: 'quantity', head: 'Menge', num: true },
    { key: 'price', head: view.priceHead ?? 'Einzelpreis', num: true },
    view.showTax && { key: 'tax', head: 'USt', num: true },
    { key: 'total', head: view.totalHead ?? 'Betrag', num: true },
  ].filter(Boolean);
  for (const col of cols) {
    if (col.num) col.width = Math.max(S.width(col.head, headSize), widest(view.rows.map((r) => r[col.key]), R, BASE)) + 4.5 * MM + padX + 1;
  }
  const descCol = cols.find((c) => c.key === 'description');
  descCol.width = W - cols.filter((c) => c !== descCol).reduce((s, c) => s + (c.width ?? c.fixed), 0);
  let cx = left;
  for (const col of cols) { col.width ??= col.fixed; col.x = cx; cx += col.width; }
  const cellX = (col) => (col.num ? col.x + 4.5 * MM : col.x + padX);
  const cellW = (col) => col.width - padX - (col.num ? 4.5 * MM : padX);

  const headerH = 2 * 2.5 * MM + headSize * LH;
  function tableHeader() {
    const light = view.headStyle === 'light';
    doc.rect(left, y, W, headerH, { fill: light ? t.soft : t.accent });
    if (light) doc.rect(left, y + headerH - 1.1, W, 1.1, { fill: t.accent });
    for (const col of cols) {
      block(col.head, cellX(col), y + 2.5 * MM, cellW(col), { font: S, size: headSize, color: light ? t.text : t.onAccent, align: col.num ? 'right' : 'left', nowrap: col !== descCol });
    }
    y += headerH;
  }
  ensure(headerH + 14 * MM);
  tableHeader();

  const rowPad = 2.6 * MM;
  view.rows.forEach((row) => {
    const descH = measure(row.description, cellW(descCol), { font: B })
      + row.details.reduce((s, d) => s + 1 * MM + measure(d, cellW(descCol), { size: 8.5 }), 0);
    const h = rowPad * 2 + Math.max(descH, BASE * LH);
    if (ensure(h)) tableHeader();
    for (const col of cols) {
      const cy = y + rowPad;
      if (col === descCol) {
        let dy = cy + block(row.description, cellX(col), cy, cellW(col), { font: B });
        for (const d of row.details) dy += 1 * MM + block(d, cellX(col), dy + 1 * MM, cellW(col), { size: 8.5, color: GRAY });
      } else {
        block(row[col.key], cellX(col), cy, cellW(col), { color: col.key === 'pos' ? GRAY : INK, align: col.num ? 'right' : 'left', nowrap: true });
      }
    }
    y += h;
    doc.line(left, y - 0.375, right, y - 0.375, { color: LINE, width: 0.75 });
  });

  // ---------- Summen (rechte Hälfte, bleiben zusammen) ----------
  const sums = view.sums ?? [{ label: 'Bitte gültige Beträge eingeben.', value: '' }];
  const sumW = W / 2;
  const sumX = right - sumW;
  const sumRowH = (s, i) => (s.grand ? 2 * 3 * MM + 10.5 * LH + (i ? 3 : 0) : (i ? 1.6 * MM : 0) + 1.6 * MM + BASE * LH);
  const sumsH = 3 * MM + sums.reduce((h, s, i) => h + sumRowH(s, i), 0);
  ensure(sumsH);
  y += 3 * MM;
  sums.forEach((s, i) => {
    if (s.grand) {
      if (i) y += 3;
      doc.rect(sumX, y, sumW, 2 * 3 * MM + 10.5 * LH, { fill: t.soft });
      block(s.label, sumX + padX, y + 3 * MM, sumW / 2, { font: B, size: 10.5, color: t.text });
      block(s.value, sumX + sumW / 2, y + 3 * MM, sumW / 2 - padX, { font: B, size: 10.5, color: t.text, align: 'right' });
      y += 2 * 3 * MM + 10.5 * LH;
    } else {
      y += i ? 1.6 * MM : 0;
      const labelW = sumW - 2 * padX - R.width(s.value, BASE) - 4 * MM;
      const h = block(s.label, sumX + padX, y, labelW);
      block(s.value, sumX + padX, y, sumW - 2 * padX, { align: 'right', nowrap: true });
      y += h + 1.6 * MM;
    }
  });

  // ---------- Steuerhinweise (§ 14 Abs. 4 Nr. 8, § 14a, § 14b UStG) ----------
  view.notes.forEach((note, i) => {
    const gap = i ? 1.5 * MM : 5 * MM;
    ensure(gap + measure(note, W));
    y += gap + block(note, left, y + gap, W);
  });

  // ---------- Zahlungshinweis + GiroCode ----------
  if (view.payTexts.length || view.qr) {
    const qrSize = 24 * MM;
    const capSize = 6.8;
    const capLines = view.qr ? wrapText(view.qrCaption, R, capSize, 28 * MM) : [];
    const boxW = view.qr ? Math.max(qrSize, widest(capLines, R, capSize)) + 2 * 2.2 * MM : 0;
    const boxH = view.qr ? 2.2 * MM + qrSize + 1.5 * MM + capLines.length * capSize * 1.3 + 1.8 * MM : 0;
    const textW = W - (view.qr ? boxW + 12 * MM : 0);
    const textH = view.payTexts.reduce((h, p, i) => h + (i ? 3 * MM : 0) + measure(p, textW), 0);
    ensure(7 * MM + Math.max(textH, boxH));
    y += 7 * MM;
    let ty = y;
    view.payTexts.forEach((p, i) => { ty += (i ? 3 * MM : 0); ty += block(p, left, ty, textW); });
    if (view.qr) {
      const bx = right - boxW;
      doc.rect(bx, y, boxW, boxH, { stroke: LINE, lineWidth: 0.75, radius: 2 * MM });
      const n = view.qr.length;
      const unit = qrSize / (n + 4); // 2 Module Ruhezone rundherum, wie in der Vorschau
      const qx = bx + (boxW - qrSize) / 2 + 2 * unit;
      const qy = y + 2.2 * MM + 2 * unit;
      const runs = [];
      view.qr.forEach((rowMods, r) => {
        for (let c = 0; c < n; c++) {
          if (!rowMods[c]) continue;
          let end = c;
          while (end + 1 < n && rowMods[end + 1]) end++;
          runs.push([qx + c * unit, qy + r * unit, (end - c + 1) * unit, unit]);
          c = end;
        }
      });
      doc.rects(runs, '#000000');
      block(view.qrCaption, bx + 2.2 * MM, y + 2.2 * MM + qrSize + 1.5 * MM, boxW - 4.4 * MM, { size: capSize, lh: 1.3, color: '#475467', align: 'center' });
    }
    y += Math.max(textH, boxH);
  }

  // ---------- Anmerkungen / Grußformel ----------
  if (view.note) {
    const lines = wrapText(view.note, R, BASE, W);
    // Grußformel nicht von der Unterschriftszeile trennen: kurze Texte bleiben zusammen
    if (lines.length <= 8) ensure(5 * MM + lines.length * BASE * LH);
    y += 5 * MM;
    for (const line of lines) {
      ensure(BASE * LH);
      y += block(line, left, y, W);
    }
  }

  // ---------- Fußzeile + Seitenzahlen auf jeder Seite ----------
  const total = doc.pages.length;
  doc.pages.forEach((page, i) => {
    doc.page = page;
    doc.line(left, footTop, right, footTop, { color: LINE, width: 0.75 });
    let fx = left;
    footLines.forEach((lines, c) => {
      lines.forEach((l, j) => {
        const font = l.bold ? B : R;
        doc.text(l.text, fx, footTop + 3.5 * MM + j * footSize * 1.5 + baseline(font, footSize, 1.5), { font, size: footSize, color: l.bold ? INK_2 : GRAY });
      });
      fx += footCols[c] + footGap;
    });
    // Seitenzahl im unteren Rand: nimmt dem Inhalt keinen Platz weg
    if (total > 1) block(`Seite ${i + 1} von ${total}`, left, pageBottom + 3 * MM, W, { size: 7, color: GRAY, align: 'right' });
  });

  return doc.save();
}
