import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineBase, lineNet, discountCents, allocate, calculateTotals, invoiceTotals, splitGross, convertPrice, skontoInfo, taxTypeOf, TAX_TYPES,
} from '../js/invoice.js';
import { sampleInvoice, sampleSettings } from '../scripts/samples.mjs';

test('Positionsbeträge: Menge × Einzelpreis, centgenau', () => {
  assert.equal(lineBase({ quantity: 3, unitPrice: '0,333' }), 100); // 0,999 → 1,00
  assert.equal(lineBase({ quantity: '3', unitPrice: '0,335' }), 101); // 1,005 → 1,01 (nicht 1,00)
  assert.equal(lineBase({ quantity: '1,5', unitPrice: '65,00' }), 9750);
  assert.equal(lineBase({ quantity: '1000', unitPrice: '0,015' }), 1500);
  assert.equal(lineBase({ quantity: '1', unitPrice: '-30,01' }), -3001);
});

test('Rabatte: Prozent, fester Betrag, nie mehr als die Basis: Vorzeichen folgt der Basis', () => {
  assert.equal(discountCents(10000, { type: 'percent', value: '10' }), 1000);
  assert.equal(discountCents(10000, { type: 'amount', value: '25,50' }), 2550);
  assert.equal(discountCents(10000, { type: 'amount', value: '500' }), 10000);
  assert.equal(discountCents(10000, { type: 'percent', value: '' }), 0);
  assert.equal(discountCents(-10000, { type: 'percent', value: '10' }), -1000);
  assert.throws(() => discountCents(10000, { type: 'percent', value: '120' }));
  assert.throws(() => discountCents(10000, { type: 'amount', value: '-5' }), /negativ/);
  assert.equal(lineNet({ quantity: 2, unitPrice: '50', discount: { type: 'percent', value: '10' } }), 9000);
});

test('allocate verteilt centgenau nach größten Resten: auch mit negativen Anteilen', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.equal(allocate(999, [700, 299]).reduce((a, b) => a + b), 999);
  assert.equal(allocate(1000, [1500, -300]).reduce((a, b) => a + b), 1000);
});

test('Steuerarten: alte Speicherstände (taxRate) bleiben gültig', () => {
  assert.equal(taxTypeOf({ taxRate: 19 }).key, 'S19');
  assert.equal(taxTypeOf({ taxRate: 7 }).key, 'S7');
  assert.equal(taxTypeOf({ taxRate: 0 }).key, 'Z');
  assert.equal(taxTypeOf({ taxType: 'AE' }).category, 'AE');
  assert.equal(taxTypeOf({ taxType: 'S19' }, true).key, 'KU');
  assert.throws(() => taxTypeOf({ taxRate: 16 }), /Steuersatz/);
  assert.equal(TAX_TYPES.M.code, 'VATEX-EU-F');
});

test('calculateTotals: gemischte Steuerarten, je Kategorie eine Aufstellung', () => {
  const t = calculateTotals([
    { quantity: 1, unitPrice: '1000', taxType: 'S19' },
    { quantity: 2, unitPrice: '50', taxType: 'S7' },
    { quantity: 1, unitPrice: '20', taxType: 'Z' },
    { quantity: 1, unitPrice: '30', taxType: 'E' },
  ]);
  assert.equal(t.net, 115000);
  assert.deepEqual(t.taxes, [{ rate: 19, base: 100000, amount: 19000 }, { rate: 7, base: 10000, amount: 700 }]);
  assert.equal(t.gross, 134700);
  assert.deepEqual(t.breakdown.map((b) => b.key), ['S:19', 'S:7', 'Z:0', 'E:0']);
  assert.equal(t.payable, t.gross);
});

test('Gesamtrabatt mindert die Steuerbasis anteilig je Steuersatz', () => {
  const t = calculateTotals([
    { quantity: 1, unitPrice: '300', taxType: 'S19' },
    { quantity: 1, unitPrice: '100', taxType: 'S7' },
  ], { discount: { type: 'percent', value: '10' } });
  assert.equal(t.subtotal, 40000);
  assert.equal(t.discount, 4000);
  assert.deepEqual(t.breakdown.map((b) => [b.rate, b.base, b.discount, b.amount]), [[19, 27000, 3000, 5130], [7, 9000, 1000, 630]]);
  assert.equal(t.gross, 36000 + 5760);
});

test('Steuer wird auf die Summe je Satz berechnet, nicht je Zeile', () => {
  const items = Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: '0,02', taxType: 'S19' }));
  assert.equal(calculateTotals(items).tax, 1); // 6 Cent × 19 % = 1,14 → 1 (je Zeile wären es 0)
});

test('Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer, eine Aufstellung „E“', () => {
  const t = calculateTotals([{ quantity: 2, unitPrice: '100', taxType: 'S19' }], { kleinunternehmer: true });
  assert.deepEqual([t.net, t.tax, t.gross, t.taxes.length], [20000, 0, 20000, 0]);
  assert.equal(t.breakdown[0].category, 'E');
});

test('Bruttopreise: der eingegebene Betrag bleibt der Rechnungsbetrag', () => {
  for (const price of ['99,99', '119,00', '0,03', '1.234,56', '9,99']) {
    const t = calculateTotals([{ quantity: 1, unitPrice: price, taxType: 'S19' }], { pricesGross: true });
    const entered = Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100);
    assert.equal(t.total, entered, price);
    assert.equal(t.payable, entered, price);
    // EN 16931 (BR-CO-17): Steuer = Bemessungsgrundlage × Satz, gerundet
    assert.equal(t.tax, Math.round(t.net * 0.19), price);
    assert.ok(Math.abs(t.rounding) <= 1);
  }
  const t = calculateTotals([{ quantity: 1, unitPrice: '119', taxType: 'S19' }], { pricesGross: true });
  assert.deepEqual([t.net, t.tax, t.rounding], [10000, 1900, 0]);
});

test('Bruttopreise: Rabatte und mehrere Steuersätze stimmen auf den Cent', () => {
  const t = calculateTotals([
    { quantity: 3, unitPrice: '11,90', taxType: 'S19' },
    { quantity: 2, unitPrice: '10,70', taxType: 'S7', discount: { type: 'percent', value: '10' } },
  ], { pricesGross: true, discount: { type: 'amount', value: '5' } });
  assert.equal(t.total, 3570 + 1926 - 500);
  assert.equal(t.lines.reduce((s, l) => s + l.net, 0), t.subtotal); // BR-CO-10
  assert.equal(t.subtotal - t.discount, t.net); // BR-CO-13
  for (const b of t.breakdown) assert.equal(b.amount, Math.round((b.base * b.rate) / 100));
  assert.deepEqual(t.lines.map((l) => l.base - l.discount - l.net), [0, 0]);
});

test('splitGross findet für jeden Bruttobetrag eine passende Zerlegung', () => {
  for (const rate of [19, 7]) {
    for (let g = 1; g < 5000; g++) {
      const { net, tax, rounding } = splitGross(g, rate);
      assert.equal(net + tax + rounding, g);
      assert.equal(tax, Math.round((net * rate) / 100));
      assert.ok(Math.abs(rounding) <= 1);
    }
  }
});

test('Netto/Brutto-Umrechnung beim Umschalten der Eingabeart', () => {
  assert.equal(convertPrice(1_000_000, 19, true), 1_190_000);
  assert.equal(convertPrice(1_190_000, 19, false), 1_000_000);
  assert.equal(convertPrice(500, 0, true), 500);
});

test('Obergrenze des Rechnungsbetrags', () => {
  assert.throws(() => calculateTotals([{ quantity: '9.999.999', unitPrice: '99.999.999', taxType: 'S19' }]), /zu hoch/);
});

test('Skonto: auf den Zahlbetrag, ungültige Eingaben brechen nichts ab', () => {
  assert.deepEqual(skontoInfo(11900, '2026-11-27', { enabled: true, percent: '2', days: 10 }),
    { percent: 2, days: 10, amount: 238, payable: 11662, until: '2026-12-07' });
  assert.equal(skontoInfo(11900, '2026-11-27', { enabled: false, percent: '2', days: 10 }), null);
  for (const skonto of [{ percent: 'abc', days: 7 }, { percent: '-5', days: 7 }, { percent: '150', days: 7 }, { percent: '2', days: 99_999_999 }, { percent: '2', days: 0 }]) {
    assert.equal(skontoInfo(11900, '2026-11-27', { enabled: true, ...skonto }), null, JSON.stringify(skonto));
  }
  assert.equal(skontoInfo(11900, '2026-02-30', { enabled: true, percent: '2', days: 7 }).until, null);
});

test('Schlussrechnung: Abschläge mindern den Zahlbetrag', () => {
  const inv = { ...sampleInvoice(), kind: 'final', prepayments: [{ number: 'RE-2026-0001', date: '2026-10-01', gross: '500,00', tax: '79,83' }] };
  const t = invoiceTotals(inv, sampleSettings());
  assert.equal(t.prepaid, 50000);
  assert.equal(t.payable, t.total - 50000);
});
