import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkInvoice, validateInvoiceFields, validateXRechnungFields, checkName, checkStreet, checkZip, checkCity, nameError,
  vatIdError, isValidTaxNumber, leitwegIdError, isValidIBAN, formatIBAN, nextInvoiceNumber, numberPatternError, sequenceOf,
  addDays, dueDate, isValidIsoDate, guessLegalForm, epcPayload,
} from '../js/invoice.js';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs';

const ctx = { today: '2026-11-27' };
const fields = (issues) => issues.map((e) => e.field);
const errorsOf = (inv, s, c = ctx) => fields(validateInvoiceFields(inv, s, c));
const warningsOf = (inv, s, c = ctx) => fields(checkInvoice(inv, s, c).filter((e) => e.level === 'warning'));

test('Beispielrechnung ist vollständig', () => {
  assert.deepEqual(checkInvoice(sampleInvoice(), sampleSettings(), ctx), []);
});

test('Pflichtangaben: Fehler nennen das betroffene Feld', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  inv.customer.name = '';
  inv.items[1].unitPrice = '';
  settings.company.taxId = '';
  assert.deepEqual(errorsOf(inv, settings), ['company.taxId', 'customer.name', 'items.1.unitPrice']);
});

test('Plausibilität: harte Fehler blockieren, Verdächtiges ist nur eine Warnung', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  inv.customer.name = 'a';
  inv.customer.street = 'Hauptstraße';
  inv.customer.zip = '123';
  settings.company.taxId = '123';
  settings.company.email = 'kein-mail';
  assert.deepEqual(errorsOf(inv, settings), ['company.email', 'company.taxId', 'customer.name', 'customer.street', 'customer.zip']);
  const inv2 = sampleInvoice();
  inv2.customer.name = 'Test';
  assert.deepEqual(errorsOf(inv2, sampleSettings()), []);
  assert.deepEqual(warningsOf(inv2, sampleSettings()), ['customer.name']);
});

test('Namen: Quatsch erkannt, echte Namen (auch Silbendopplungen) erlaubt', () => {
  for (const bad of ['a', 'xx', 'asdf', 'qwertz', 'aaaa', 'hjkgfd', 'jdjdjd', 'Test', 'Quatsch', 'Lorem Ipsum']) {
    assert.ok(checkName(bad), `„${bad}“ sollte auffallen`);
  }
  for (const ok of ['BMW AG', 'KPMG', 'Max Mustermann Webdesign', 'Hüseyin Surhay Yılmaz', 'Dr. Ömer Şahin', 'Müller & Söhne', "O'Brien",
    'Schifffahrt GmbH', 'Angstschweiß KG', 'Mama Burger', 'Coco', 'Dede', 'Baba', 'Bonbon GmbH', 'Nana', 'Tutu', 'Wer', 'O2', '3M', 'Ng', 'Li']) {
    assert.equal(checkName(ok), null, `„${ok}“ ist ein echter Name`);
  }
  assert.ok(nameError('7'));
});

test('Adressen', () => {
  assert.match(checkStreet('Hauptstraße'), /Hausnummer fehlt/);
  assert.ok(checkStreet('asdf 5'));
  for (const ok of ['Sonnenallee 18', 'Am Markt 12a', 'Straße des 17. Juni 135', 'Karl-Marx-Allee 90/92', 'Postfach 12 34']) assert.equal(checkStreet(ok), null, ok);
  assert.equal(checkZip('12047'), null);
  assert.ok(checkZip('1234'));
  assert.ok(checkZip('00000'));
  assert.equal(checkZip('1010', 'AT'), null);
  assert.equal(checkCity('Frankfurt (Oder)'), null);
  assert.ok(checkCity('B3rlin'));
  assert.ok(checkCity('asdf'));
});

test('USt-IdNr.: Länderformat und deutsche Prüfziffer', () => {
  assert.equal(vatIdError('DE136695976'), null);
  assert.equal(vatIdError('DE 136 695 976'), null);
  assert.match(vatIdError('DE123456789'), /Prüfziffer/);
  assert.match(vatIdError('DE12345'), /9 Ziffern/);
  assert.equal(vatIdError('ATU12345678'), null);
  assert.ok(vatIdError('AT12345678'));
  assert.equal(vatIdError('FR12345678901'), null);
  assert.equal(vatIdError('NL123456789B01'), null);
  assert.match(vatIdError('GR123456789'), /EL/);
  assert.match(vatIdError('XXabc'), /Länderkürzel/);
});

test('Steuernummer: 10, 11 oder 13 Ziffern', () => {
  assert.ok(isValidTaxNumber('12/345/67890'));
  assert.ok(isValidTaxNumber('123/456/78901'));
  assert.ok(isValidTaxNumber('1121081508150'));
  assert.ok(!isValidTaxNumber('12/345/6789'));
  assert.ok(!isValidTaxNumber('123456789012'));
});

test('Leitweg-ID: Format und Prüfziffer (MOD 97-10)', () => {
  assert.equal(leitwegIdError('04011000-1234512345-06'), null);
  assert.equal(leitwegIdError('991-33333TEST-33'), null);
  assert.equal(leitwegIdError('04011000-12345-03'), null);
  assert.match(leitwegIdError('04011000-12345-34'), /Prüfziffer/);
  assert.match(leitwegIdError('foo'), /Format/);
  const inv = sampleInvoice();
  inv.customer.reference = '04011000-12345-34';
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['customer.reference']);
  inv.customer.reference = 'Bestellung 4711'; // freie Käuferreferenz bleibt erlaubt
  assert.deepEqual(errorsOf(inv, sampleSettings()), []);
  inv.customer.reference = '';
  inv.customer.isPublic = true;
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['customer.reference']);
});

test('IBAN und GiroCode', () => {
  // Offizielle Muster-IBANs aus der ISO-13616-/Bankendokumentation – keine echten Konten
  assert.equal(isValidIBAN('DE89 3704 0044 0532 0130 00'), true); // pragma: allowlist secret
  assert.equal(isValidIBAN('DE89370400440532013001'), false); // pragma: allowlist secret
  assert.equal(isValidIBAN('GB82 WEST 1234 5698 7654 32'), true); // pragma: allowlist secret
  assert.equal(formatIBAN('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00'); // pragma: allowlist secret
  const payload = epcPayload({ name: 'Max Mustermann', iban: 'DE89 3704 0044 0532 0130 00', amountCents: 154627, reference: 'RE-2026-0001' }); // pragma: allowlist secret
  assert.deepEqual(payload.split('\n'), ['BCD', '002', '1', 'SCT', '', 'Max Mustermann', 'DE89370400440532013000', 'EUR1546.27', '', '', 'RE-2026-0001']); // pragma: allowlist secret
  assert.throws(() => epcPayload({ name: 'X', iban: 'DE00', amountCents: 100 }), /IBAN/);
  assert.throws(() => epcPayload({ name: 'X', iban: 'DE89370400440532013000', amountCents: 0 }), /Betrag/); // pragma: allowlist secret
});

test('Rechnungsnummern: frei wählbares Format, numerisch fortgezählt', () => {
  assert.equal(nextInvoiceNumber([], { date: '2026-03-01' }), 'RE-2026-0001');
  assert.equal(nextInvoiceNumber(['RE-2026-0041', 'RE-2026-0007'], { date: '2026-03-01' }), 'RE-2026-0042');
  assert.equal(nextInvoiceNumber(['RE-2025-0099'], { date: '2026-01-02' }), 'RE-2026-0001');
  assert.equal(nextInvoiceNumber(['RE-2026-9999', 'RE-2026-0001'], { date: '2026-03-01' }), 'RE-2026-10000');
  assert.equal(nextInvoiceNumber(['2603-007'], { pattern: '{JJ}{MM}-{NR}', digits: 3, date: '2026-03-15' }), '2603-008');
  assert.equal(nextInvoiceNumber(['K-17'], { pattern: 'K-{NR}', digits: 1, date: '2027-01-01' }), 'K-18'); // ohne Jahr: fortlaufend
  assert.equal(sequenceOf('RE-2026-0042', { date: '2026-05-01' }), 42);
  assert.ok(numberPatternError('RE-{JJJJ}'));
  assert.ok(numberPatternError('RE-{NR}-{NR}'));
  assert.ok(numberPatternError('RE-{XY}-{NR}'));
  assert.equal(numberPatternError('RE-{JJJJ}-{NR}'), null);
});

test('Rechnungsnummer muss eindeutig sein, Reihenfolge wird geprüft', () => {
  const inv = sampleInvoice();
  const other = { id: 'x', number: 're-2026-0001 ', status: 'erstellt', date: '2026-11-01' };
  assert.deepEqual(errorsOf(inv, sampleSettings(), { ...ctx, others: [other] }), ['number']);
  inv.number = 'RE-2026-0002';
  const later = { id: 'y', number: 'RE-2026-0005', status: 'erstellt', date: '2026-11-20' };
  assert.deepEqual(warningsOf(inv, sampleSettings(), { ...ctx, others: [later] }), ['date']);
});

test('Datum: echte Kalendertage, keine Zukunft über ein Jahr', () => {
  assert.ok(!isValidIsoDate('2026-02-30'));
  assert.ok(isValidIsoDate('2028-02-29'));
  for (const [date, kind] of [['2026-02-30', 'error'], ['0001-01-01', 'error'], ['2099-01-01', 'error'], ['2026-12-24', 'warning'], ['2024-01-01', 'warning']]) {
    const inv = sampleInvoice(date);
    Object.assign(inv, { serviceMode: 'same', serviceFrom: '', serviceTo: '' });
    const hit = checkInvoice(inv, sampleSettings(), ctx).find((e) => e.field === 'date');
    assert.equal(hit?.level, kind, date);
  }
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-20', 10), '2028-03-01');
  assert.throws(() => addDays('2026-11-27', 99_999_999));
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 14 }), '2026-12-11');
  assert.equal(dueDate({ date: '2026-11-27', paymentDays: 'custom', dueDate: '2027-01-15' }), '2027-01-15');
  const inv = sampleInvoice();
  Object.assign(inv, { paymentDays: 'custom', dueDate: '2026-11-01' });
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['dueDate']);
});

test('Leistungsdatum wird ausdrücklich gewählt', () => {
  const inv = sampleInvoice();
  Object.assign(inv, { serviceMode: 'date', serviceFrom: '' });
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['serviceFrom']);
  Object.assign(inv, { serviceMode: 'period', serviceFrom: '2026-11-10', serviceTo: '2026-11-01' });
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['serviceTo']);
  Object.assign(inv, { serviceMode: 'same', serviceFrom: '', serviceTo: '' });
  assert.deepEqual(errorsOf(inv, sampleSettings()), []);
});

test('Skonto: Eingaben werden geprüft statt abzustürzen', () => {
  for (const [skonto, field] of [[{ percent: 'abc', days: 7 }, 'skonto.percent'], [{ percent: '150', days: 7 }, 'skonto.percent'], [{ percent: '2', days: 99_999 }, 'skonto.days'], [{ percent: '2', days: 0 }, 'skonto.days']]) {
    const inv = sampleInvoice();
    inv.skonto = { enabled: true, ...skonto };
    assert.deepEqual(errorsOf(inv, sampleSettings()), [field], JSON.stringify(skonto));
  }
  const inv = sampleInvoice();
  inv.skonto = { enabled: true, percent: '2', days: 30 };
  assert.deepEqual(warningsOf(inv, sampleSettings()), ['skonto.days']); // Skontofrist nach Fälligkeit
});

test('Rechtsform: Registerangaben und Geschäftsführung, wo vorgeschrieben', () => {
  assert.equal(guessLegalForm('Muster GmbH'), 'gmbh');
  assert.equal(guessLegalForm('Muster GmbH & Co. KG'), 'gmbhcokg');
  assert.equal(guessLegalForm('Max Mustermann e.K.'), 'ek');
  assert.equal(guessLegalForm('Max Mustermann Webdesign'), null);
  const s = sampleSettings();
  s.company.name = 'Muster Webdesign GmbH';
  s.company.legalForm = '';
  assert.deepEqual(errorsOf(sampleInvoice(), s), ['company.legalForm']);
  s.company.legalForm = 'gmbh';
  assert.deepEqual(errorsOf(sampleInvoice(), s), ['company.registerCourt', 'company.registerNumber', 'company.officers']);
  Object.assign(s.company, { registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B', officers: 'Max Mustermann' });
  assert.deepEqual(checkInvoice(sampleInvoice(), s, ctx), []);
});

test('Steuerarten: Voraussetzungen nach § 13b, § 6a, § 6 und § 4 UStG', () => {
  const s = sampleSettings();
  const inv = sampleInvoice();
  inv.items.forEach((i) => { i.taxType = 'AE'; });
  assert.deepEqual(errorsOf(inv, s), ['customer.vatId']);
  inv.customer.vatId = 'DE136695976';
  assert.deepEqual(errorsOf(inv, s), []);

  inv.items.forEach((i) => { i.taxType = 'K'; });
  assert.deepEqual(errorsOf(inv, s).sort(), ['company.vatId', 'customer.vatId', 'items.0.taxType'].sort());
  s.company.vatId = 'DE136695976';
  Object.assign(inv.customer, { country: 'AT', zip: '1010', city: 'Wien', vatId: 'ATU12345678' });
  assert.deepEqual(errorsOf(inv, s), []);

  inv.items.forEach((i) => { i.taxType = 'G'; });
  assert.deepEqual(errorsOf(inv, s), ['items.0.taxType']);
  Object.assign(inv.customer, { country: 'CH', zip: '8001', city: 'Zürich', vatId: '' });
  assert.deepEqual(errorsOf(inv, s), []);

  const e = sampleInvoice();
  e.items[0].taxType = 'E';
  assert.deepEqual(errorsOf(e, sampleSettings()), ['exemptionReason']);
  e.exemptionReason = 'Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG';
  assert.deepEqual(errorsOf(e, sampleSettings()), []);
  e.items[1].taxType = 'M';
  assert.deepEqual(errorsOf(e, sampleSettings()), ['items.1.taxType']);
});

test('Stornorechnung braucht den Verweis auf die Originalrechnung', () => {
  const inv = { ...sampleInvoice(), kind: 'storno', number: 'RE-2026-0002', reference: { number: '', date: '' } };
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['reference.number', 'reference.date']);
  inv.reference = { number: 'RE-2026-0001', date: '2026-11-01' };
  assert.deepEqual(errorsOf(inv, sampleSettings()), []);
});

test('Fremdwährung braucht einen Umrechnungskurs', () => {
  const inv = { ...sampleInvoice(), currency: 'USD', fxRate: '' };
  assert.deepEqual(errorsOf(inv, sampleSettings()), ['fxRate']);
  inv.fxRate = '0,9234';
  assert.deepEqual(errorsOf(inv, sampleSettings()), []);
});

test('E-Rechnung verlangt zusätzlich E-Mail, Telefon und IBAN', () => {
  const settings = sampleSettings();
  const inv = sampleInvoice();
  inv.customer.email = '';
  settings.company.phone = '';
  assert.deepEqual(fields(validateXRechnungFields(inv, settings, ctx)).sort(), ['company.phone', 'customer.email']);
});
