import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, splitStreet, searchStreets } from '../js/address.js';

test('Adresse: Straße und Hausnummer trennen', () => {
  assert.deepEqual(splitStreet('Sonnenallee 18'), { name: 'Sonnenallee', number: '18' });
  assert.deepEqual(splitStreet('Am Markt 12 a'), { name: 'Am Markt', number: '12a' });
  assert.deepEqual(splitStreet('Karl-Marx-Allee 90/92'), { name: 'Karl-Marx-Allee', number: '90/92' });
  assert.deepEqual(splitStreet('Sonn'), { name: 'Sonn', number: '' });
});

test('Adresse: nur Straßen, die mit der Eingabe beginnen', () => {
  assert.ok(matchScore('Sonn', 'Sonnenallee') > 0);
  assert.ok(matchScore('hauptstr', 'Hauptstraße') > 0);
  assert.ok(matchScore('Hauptstr.', 'Hauptstraße') > 0);
  assert.ok(matchScore('karl marx', 'Karl-Marx-Allee') > 0);
  assert.ok(matchScore('strasse des 17', 'Straße des 17. Juni') > 0);
  assert.equal(matchScore('Sonn', 'Johannisstraße'), 0);
  assert.equal(matchScore('Sonn', 'Alkersleber Weg'), 0);
  assert.ok(matchScore('Sonnenallee', 'Sonnenallee') > matchScore('allee', 'Sonnenallee'));
});

test('Adresse: unscharfe Treffer raus, Nähe und PLZ sortieren', async () => {
  const feature = (type, props, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: { type, countrycode: 'DE', ...props } });
  const original = globalThis.fetch;
  let url;
  globalThis.fetch = async (u) => { url = new URL(u); return new Response(JSON.stringify({ features: [
    feature('street', { name: 'Alkersleber Weg', postcode: '99334', city: 'Amt Wachsenburg' }, 10.9, 50.9),
    feature('street', { name: 'Sonnenstraße', postcode: '37351', city: 'Dingelstädt' }, 10.3, 51.3),
    feature('house', { street: 'Sonnenallee', housenumber: '18', postcode: '12047', city: 'Berlin' }, 13.43, 52.48),
    feature('house', { street: 'Sonnenallee', housenumber: '20', postcode: '12047', city: 'Berlin' }, 13.43, 52.48),
    feature('street', { name: 'Sonnenallee', postcode: '12059', city: 'Berlin' }, 13.45, 52.47),
    feature('street', { name: 'Sonnenweg', postcode: '1234', city: 'Wien', countrycode: 'AT' }, 16.3, 48.2),
  ] }), { headers: { 'content-type': 'application/json' } }); };
  try {
    const berlin = { lat: 52.49, lon: 13.42, near: true };
    const r = await searchStreets('Sonn', { bias: berlin });
    assert.deepEqual(r.map((x) => `${x.street} ${x.zip}`), ['Sonnenallee 12047', 'Sonnenallee 12059', 'Sonnenstraße 37351']);
    assert.equal(url.searchParams.get('lat'), '52.49');
    assert.ok(url.searchParams.get('bbox'), 'nur Deutschland');
    // mit Hausnummer: genau passendes Haus zuerst; mit eingetragener PLZ: diese zuerst
    const withNumber = await searchStreets('Sonnenallee 18', { bias: berlin });
    assert.equal(withNumber[0].street, 'Sonnenallee 18');
    assert.equal(withNumber[0].zip, '12047');
    const byZip = await searchStreets('Sonnenall', { zip: '12059' });
    assert.equal(byZip[0].zip, '12059');
  } finally {
    globalThis.fetch = original;
  }
});
