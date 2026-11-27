import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, contrast, mix, invoiceTheme, readableOnWhite, PRESET_COLORS, DEFAULT_COLOR } from '../js/color.js';

test('Hex-Werte werden vereinheitlicht', () => {
  assert.equal(normalizeHex('0e9384'), '#0E9384');
  assert.equal(normalizeHex('#0e9'), '#00EE99');
  assert.equal(normalizeHex(' #1d2939 '), '#1D2939');
  assert.equal(normalizeHex('blau'), null);
  assert.equal(normalizeHex(''), null);
});

test('Kontrast nach WCAG', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(0), '21');
  assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
});

test('Mischen', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mix('#1D2939', '#FFFFFF', 0), '#1D2939');
});

test('Alle Vorgaben sind auf Weiß gut lesbar', () => {
  for (const { hex } of PRESET_COLORS) assert.ok(contrast(hex, '#FFFFFF') >= 4.5, hex);
});

test('Helle Farben: dunkle Schrift auf der Fläche, abgedunkelter Titel', () => {
  const t = invoiceTheme('#FDE047'); // Gelb
  assert.equal(t.onAccent, '#101828');
  assert.ok(contrast(t.text, '#FFFFFF') >= 4.5);
  assert.notEqual(t.text, '#FDE047');
});

test('Dunkle Farben: weiße Schrift, Farbe bleibt unverändert', () => {
  const t = invoiceTheme('#1849A9');
  assert.equal(t.onAccent, '#FFFFFF');
  assert.equal(t.text, '#1849A9');
});

test('Ungültige Farbe fällt auf den Standard zurück', () => {
  assert.equal(invoiceTheme('xyz').accent, DEFAULT_COLOR);
  assert.equal(invoiceTheme(undefined).accent, DEFAULT_COLOR);
});

test('readableOnWhite endet immer lesbar', () => {
  for (const hex of ['#FFFFFF', '#FFFF00', '#00FFFF', '#F0F0F0']) assert.ok(contrast(readableOnWhite(hex), '#FFFFFF') >= 4.5, hex);
});
