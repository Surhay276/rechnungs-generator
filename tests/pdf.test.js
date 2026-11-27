import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { calculateTotals, invoiceTotals, toCII } from '../js/invoice.js';
import { buildInvoiceView, pdfFileName } from '../js/view.js';
import { createInvoicePdf } from '../js/invoice-pdf.js';
import { parseFont, wrapText, Font } from '../js/pdf.js';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs';

const font = (w) => readFileSync(new URL(`../fonts/inter-pdf-${w}.ttf`, import.meta.url));
const fonts = { regular: font(400), semibold: font(600), bold: font(700) };

async function render(mutate = () => {}) {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  mutate(inv, settings);
  const view = buildInvoiceView(inv, settings, invoiceTotals(inv, settings), { color: '#1D2939', head: 'filled' });
  const bytes = await createInvoicePdf(view, { fonts, date: new Date(2026, 10, 27) });
  return { view, pdf: Buffer.from(bytes).toString('latin1'), bytes };
}

/** Text aller Seiten über die ToUnicode-Tabellen zurückgewinnen – so wie ein PDF-Viewer beim Kopieren. */
function extractText(pdf) {
  const streams = [...pdf.matchAll(/<< ([^]*?) >>\nstream\n([^]*?)\nendstream/g)].map(([, dict, data]) => {
    const raw = Buffer.from(data, 'latin1');
    return dict.includes('FlateDecode') ? inflateSync(raw).toString('latin1') : raw.toString('latin1');
  });
  const map = new Map();
  for (const s of streams.filter((x) => x.includes('beginbfchar'))) {
    for (const [, gid, uni] of s.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g)) map.set(gid, String.fromCharCode(...uni.match(/.{4}/g).map((h) => parseInt(h, 16))));
  }
  // Glyphen-IDs sind je Schrift verschieden – für den Test reicht: irgendeine Schrift kennt das Zeichen
  return streams.filter((s) => s.includes(' Tj ET')).map((s) => [...s.matchAll(/<([0-9a-f]+)> Tj/g)]
    .map(([, hex]) => hex.match(/.{4}/g).map((g) => map.get(g) ?? '?').join('')).join('\n')).join('\n');
}

test('PDF: gültiger Aufbau mit eingebetteten Schriften und Metadaten', async () => {
  const { pdf, bytes } = await render();
  assert.ok(pdf.startsWith('%PDF-1.7'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /\/Subtype \/CIDFontType2/);
  assert.match(pdf, /\/FontFile2 \d+ 0 R/);
  assert.match(pdf, /\/ToUnicode \d+ 0 R/);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 1);
  // Querverweise zeigen exakt auf die Objekte
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.ok(pdf.slice(xref).startsWith('xref'));
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `Objekt ${i + 1}`));
  assert.ok(bytes.length < 150_000, 'PDF bleibt klein');
});

test('PDF: enthält Rechnungsinhalt – auch Sonderzeichen wie ş, ı und €', async () => {
  const { pdf } = await render((inv) => { inv.customer.name = 'Şahin Yılmaz Bäckerei'; });
  const text = extractText(pdf);
  for (const s of ['Rechnung', 'RE-2026-0001', 'Şahin Yılmaz Bäckerei', 'Konzeption & Design OnePager', 'Rechnungsbetrag', '€', 'Jetzt mit dem']) {
    assert.ok(text.includes(s), `„${s}“ fehlt im PDF`);
  }
});

test('PDF: lange Rechnungen laufen auf Folgeseiten mit Seitenzahl', async () => {
  const { pdf } = await render((inv) => {
    for (let i = 0; i < 40; i++) inv.items.push({ description: `Position ${i + 4}`, details: '', quantity: '1', unit: 'H87', unitPrice: '10', taxRate: 19, discount: null });
  });
  const pages = (pdf.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 2);
  const text = extractText(pdf);
  assert.ok(text.includes(`Seite ${pages} von ${pages}`));
  assert.ok(text.includes('Fortsetzung'));
});

test('PDF: Logo wird mit Transparenz eingebettet', async () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  const view = buildInvoiceView(inv, settings, calculateTotals(inv.items), { color: '#1D2939', head: 'light' });
  const logo = { width: 4, height: 2, rgb: new Uint8Array(24).fill(200), alpha: new Uint8Array(8).fill(128) };
  const pdf = Buffer.from(await createInvoicePdf(view, { fonts, logo })).toString('latin1');
  assert.match(pdf, /\/Subtype \/Image \/Width 4 \/Height 2 \/ColorSpace \/DeviceRGB/);
  assert.match(pdf, /\/SMask \d+ 0 R/);
});

test('Schrift: Breiten, Unicode-Zuordnung und Zeilenumbruch', () => {
  const f = new Font('Inter', font(400));
  assert.equal(parseFont(font(400)).unitsPerEm, 2048);
  for (const ch of 'äöüßÄÖÜ€şğıİőű„“–') assert.ok(f.cmap.has(ch.codePointAt(0)), `Zeichen ${ch} fehlt in der PDF-Schrift`);
  assert.ok(f.width('WWW', 10) > f.width('iii', 10));
  const lines = wrapText('Ein ziemlich langer Satz, der umbrochen werden muss', f, 10, 80);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => f.width(l, 10) <= 80));
  assert.deepEqual(wrapText('Zeile 1\nZeile 2', f, 10, 500), ['Zeile 1', 'Zeile 2']);
});

test('Dateiname des PDFs: nur unproblematische Zeichen', () => {
  assert.equal(pdfFileName({ number: 'RE-2026-0001', customer: { name: 'Bäckerei Öz & Şahin GmbH' } }), 'RE-2026-0001 Baeckerei Oez & Sahin GmbH');
  assert.equal(pdfFileName({ number: 'RE-1', customer: { name: 'A/B: "C"' } }), 'RE-1 A-B- -C-');
  assert.equal(pdfFileName({ number: '', customer: { name: '' } }), 'Rechnung');
});

const icc = readFileSync(new URL('../assets/sRGB.icc', import.meta.url));

test('ZUGFeRD: PDF/A-3 mit eingebetteter E-Rechnung und passenden Metadaten', async () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  const xml = toCII(inv, settings, { profile: 'en16931', context: { today: '2026-11-27' } });
  const view = buildInvoiceView(inv, settings, invoiceTotals(inv, settings), { color: '#1D2939', head: 'filled' });
  const bytes = await createInvoicePdf(view, { fonts, date: new Date(Date.UTC(2026, 10, 27, 12)), iccProfile: icc, einvoice: { xml, conformance: 'EN 16931' } });
  const pdf = Buffer.from(bytes).toString('latin1');
  assert.match(pdf, /\/OutputIntents \[\d+ 0 R\]/);
  assert.match(pdf, /\/S \/GTS_PDFA1/);
  assert.match(pdf, /\/AFRelationship \/Alternative/);
  assert.match(pdf, /\/EmbeddedFiles << \/Names \[\(factur-x\.xml\) \d+ 0 R\]/);
  assert.match(pdf, /\/AF \[\d+ 0 R\]/);
  assert.match(pdf, /\/Subtype \/text#2Fxml/);
  assert.match(pdf, /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
  // XMP liegt unkomprimiert vor und spiegelt das Info-Verzeichnis
  assert.match(pdf, /<pdfaid:part>3<\/pdfaid:part><pdfaid:conformance>B<\/pdfaid:conformance>/);
  assert.match(pdf, /<fx:DocumentFileName>factur-x\.xml<\/fx:DocumentFileName>/);
  assert.match(pdf, /<fx:ConformanceLevel>EN 16931<\/fx:ConformanceLevel>/);
  assert.match(pdf, /<xmp:CreateDate>2026-11-27T12:00:00\+00:00<\/xmp:CreateDate>/);
  assert.match(pdf, /\/CreationDate \(D:20261127120000\+00'00'\)/);
  // Die eingebettete XML ist exakt die erzeugte E-Rechnung
  const ef = /\/Type \/EmbeddedFile [^]*?\/Length (\d+) >>\nstream\n/.exec(pdf);
  const start = ef.index + ef[0].length;
  const embedded = inflateSync(Buffer.from(pdf.slice(start, start + Number(ef[1])), 'latin1')).toString('utf8');
  assert.equal(embedded, xml);
});

test('PDF: Stornorechnung zeigt Titel, Verweis und negative Beträge', async () => {
  const { pdf, view } = await render((inv) => { Object.assign(inv, { kind: 'storno', number: 'RE-2026-0002', reference: { number: 'RE-2026-0001', date: '2026-11-01' }, skonto: { enabled: false } }); });
  assert.equal(view.title, 'Stornorechnung');
  const text = extractText(pdf);
  for (const s of ['Stornorechnung', 'Zu Rechnung', 'RE-2026-0001 vom 01.11.2026', '-1.495,99']) assert.ok(text.includes(s), `„${s}“ fehlt`);
});

test('PDF: Steuerhinweise erscheinen auf der Rechnung (§ 14a UStG)', async () => {
  const { pdf } = await render((inv, s) => {
    s.company.vatId = 'DE136695976';
    inv.items.forEach((i) => { i.taxType = 'AE'; });
    inv.customer.vatId = 'DE136695976';
  });
  const text = extractText(pdf);
  assert.ok(text.includes('Steuerschuldnerschaft des Leistungsempfängers'));
  assert.ok(text.includes('Ihre USt-IdNr.'));
});
