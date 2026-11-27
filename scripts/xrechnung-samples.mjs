/**
 * Erzeugt Beispiel-E-Rechnungen (XRechnung 3.0, Syntax CII) für die Prüfung mit dem KoSIT-Validator:
 * eine Datei je fachlichem Sonderfall. Optional zusätzlich ZUGFeRD-PDFs (PDF/A-3) zur Prüfung mit veraPDF.
 *
 * Aufruf: node scripts/xrechnung-samples.mjs <zielordner> [--pdf]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCII, invoiceTotals, createStorno } from '../js/invoice.js';
import { sampleSettings, sampleInvoice } from './samples.mjs';

const out = process.argv[2] ?? 'xrechnung-out';
const withPdf = process.argv.includes('--pdf');
mkdirSync(out, { recursive: true });

const item = (description, unitPrice, taxType = 'S19', extra = {}) => ({ description, details: '', quantity: '1', unit: 'H87', unitPrice, taxType, discount: null, ...extra });
const variant = (mutate) => {
  const s = sampleSettings();
  const i = sampleInvoice();
  mutate(s, i);
  return [s, i];
};

export const variants = {
  // gemischte Steuersätze, Positionsrabatt, Skonto, Leistungszeitraum
  standard: [sampleSettings(), sampleInvoice()],
  // Gesamtrabatt über mehrere Steuerarten + Nullsteuersatz, festes Fälligkeitsdatum, BIC & USt-IdNr.
  gesamtrabatt: variant((s, i) => {
    Object.assign(s.company, { vatId: 'DE136695976', bic: 'COBADEFFXXX' });
    i.items.push(item('Photovoltaikmodul', '199,00', 'Z'));
    Object.assign(i, { discount: { type: 'percent', value: '7,5' }, paymentDays: 'custom', dueDate: '2027-01-15', skonto: { enabled: false } });
  }),
  // Kleinunternehmer nach § 19 UStG, öffentlicher Auftraggeber mit Leitweg-ID
  kleinunternehmer: variant((s, i) => {
    s.kleinunternehmer = true;
    Object.assign(i.customer, { reference: '04011000-12345-03', isPublic: true });
    i.discount = { type: 'amount', value: '20' };
  }),
  // Leistungsdatum = Rechnungsdatum, sofort fällig, ohne Skonto
  sofort: variant((s, i) => {
    Object.assign(i, { serviceMode: 'same', serviceFrom: '', serviceTo: '', paymentDays: 0, skonto: { enabled: false } });
    i.items = [i.items[0]];
  }),
  // einzelner Leistungstag
  leistungstag: variant((s, i) => { Object.assign(i, { serviceMode: 'date', serviceFrom: '2026-11-20', serviceTo: '' }); }),
  // Bruttopreise, bei denen ein Rundungsbetrag (BT-114) nötig ist
  brutto_rundung: variant((s, i) => {
    Object.assign(i, { pricesGross: true, skonto: { enabled: false } });
    i.items = [item('Zubehörpaket', '99,99'), item('Kleinteil', '0,03')];
  }),
  // Bruttopreise mit zwei Steuersätzen, Positions- und Gesamtrabatt, Skonto
  brutto_gemischt: variant((s, i) => {
    Object.assign(i, { pricesGross: true, discount: { type: 'amount', value: '5' } });
    i.items = [item('Laptoptasche', '11,90', 'S19', { quantity: '3' }), item('Ratgeber', '10,70', 'S7', { quantity: '2', discount: { type: 'percent', value: '10' } })];
  }),
  // Einzelpreise mit vier Nachkommastellen, negative Position (Gutschrift Altgerät)
  vier_nachkommastellen: variant((s, i) => {
    i.items = [item('Schrauben', '0,0150', 'S19', { quantity: '1000' }), item('Webdesign', '850'), item('Gutschrift Altgerät', '-50')];
  }),
  // Reverse-Charge (§ 13b UStG) an deutschen Unternehmer
  reverse_charge: variant((s, i) => {
    i.customer.vatId = 'DE136695976';
    i.items.forEach((x) => { x.taxType = 'AE'; });
  }),
  // Innergemeinschaftliche Lieferung nach Österreich
  eu_lieferung: variant((s, i) => {
    s.company.vatId = 'DE136695976';
    Object.assign(i.customer, { country: 'AT', zip: '1010', city: 'Wien', street: 'Ringstraße 1', vatId: 'ATU12345678' });
    i.items.forEach((x) => { x.taxType = 'K'; });
  }),
  // Ausfuhrlieferung in die Schweiz
  ausfuhr: variant((s, i) => {
    s.company.vatId = 'DE136695976';
    Object.assign(i.customer, { country: 'CH', zip: '8001', city: 'Zürich', street: 'Bahnhofstrasse 1' });
    i.items.forEach((x) => { x.taxType = 'G'; });
  }),
  // Steuerfreie Leistung nach § 4 UStG neben einer steuerpflichtigen
  steuerfrei: variant((s, i) => {
    i.items[0].taxType = 'E';
    i.exemptionReason = 'Steuerfreie Leistung nach § 4 Nr. 21 UStG (Unterrichtsleistung)';
  }),
  // Differenzbesteuerung nach § 25a UStG (Gebrauchtwaren)
  differenzbesteuerung: variant((s, i) => {
    i.items = [item('Gebrauchtes Notebook Lenovo ThinkPad T14', '449,00', 'M')];
    i.pricesGross = true;
  }),
  // Rechtsform GmbH mit Registerangaben
  gmbh: variant((s, i) => {
    Object.assign(s.company, { name: 'Muster Web GmbH', legalForm: 'gmbh', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B', officers: 'Max Mustermann', vatId: 'DE136695976' });
  }),
  // Abschlagsrechnung (326)
  abschlag: variant((s, i) => {
    i.kind = 'partial';
    i.items = [item('1. Abschlag Website-Relaunch (30 %)', '1.500,00', 'S19', { unit: 'LS' })];
  }),
  // Schlussrechnung mit abgezogenem Abschlag
  schlussrechnung: variant((s, i) => {
    i.kind = 'final';
    i.prepayments = [{ number: 'RE-2026-0000', date: '2026-10-01', gross: '500,00', tax: '79,83' }];
  }),
  // Stornorechnung (381) mit Verweis auf die Originalrechnung
  storno: (() => {
    const s = sampleSettings();
    return [s, createStorno({ ...sampleInvoice(), status: 'erstellt' }, { id: 'st', number: 'RE-2026-0002', date: '2026-11-27' })];
  })(),
  // Fremdwährung mit Umsatzsteuer in Euro (BT-111)
  fremdwaehrung: variant((s, i) => { Object.assign(i, { currency: 'USD', fxRate: '0,9234', giroCode: false }); }),
};

const context = { today: '2026-11-27' };
const fonts = withPdf ? Object.fromEntries([['regular', 400], ['semibold', 600], ['bold', 700]].map(([k, w]) => [k, readFileSync(new URL(`../fonts/inter-pdf-${w}.ttf`, import.meta.url))])) : null;
const { buildInvoiceView } = withPdf ? await import('../js/view.js') : {};
const { createInvoicePdf } = withPdf ? await import('../js/invoice-pdf.js') : {};

for (const [name, [settings, invoice]] of Object.entries(variants)) {
  writeFileSync(join(out, `${name}.xml`), toCII(invoice, settings, { profile: 'xrechnung', context }));
  if (withPdf) {
    const xml = toCII(invoice, settings, { profile: 'en16931', context });
    const view = buildInvoiceView(invoice, settings, invoiceTotals(invoice, settings), { color: '#1D2939', head: 'filled' });
    const pdf = await createInvoicePdf(view, { fonts, iccProfile: readFileSync(new URL('../assets/sRGB.icc', import.meta.url)), einvoice: { xml, conformance: 'EN 16931' } });
    mkdirSync(join(out, 'zugferd'), { recursive: true });
    writeFileSync(join(out, 'zugferd', `${name}.pdf`), pdf);
  }
  console.log(`✓ ${name}`);
}
