import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toPriceUnits, toQuantity, toQuantityUnits, toPercent, roundDiv, formatEUR, formatMoney, formatPrice,
  centsToDecimal, centsToInput, formatQuantity, priceToInput, scaledToString,
} from '../js/money.js';

test('toCents: deutsches Format zuerst: Tausenderpunkt wird nicht zum Dezimalpunkt', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('1.500'), 150000); // nicht 1,50 €
  assert.equal(toCents('12.345.678'), 1234567800);
  assert.equal(toCents('12,5'), 1250);
  assert.equal(toCents('12.5'), 1250); // Punkt ohne Tausendergruppe = Dezimalpunkt
  assert.equal(toCents('99.90'), 9990);
  assert.equal(toCents(',5'), 50);
  assert.equal(toCents('49 €'), 4900);
  assert.equal(toCents('−5,00'), -500);
  assert.equal(toCents(''), 0);
  for (const bad of ['abc', '1,2,3', '12.34.5', '1.23,4', '-', '.', '1e5']) assert.throws(() => toCents(bad), /Ungültiger Betrag/, bad);
});

test('toCents: kaufmännisch gerundet ohne Gleitkommafehler', () => {
  assert.equal(toCents('1,005'), 101); // Number('1.005') * 100 wäre 100.49999…
  assert.equal(toCents('0,285'), 29);
  assert.equal(toCents('2,675'), 268);
  assert.equal(toCents('-1,005'), -101); // halbe Werte vom Nullpunkt weg
  assert.equal(toCents('0,004'), 0);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1.005), 101);
});

test('Einzelpreise mit bis zu vier Nachkommastellen (EN 16931)', () => {
  assert.equal(toPriceUnits('0,015'), 150);
  assert.equal(toPriceUnits('12,5'), 125000);
  assert.equal(toPriceUnits('0,00005'), 1); // fünfte Stelle wird gerundet
  assert.throws(() => toPriceUnits('100.000.000'), /zu hoch/);
  assert.equal(priceToInput(150), '0,015');
  assert.equal(priceToInput(125000), '12,50');
  assert.equal(formatPrice(150).replace(/\s/g, ' '), '0,015 €');
  assert.equal(formatPrice(125000).replace(/\s/g, ' '), '12,50 €');
});

test('Mengen: Nachkommastellen, nie negativ, mit Obergrenze', () => {
  assert.equal(toQuantity('1,5'), 1.5);
  assert.equal(toQuantityUnits('0,0001'), 1);
  assert.throws(() => toQuantity('-1'));
  assert.throws(() => toQuantity('1e21'));
  assert.throws(() => toQuantity('Infinity'));
  assert.throws(() => toQuantity('10.000.000'), /höchstens/);
  assert.equal(formatQuantity(15_000), '1,5');
  assert.equal(formatQuantity(15_000, { comma: false }), '1.5');
  assert.equal(formatQuantity(99_999_990_000, { comma: false }), '9999999'); // nie Exponentialschreibweise
});

test('Prozentwerte', () => {
  assert.equal(toPercent('2,5'), 2.5);
  assert.equal(toPercent(''), 0);
  for (const bad of ['abc', '-5', '150']) assert.throws(() => toPercent(bad), /Prozentwert/);
});

test('Ganzzahlige Rundung und Ausgabe', () => {
  assert.equal(roundDiv(5n, 2n), 3n);
  assert.equal(roundDiv(-5n, 2n), -3n);
  assert.equal(roundDiv(4n, 3n), 1n);
  assert.equal(centsToDecimal(123456), '1234.56');
  assert.equal(centsToDecimal(-5), '-0.05');
  assert.equal(centsToInput(1250), '12,50');
  assert.equal(scaledToString(-150, 4), '-0.0150');
  assert.equal(formatEUR(123456).replace(/\s/g, ' '), '1.234,56 €');
  assert.equal(formatMoney(-100, 'USD').replace(/\s/g, ' '), '-1,00 $');
  assert.equal(formatEUR(0), formatEUR(-0)); // kein „-0,00 €“
});
