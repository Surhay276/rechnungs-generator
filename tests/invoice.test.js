import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toQuantity, lineBase, lineNet, discountCents, allocate, calculateTotals, skontoInfo,
  nextInvoiceNumber, addDays, dueDate, isValidIBAN, formatIBAN, formatEUR, epcPayload,
  grossFromNet, netFromGross, validateInvoiceFields, validateXRechnungFields, toXRechnung,
} from '../js/invoice.js';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs';

test('toCents versteht deutsches und englisches Zahlenformat', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('12,5'), 1250);
  assert.equal(toCents('99.90'), 9990);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents('49 €'), 4900);
  assert.equal(toCents(''), 0);
  assert.throws(() => toCents('abc'), /Ungültiger Betrag/);
});

test('Mengen und Positionsbeträge', () => {
  assert.equal(toQuantity('1,5'), 1.5);
  assert.throws(() => toQuantity('-1'));
  assert.equal(lineBase({ quantity: 3, unitPrice: '0,333' }), 99);
  assert.equal(lineBase({ quantity: '1,5', unitPrice: '65,00' }), 9750);
});

test('Rabatte: Prozent, fester Betrag, nie mehr als die Basis', () => {
  assert.equal(discountCents(10000, { type: 'percent', value: '10' }), 1000);
  assert.equal(discountCents(10000, { type: 'amount', value: '25,50' }), 2550);
  assert.equal(discountCents(10000, { type: 'amount', value: '500' }), 10000);
  assert.equal(discountCents(10000, { type: 'percent', value: '' }), 0);
  assert.throws(() => discountCents(10000, { type: 'percent', value: '120' }));
  assert.equal(lineNet({ quantity: 2, unitPrice: '50', discount: { type: 'percent', value: '10' } }), 9000);
});

test('allocate verteilt centgenau nach größten Resten', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.equal(allocate(999, [700, 299]).reduce((a, b) => a + b), 999);
});

test('calculateTotals mit gemischten Steuersätzen', () => {
  const t = calculateTotals([
    { quantity: 1, unitPrice: '1000', taxRate: 19 },
    { quantity: 2, unitPrice: '50', taxRate: 7 },
    { quantity: 1, unitPrice: '20', taxRate: 0 },
  ]);
  assert.equal(t.net, 112000);
  assert.deepEqual(t.taxes, [{ rate: 19, base: 100000, amount: 19000 }, { rate: 7, base: 10000, amount: 700 }]);
  assert.equal(t.gross, 131700);
  assert.deepEqual(t.breakdown.map((b) => b.rate), [19, 7, 0]);
});

test('Gesamtrabatt mindert die Steuerbasis anteilig je Steuersatz', () => {
  const t = calculateTotals([
    { quantity: 1, unitPrice: '300', taxRate: 19 },
    { quantity: 1, unitPrice: '100', taxRate: 7 },
  ], { discount: { type: 'percent', value: '10' } });
  assert.equal(t.subtotal, 40000);
  assert.equal(t.discount, 4000);
  assert.deepEqual(t.breakdown.map((b) => [b.rate, b.base, b.discount, b.amount]), [[19, 27000, 3000, 5130], [7, 9000, 1000, 630]]);
  assert.equal(t.gross, 36000 + 5760);
});

test('Steuer wird auf die Summe je Satz berechnet, nicht je Zeile', () => {
  const items = Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: '0,02', taxRate: 19 }));
  assert.equal(calculateTotals(items).tax, 1); // 6 Cent × 19 % = 1,14 → 1 (je Zeile wären es 0)
});

test('Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer', () => {
  const t = calculateTotals([{ quantity: 2, unitPrice: '100', taxRate: 19 }], { kleinunternehmer: true });
  assert.deepEqual([t.net, t.tax, t.gross, t.taxes.length], [20000, 0, 20000, 0]);
  assert.throws(() => calculateTotals([{ quantity: 1, unitPrice: 1, taxRate: 16 }]), /Steuersatz/);
});

test('Brutto/Netto-Umrechnung für das Preisfeld inkl. USt', () => {
  assert.equal(grossFromNet(10000, 19), 11900);
  assert.equal(netFromGross(11900, 19), 10000);
  assert.equal(netFromGross(1000, 7), 935);
});

test('Skonto und Fälligkeit', () => {
  assert.deepEqual(skontoInfo(11900, '2026-11-27', { enabled: true, percent: '2', days: 10 }),
    { percent: 2, days: 10, amount: 238, payable: 11662, until: '2026-12-07' });
  assert.equal(skontoInfo(11900, '2026-11-27', { enabled: false, percent: '2', days: 10 }), null);
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 7 }), '2026-12-04');
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 14 }), '2026-12-11');
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 0 }), '2026-11-27');
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 'custom', dueDate: '2027-01-15' }), '2027-01-15');
});

test('Rechnungsnummern und Datumsgrenzen', () => {
  assert.equal(nextInvoiceNumber(null, 2026), 'RE-2026-0001');
  assert.equal(nextInvoiceNumber('RE-2026-0041', 2026), 'RE-2026-0042');
  assert.equal(nextInvoiceNumber('RE-2025-0099', 2026), 'RE-2026-0001');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-20', 10), '2028-03-01');
});

test('IBAN-Prüfung per Modulo 97', () => {
  // Offizielle Muster-IBANs aus der ISO-13616-/Bankendokumentation – keine echten Konten
  assert.equal(isValidIBAN('DE89 3704 0044 0532 0130 00'), true); // pragma: allowlist secret
  assert.equal(isValidIBAN('DE89370400440532013001'), false); // pragma: allowlist secret
  assert.equal(isValidIBAN('GB82 WEST 1234 5698 7654 32'), true); // pragma: allowlist secret
  assert.equal(formatIBAN('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00'); // pragma: allowlist secret
  assert.equal(formatEUR(123456).replace(/\s/g, ' '), '1.234,56 €');
});

test('GiroCode (EPC-QR): Aufbau nach EPC069-12', () => {
  const payload = epcPayload({ name: 'Max Mustermann', iban: 'DE89 3704 0044 0532 0130 00', amountCents: 154627, reference: 'RE-2026-0001' }); // pragma: allowlist secret
  assert.deepEqual(payload.split('\n'), ['BCD', '002', '1', 'SCT', '', 'Max Mustermann', 'DE89370400440532013000', 'EUR1546.27', '', '', 'RE-2026-0001']); // pragma: allowlist secret
  assert.throws(() => epcPayload({ name: 'X', iban: 'DE00', amountCents: 100 }), /IBAN/);
  assert.throws(() => epcPayload({ name: 'X', iban: 'DE89370400440532013000', amountCents: 0 }), /Betrag/); // pragma: allowlist secret
});

test('Pflichtangaben: Fehler nennen das betroffene Feld', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  assert.deepEqual(validateInvoiceFields(inv, settings), []);
  inv.customer.name = '';
  inv.items[1].unitPrice = '';
  settings.company.taxId = '';
  assert.deepEqual(validateInvoiceFields(inv, settings).map((e) => e.field), ['company.taxId', 'customer.name', 'items.1.unitPrice']);
});

test('E-Rechnung verlangt zusätzlich E-Mail, Telefon und IBAN', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  inv.customer.email = '';
  settings.company.phone = '';
  assert.deepEqual(validateXRechnungFields(inv, settings).map((e) => e.field).sort(), ['company.phone', 'customer.email']);
  assert.throws(() => toXRechnung(inv, settings), /E-Mail-Adresse des Kunden/);
});

test('XRechnung: Summen im XML passen zur Berechnung', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  inv.discount = { type: 'percent', value: '5' };
  const xml = toXRechnung(inv, settings);
  const t = calculateTotals(inv.items, { discount: inv.discount });
  assert.match(xml, /xrechnung_3\.0/);
  assert.match(xml, new RegExp(`<cbc:PayableAmount currencyID="EUR">${(t.gross / 100).toFixed(2)}</cbc:PayableAmount>`));
  assert.match(xml, /<cbc:AllowanceTotalAmount currencyID="EUR">/);
  assert.ok(!xml.includes('<script'), 'Eingaben werden escaped');
});

test('Festschreibung: abgeschlossene Rechnung friert Einstellungen ein', async () => {
  const { finalizeInvoice, isLocked, settingsFor, copyAsDraft } = await import('../js/invoice.js');
  const settings = { company: { name: 'Alt GmbH', iban: 'DE89370400440532013000' }, kleinunternehmer: false };
  const inv = { id: 'a', number: 'RE-2026-0001', status: 'entwurf', items: [{ description: 'x', quantity: '1', unitPrice: '10', taxRate: 19 }] };
  const done = finalizeInvoice(inv, settings, { design: { color: '#1849A9', head: 'filled' }, now: 1 });
  assert.ok(isLocked(done));
  assert.ok(!isLocked(inv), 'Original-Objekt bleibt unberührt');
  // spätere Änderungen in den Einstellungen wirken nicht auf die abgeschlossene Rechnung
  settings.company.name = 'Neu GmbH';
  settings.kleinunternehmer = true;
  assert.equal(settingsFor(done, settings).company.name, 'Alt GmbH');
  assert.equal(settingsFor(done, settings).kleinunternehmer, false);
  assert.equal(settingsFor(inv, settings).company.name, 'Neu GmbH');
  // erneutes Abschließen ändert nichts
  assert.equal(finalizeInvoice(done, settings), done);
  // Korrektur = Kopie mit neuer Nummer als Entwurf, ohne eingefrorene Daten
  const copy = copyAsDraft(done, { id: 'b', number: 'RE-2026-0002', date: '2026-11-27' });
  assert.equal(copy.status, 'entwurf');
  assert.equal(copy.number, 'RE-2026-0002');
  assert.equal(copy.snapshot, undefined);
  assert.ok(isLocked(done));
});
