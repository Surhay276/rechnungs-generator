/**
 * Inhalt eines GiroCodes (EPC-QR, EPC069-12, Version 002) – die Banking-App liest Empfänger, IBAN,
 * Betrag und Verwendungszweck direkt ein. Nur für Euro-Beträge.
 */
import { centsToDecimal } from './money.js?v=25';
import { isValidIBAN, cleanIBAN } from './checks.js?v=25';

export function epcPayload({ name, iban, bic = '', amountCents, reference = '' }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Empfängername fehlt.');
  if (!isValidIBAN(iban)) throw new Error('Ungültige IBAN.');
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 99_999_999_999) throw new Error('Ungültiger Betrag.');
  return [
    'BCD', '002', '1', 'SCT',
    String(bic ?? '').replace(/\s/g, '').toUpperCase(),
    cleanName.slice(0, 70),
    cleanIBAN(iban),
    `EUR${centsToDecimal(amountCents)}`,
    '', // Zweck-Code
    '', // strukturierte Referenz
    String(reference ?? '').slice(0, 140),
  ].join('\n');
}
