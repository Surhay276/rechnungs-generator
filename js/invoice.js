/**
 * Fachlogik des Rechnungsgenerators – ohne DOM, vollständig testbar.
 * Diese Datei bündelt die Module, damit Oberfläche, Skripte und Tests eine Stelle zum Importieren haben.
 *
 *   money.js      Zahlen einlesen, centgenau runden, formatieren
 *   tax.js        Steuerarten, Länder, Währungen, Dokumentarten, Rechtsformen
 *   calc.js       Positionen, Rabatte, Steuer-Aufstellung, Summen, Skonto
 *   dates.js      Datumsrechnung, Fälligkeit, Leistungsdatum
 *   numbering.js  Rechnungsnummern (Format, Fortzählung, Eindeutigkeit)
 *   checks.js     Einzelprüfungen (Namen, Adressen, IBAN, USt-IdNr., Leitweg-ID …)
 *   validate.js   Pflichtangaben einer Rechnung (Fehler und Warnungen)
 *   einvoice.js   E-Rechnung (XRechnung / ZUGFeRD, Syntax CII)
 *   girocode.js   GiroCode (EPC-QR)
 *   lock.js       Festschreibung, Kopie, Stornorechnung
 */
import { countryName } from './tax.js?v=25';

export * from './money.js?v=25';
export * from './tax.js?v=25';
export * from './calc.js?v=25';
export * from './dates.js?v=25';
export * from './numbering.js?v=25';
export * from './checks.js?v=25';
export * from './validate.js?v=25';
export * from './einvoice.js?v=25';
export * from './girocode.js?v=25';
export * from './lock.js?v=25';

/** Einheiten mit UN/ECE-Codes (Rec. 20) – nötig für die E-Rechnung. */
export const UNITS = Object.freeze([
  { code: 'H87', label: 'Stk.' },
  { code: 'HUR', label: 'Std.' },
  { code: 'DAY', label: 'Tag' },
  { code: 'MON', label: 'Monat' },
  { code: 'LS', label: 'Pausch.' },
  { code: 'KMT', label: 'km' },
  { code: 'KGM', label: 'kg' },
  { code: 'LTR', label: 'Liter' },
  { code: 'MTR', label: 'm' },
  { code: 'MTK', label: 'm²' },
  { code: 'C62', label: 'Einheit' },
]);
export const unitLabel = (code) => UNITS.find((u) => u.code === code)?.label ?? '';

/** Adresse als Textblock; das Land erscheint nur bei ausländischen Anschriften (in Großbuchstaben, DIN 5008). */
export const formatAddress = (a = {}) => {
  const country = String(a.country || 'DE').toUpperCase();
  return [a.street, [a.zip, a.city].filter(Boolean).join(' '), country !== 'DE' ? countryName(country).toUpperCase() : '']
    .filter((x) => String(x ?? '').trim()).join('\n');
};
