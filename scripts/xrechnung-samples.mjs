/**
 * Erzeugt Beispiel-E-Rechnungen (XRechnung 3.0) für die Prüfung mit dem KoSIT-Validator.
 * Aufruf: node scripts/xrechnung-samples.mjs <zielordner>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toXRechnung } from '../js/invoice.js';
import { sampleSettings, sampleInvoice } from './samples.mjs';

const out = process.argv[2] ?? 'xrechnung-out';
mkdirSync(out, { recursive: true });

const variants = {
  // gemischte Steuersätze, Positionsrabatt, Skonto, Leistungszeitraum
  standard: [sampleSettings(), sampleInvoice()],
  // Gesamtrabatt über mehrere Steuersätze + 0-%-Position, festes Fälligkeitsdatum, BIC & USt-IdNr.
  gesamtrabatt: (() => {
    const s = sampleSettings();
    Object.assign(s.company, { vatId: 'DE123456789', bic: 'COBADEFFXXX' });
    const i = sampleInvoice();
    i.items.push({ description: 'Versandkosten Buch', details: '', quantity: '1', unit: 'C62', unitPrice: '4,95', taxRate: 0, discount: null });
    Object.assign(i, { discount: { type: 'percent', value: '7,5' }, paymentDays: 'custom', dueDate: '2027-01-15', skonto: { enabled: false } });
    return [s, i];
  })(),
  // Kleinunternehmer nach § 19 UStG, Leitweg-ID als Käuferreferenz
  kleinunternehmer: (() => {
    const s = sampleSettings();
    s.kleinunternehmer = true;
    const i = sampleInvoice();
    i.customer.reference = '04011000-12345-34';
    i.discount = { type: 'amount', value: '20' };
    return [s, i];
  })(),
  // ohne Leistungszeitraum (Lieferdatum = Rechnungsdatum), sofort fällig, ohne Skonto
  sofort: (() => {
    const s = sampleSettings();
    const i = sampleInvoice();
    Object.assign(i, { serviceFrom: '', serviceTo: '', paymentDays: 0, skonto: { enabled: false } });
    i.items = [i.items[0]];
    return [s, i];
  })(),
};

for (const [name, [settings, invoice]] of Object.entries(variants)) {
  writeFileSync(join(out, `${name}.xml`), toXRechnung(invoice, settings));
  console.log(`✓ ${name}.xml`);
}
