import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRate } from '../js/fx.js';
import { invoiceTotals, centsInEUR } from '../js/invoice.js';
import { buildInvoiceView } from '../js/view.js';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs';

test('Kurs: EZB-Referenzkurs zum Rechnungsdatum, Zukunft → aktueller Kurs, Ausfall wird gemeldet', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('NOK')) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ amount: 1, base: 'CHF', date: '2026-11-26', rates: { EUR: 1.0925 } }) };
  });
  assert.deepEqual(await fetchRate('CHF', '2026-11-27', { today: '2026-11-27' }), { rate: '1,0925', date: '2026-11-26', source: 'EZB' });
  await fetchRate('CHF', '2026-11-27', { today: '2026-11-27' });
  assert.equal(calls.length, 1, 'gleiche Abfrage kommt aus dem Zwischenspeicher');
  await fetchRate('CHF', '2027-03-01', { today: '2026-11-27' });
  assert.match(calls.at(-1), /\/latest\?base=CHF&symbols=EUR$/);
  await assert.rejects(fetchRate('NOK', '2026-11-27', { today: '2026-11-27' }), /nicht verfügbar/);
});

test('GiroCode bei Fremdwährung: Euro-Betrag zum Rechnungskurs', () => {
  const s = sampleSettings();
  const inv = { ...sampleInvoice(), currency: 'CHF', fxRate: '1,0925', fxDate: '2026-11-26' };
  const totals = invoiceTotals(inv, s);
  const view = buildInvoiceView(inv, s, totals, { color: '#1D2939', head: 'filled' });
  const eur = centsInEUR(totals.payable, '1,0925');
  assert.ok(view.qr, 'QR-Code wird erzeugt');
  assert.match(view.qrCaption, /€ zahlen$/);
  assert.equal(eur, Math.round(totals.payable * 1.0925));
  assert.ok(view.payTexts.some((p) => p.includes('umgerechneten Betrag')));
  assert.ok(view.meta.some(([k, v]) => k === 'Währung' && v.includes('EZB 26.11.2026')));
  const noRate = buildInvoiceView({ ...inv, fxRate: '' }, s, totals, { color: '#1D2939', head: 'filled' });
  assert.equal(noRate.qr, null, 'ohne Kurs kein QR-Code');
});
