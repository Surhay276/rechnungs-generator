/**
 * Rechenlogik des Rechnungsgenerators – ohne DOM, vollständig testbar.
 *
 * Geldbeträge werden intern in **Cent als Ganzzahl** geführt, damit keine
 * Gleitkomma-Rundungsfehler entstehen (0.1 + 0.2 !== 0.3).
 */

export const TAX_RATES = Object.freeze([19, 7, 0]);
export const KLEINUNTERNEHMER_HINWEIS = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

/** Wandelt eine Eingabe wie "1.234,56", "12,5" oder 12.5 in Cent um. */
export function toCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Ungültiger Betrag');
    return Math.round(value * 100);
  }
  const s = String(value ?? '').trim().replace(/\s|€/g, '');
  if (s === '') return 0;
  // deutsches Format: Punkt = Tausendertrennzeichen, Komma = Dezimaltrennzeichen
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new Error(`Ungültiger Betrag: ${value}`);
  return Math.round(Number(normalized) * 100);
}

/** Parst eine Menge (darf Nachkommastellen haben, z. B. 1,5 Stunden). */
export function toQuantity(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültige Menge: ${value}`);
  return n;
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const formatEUR = (cents) => eur.format(cents / 100);

/** Nettobetrag einer Position in Cent (kaufmännisch gerundet). */
export function lineNet({ quantity, unitPrice }) {
  return Math.round(toQuantity(quantity) * toCents(unitPrice));
}

/**
 * Berechnet Netto, Umsatzsteuer je Steuersatz und Brutto.
 * @param {Array<{description:string, quantity:number|string, unitPrice:number|string, taxRate:number}>} items
 * @param {{kleinunternehmer?: boolean}} options
 */
export function calculateTotals(items, { kleinunternehmer = false } = {}) {
  const netByRate = new Map();
  let net = 0;

  for (const item of items) {
    const rate = kleinunternehmer ? 0 : Number(item.taxRate);
    if (!TAX_RATES.includes(rate)) throw new Error(`Ungültiger Steuersatz: ${item.taxRate}`);
    const amount = lineNet(item);
    net += amount;
    netByRate.set(rate, (netByRate.get(rate) ?? 0) + amount);
  }

  // Steuer je Satz auf die Summe berechnen (nicht je Zeile) → vermeidet Rundungsdifferenzen
  const taxes = [...netByRate.entries()]
    .filter(([rate]) => rate > 0)
    .sort(([a], [b]) => b - a)
    .map(([rate, base]) => ({ rate, base, amount: Math.round((base * rate) / 100) }));

  const tax = taxes.reduce((sum, t) => sum + t.amount, 0);
  return { net, taxes, tax, gross: net + tax };
}

/** Nächste Rechnungsnummer im Format RE-JJJJ-0001; Zähler beginnt jedes Jahr neu. */
export function nextInvoiceNumber(lastNumber, year = new Date().getFullYear()) {
  const match = /^RE-(\d{4})-(\d+)$/.exec(lastNumber ?? '');
  const counter = match && Number(match[1]) === year ? Number(match[2]) + 1 : 1;
  return `RE-${year}-${String(counter).padStart(4, '0')}`;
}

/** Addiert Tage zu einem ISO-Datum (JJJJ-MM-TT), zeitzonensicher in UTC. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** Prüft eine IBAN per ISO-13616-Prüfsumme (Modulo 97). */
export function isValidIBAN(input) {
  const iban = String(input ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export const formatIBAN = (iban) => String(iban ?? '').replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

/** Prüft eine Rechnung auf Pflichtangaben (vereinfacht nach § 14 Abs. 4 UStG). Liefert Fehlerliste. */
export function validateInvoice(inv) {
  const errors = [];
  if (!inv.sender?.name?.trim()) errors.push('Name des Rechnungsstellers fehlt.');
  if (!inv.sender?.address?.trim()) errors.push('Anschrift des Rechnungsstellers fehlt.');
  if (!inv.sender?.taxId?.trim()) errors.push('Steuernummer oder USt-IdNr. fehlt.');
  if (!inv.recipient?.name?.trim()) errors.push('Name des Empfängers fehlt.');
  if (!inv.recipient?.address?.trim()) errors.push('Anschrift des Empfängers fehlt.');
  if (!inv.number?.trim()) errors.push('Rechnungsnummer fehlt.');
  if (!inv.date) errors.push('Rechnungsdatum fehlt.');
  if (!inv.items?.length) errors.push('Mindestens eine Position ist erforderlich.');
  inv.items?.forEach((item, i) => {
    if (!item.description?.trim()) errors.push(`Position ${i + 1}: Beschreibung fehlt.`);
    try {
      if (toQuantity(item.quantity) === 0) errors.push(`Position ${i + 1}: Menge muss größer 0 sein.`);
      toCents(item.unitPrice);
    } catch (e) {
      errors.push(`Position ${i + 1}: ${e.message}`);
    }
  });
  if (inv.sender?.iban && !isValidIBAN(inv.sender.iban)) errors.push('Die IBAN ist ungültig (Prüfsumme).');
  return errors;
}
