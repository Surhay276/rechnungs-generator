import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toQuantity, lineNet, calculateTotals, nextInvoiceNumber,
  addDays, isValidIBAN, formatIBAN, formatEUR, validateInvoice, validateInvoiceFields,
} from '../js/invoice.js';

test('toCents versteht deutsches und englisches Zahlenformat', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('12,5'), 1250);
  assert.equal(toCents('99.90'), 9990);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('49 €'), 4900);
  assert.equal(toCents(''), 0);
  assert.throws(() => toCents('abc'), /Ungültiger Betrag/);
});

test('toQuantity akzeptiert Kommazahlen und lehnt negative Werte ab', () => {
  assert.equal(toQuantity('1,5'), 1.5);
  assert.throws(() => toQuantity('-1'));
});

test('lineNet rundet kaufmännisch', () => {
  assert.equal(lineNet({ quantity: 3, unitPrice: '0,333' }), 99);
  assert.equal(lineNet({ quantity: '1,5', unitPrice: '65,00' }), 9750);
});

test('calculateTotals mit gemischten Steuersätzen', () => {
  const totals = calculateTotals([
    { quantity: 1, unitPrice: '1000', taxRate: 19 },
    { quantity: 2, unitPrice: '50', taxRate: 7 },
    { quantity: 1, unitPrice: '20', taxRate: 0 },
  ]);
  assert.equal(totals.net, 112000);
  assert.deepEqual(totals.taxes, [
    { rate: 19, base: 100000, amount: 19000 },
    { rate: 7, base: 10000, amount: 700 },
  ]);
  assert.equal(totals.tax, 19700);
  assert.equal(totals.gross, 131700);
});

test('Steuer wird auf die Summe je Satz berechnet, nicht je Zeile', () => {
  // 3 × 0,02 € à 19 %: je Zeile gerundet 3 × 0 Cent = 0 Cent – korrekt sind 6 Cent × 19 % = 1,14 → 1 Cent
  const items = Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: '0,02', taxRate: 19 }));
  assert.equal(calculateTotals(items).tax, 1);
});

test('Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer', () => {
  const totals = calculateTotals([{ quantity: 2, unitPrice: '100', taxRate: 19 }], { kleinunternehmer: true });
  assert.deepEqual(totals, { net: 20000, taxes: [], tax: 0, gross: 20000 });
});

test('calculateTotals lehnt unbekannte Steuersätze ab', () => {
  assert.throws(() => calculateTotals([{ quantity: 1, unitPrice: 1, taxRate: 16 }]), /Steuersatz/);
});

test('nextInvoiceNumber zählt hoch und beginnt jedes Jahr neu', () => {
  assert.equal(nextInvoiceNumber(null, 2026), 'RE-2026-0001');
  assert.equal(nextInvoiceNumber('RE-2026-0041', 2026), 'RE-2026-0042');
  assert.equal(nextInvoiceNumber('RE-2025-0099', 2026), 'RE-2026-0001');
});

test('addDays über Monats- und Jahresgrenzen', () => {
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-20', 10), '2028-03-01');
  assert.throws(() => addDays('kein-datum', 1));
});

test('IBAN-Prüfung per Modulo 97', () => {
  // Offizielle Muster-IBANs aus der ISO-13616-/Bankendokumentation – keine echten Konten
  assert.equal(isValidIBAN('DE89 3704 0044 0532 0130 00'), true); // pragma: allowlist secret
  assert.equal(isValidIBAN('DE89370400440532013001'), false); // pragma: allowlist secret
  assert.equal(isValidIBAN('DE8937040044053201300'), false); // pragma: allowlist secret
  assert.equal(isValidIBAN('GB82 WEST 1234 5698 7654 32'), true); // pragma: allowlist secret
  assert.equal(formatIBAN('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
});

test('formatEUR nutzt deutsches Format', () => {
  assert.equal(formatEUR(123456).replace(/\s/g, ' '), '1.234,56 €');
});

test('validateInvoice meldet fehlende Pflichtangaben', () => {
  const errors = validateInvoice({ sender: { iban: 'DE00 1234' }, recipient: {}, items: [{ description: '', quantity: 0, unitPrice: 'x' }] });
  assert.ok(errors.some((e) => e.includes('Steuernummer')));
  assert.ok(errors.some((e) => e.includes('Position 1: Beschreibung')));
  assert.ok(errors.some((e) => e.includes('IBAN')));
  const ok = validateInvoice({
    sender: { name: 'A', address: 'B', taxId: '12/345/67890', iban: 'DE89370400440532013000' },
    recipient: { name: 'C', address: 'D' },
    number: 'RE-2026-0001',
    date: '2026-11-26',
    items: [{ description: 'Webdesign', quantity: 1, unitPrice: '100' }],
  });
  assert.deepEqual(ok, []);
});

test('validateInvoiceFields nennt das betroffene Feld, damit die UI es markieren kann', () => {
  const fields = validateInvoiceFields({
    sender: { name: 'A', address: 'B', taxId: '1' },
    recipient: { name: '', address: 'D' },
    number: 'RE-1', date: '2026-11-26',
    items: [{ description: 'X', quantity: '1', unitPrice: '' }],
  }).map((e) => e.field);
  assert.deepEqual(fields, ['recipient.name', 'items.0.unitPrice']);
});
