import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toXRechnung, toCII, xmlText, invoiceTotals, finalizeInvoice, isLocked, settingsFor, copyAsDraft, createStorno, formatAddress, taxInEUR,
} from '../js/invoice.js';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs';

const ctx = { context: { today: '2026-11-27' } };
const xml = (inv = sampleInvoice(), s = sampleSettings(), profile = 'xrechnung') => toCII(inv, s, { profile, ...ctx });
const amount = (doc, tag) => new RegExp(`<ram:${tag}(?: [^>]*)?>([^<]+)</ram:${tag}>`).exec(doc)?.[1];

test('XRechnung (CII): Summen im XML passen zur Berechnung', () => {
  const s = sampleSettings();
  const inv = sampleInvoice();
  inv.discount = { type: 'percent', value: '5' };
  const doc = xml(inv, s);
  const t = invoiceTotals(inv, s);
  assert.match(doc, /xrechnung_3\.0/);
  assert.match(doc, /<rsm:CrossIndustryInvoice /);
  assert.equal(amount(doc, 'DuePayableAmount'), (t.payable / 100).toFixed(2));
  assert.equal(amount(doc, 'AllowanceTotalAmount'), (t.discount / 100).toFixed(2));
  assert.equal(amount(doc, 'TaxBasisTotalAmount'), (t.net / 100).toFixed(2));
  assert.match(doc, /<ram:TypeCode>380<\/ram:TypeCode>/);
  assert.match(doc, /#SKONTO#TAGE=7#PROZENT=2\.00#\n/);
  assert.match(doc, /<ram:BillingSpecifiedPeriod>/);
});

test('ZUGFeRD-Profil EN 16931: gleiche Daten, andere Kennung, ohne XRechnung-Zusatzpflichten', () => {
  const inv = sampleInvoice();
  inv.customer.email = ''; // für XRechnung Pflicht, für EN 16931 nicht
  const doc = xml(inv, sampleSettings(), 'en16931');
  assert.match(doc, /<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/);
  assert.doesNotMatch(doc, /xrechnung/);
  assert.throws(() => xml(inv, sampleSettings(), 'xrechnung'), /E-Mail-Adresse des Kunden/);
});

test('XML: Steuerzeichen und Sonderzeichen machen die Datei nicht ungültig', () => {
  assert.equal(xmlText('A\u0001B\u0000C & <D> "E"'), 'ABC &amp; &lt;D&gt; &quot;E&quot;');
  const inv = sampleInvoice();
  inv.items[0].description = 'Webdesign\u0001 <Startseite> & „Kontakt“';
  const doc = xml(inv);
  assert.doesNotMatch(doc, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  assert.match(doc, /Webdesign &lt;Startseite&gt; &amp; „Kontakt“/);
});

test('XML: Mengen ohne Exponent, negative Positionen über die Menge (Preis nie negativ, BR-27)', () => {
  const inv = sampleInvoice();
  inv.items.push({ description: 'Gutschrift Altgerät', quantity: '1', unit: 'H87', unitPrice: '-50', taxType: 'S19', discount: null });
  inv.items[0].quantity = '99.999';
  const doc = xml(inv);
  assert.doesNotMatch(doc, /e\+/);
  assert.match(doc, /<ram:BilledQuantity unitCode="H87">-1<\/ram:BilledQuantity>/);
  assert.doesNotMatch(doc, /<ram:ChargeAmount>-/);
});

test('XML: Steuerarten mit Befreiungsgrund und Pflichtangaben', () => {
  const s = sampleSettings();
  s.company.vatId = 'DE136695976';
  const inv = sampleInvoice();
  inv.items.forEach((i) => { i.taxType = 'K'; });
  Object.assign(inv.customer, { country: 'AT', zip: '1010', city: 'Wien', vatId: 'ATU12345678' });
  const doc = xml(inv, s);
  assert.match(doc, /<ram:CategoryCode>K<\/ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-IC<\/ram:ExemptionReasonCode>/);
  assert.match(doc, /<ram:ShipToTradeParty>.*<ram:CountryID>AT<\/ram:CountryID>/s);
  assert.match(doc, /<ram:BuyerTradeParty>.*schemeID="VA">ATU12345678</s);

  const ku = sampleSettings();
  ku.kleinunternehmer = true;
  const kuDoc = xml(sampleInvoice(), ku);
  assert.match(kuDoc, /<ram:ExemptionReason>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet\.<\/ram:ExemptionReason>/);
  assert.equal((kuDoc.match(/<ram:ApplicableTradeTax><ram:CalculatedAmount>/g) ?? []).length, 1);

  const m = sampleInvoice();
  m.items.forEach((i) => { i.taxType = 'M'; });
  assert.match(xml(m), /<ram:CategoryCode>E<\/ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-F</);
});

test('XML: Rechtsform und Register des Verkäufers (BT-30, BT-33)', () => {
  const s = sampleSettings();
  Object.assign(s.company, { name: 'Muster Web GmbH', legalForm: 'gmbh', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B', officers: 'Max Mustermann' });
  const doc = xml(sampleInvoice(), s);
  assert.match(doc, /<ram:Description>Rechtsform: GmbH, Sitz: Berlin, Registergericht: Amtsgericht Charlottenburg, Registernummer: HRB 123456 B, Geschäftsführer: Max Mustermann<\/ram:Description>/);
  assert.match(doc, /<ram:SpecifiedLegalOrganization><ram:ID>HRB 123456 B<\/ram:ID>/);
});

test('XML: Stornorechnung (381) mit Verweis, Schlussrechnung mit Abschlägen, Fremdwährung', () => {
  const storno = createStorno({ ...sampleInvoice(), status: 'erstellt' }, { id: 's', number: 'RE-2026-0002', date: '2026-11-27' });
  const sd = xml(storno);
  assert.match(sd, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.match(sd, /<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>RE-2026-0001<\/ram:IssuerAssignedID>/);
  assert.ok(Number(amount(sd, 'DuePayableAmount')) > 0, 'Gutschrift-Beträge sind in CII positiv');

  const final = { ...sampleInvoice(), kind: 'final', prepayments: [{ number: 'RE-2026-0000', date: '2026-10-01', gross: '500,00', tax: '79,83' }] };
  const fd = xml(final);
  assert.equal(amount(fd, 'TotalPrepaidAmount'), '500.00');
  assert.match(fd, /BASISBETRAG=995\.99#/);

  const usd = { ...sampleInvoice(), currency: 'USD', fxRate: '0,9' };
  const ud = xml(usd);
  assert.match(ud, /<ram:TaxCurrencyCode>EUR<\/ram:TaxCurrencyCode><ram:InvoiceCurrencyCode>USD/);
  assert.match(ud, /<ram:TaxTotalAmount currencyID="EUR">/);
  assert.equal(taxInEUR(10000, '0,9'), 9000);
});

test('XML: Bruttopreise mit Rundungsbetrag (BT-114) bleiben rechnerisch stimmig', () => {
  const inv = { ...sampleInvoice(), pricesGross: true, skonto: { enabled: false } };
  inv.items = [{ description: 'Gebrauchtes Notebook Zubehör', quantity: '1', unit: 'H87', unitPrice: '99,99', taxType: 'S19', discount: null }];
  const doc = xml(inv);
  assert.equal(amount(doc, 'RoundingAmount'), '-0.01');
  assert.equal(amount(doc, 'DuePayableAmount'), '99.99');
  assert.equal(amount(doc, 'GrandTotalAmount'), '100.00');
});

test('Festschreibung: abgeschlossene Rechnung friert Einstellungen ein', () => {
  const settings = { company: { name: 'Alt GmbH', iban: 'DE89370400440532013000' }, kleinunternehmer: false }; // pragma: allowlist secret
  const inv = { id: 'a', number: 'RE-2026-0001', status: 'entwurf', items: [{ description: 'x', quantity: '1', unitPrice: '10', taxType: 'S19' }] };
  const done = finalizeInvoice(inv, settings, { design: { color: '#1849A9', head: 'filled' }, now: 1 });
  assert.ok(isLocked(done));
  assert.ok(!isLocked(inv), 'Original-Objekt bleibt unberührt');
  settings.company.name = 'Neu GmbH';
  settings.kleinunternehmer = true;
  assert.equal(settingsFor(done, settings).company.name, 'Alt GmbH');
  assert.equal(settingsFor(done, settings).kleinunternehmer, false);
  assert.equal(settingsFor(inv, settings).company.name, 'Neu GmbH');
  assert.equal(finalizeInvoice(done, settings), done);
  const copy = copyAsDraft(done, { id: 'b', number: 'RE-2026-0002', date: '2026-11-27' });
  assert.equal(copy.status, 'entwurf');
  assert.equal(copy.snapshot, undefined);
  const storno = createStorno(done, { id: 'c', number: 'RE-2026-0003', date: '2026-11-27' });
  assert.deepEqual([storno.kind, storno.status, storno.reference.number], ['storno', 'entwurf', 'RE-2026-0001']);
  assert.ok(isLocked(done));
});

test('Auslandsanschrift mit Land in Großbuchstaben (DIN 5008)', () => {
  assert.equal(formatAddress({ street: 'Ring 1', zip: '1010', city: 'Wien', country: 'AT' }), 'Ring 1\n1010 Wien\nÖSTERREICH');
  assert.equal(formatAddress({ street: 'Hauptstraße 5', zip: '12043', city: 'Berlin', country: 'DE' }), 'Hauptstraße 5\n12043 Berlin');
  assert.ok(toXRechnung);
});
