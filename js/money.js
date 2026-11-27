/**
 * Zahlen und Geldbeträge: ohne Gleitkomma-Rundungsfehler.
 *
 * Eingaben werden als Text zerlegt und als ganze Zahlen weitergeführt:
 * Beträge in Cent, Einzelpreise und Mengen in Zehntausendsteln (4 Nachkommastellen, wie EN 16931 erlaubt).
 * Gerundet wird kaufmännisch: halbe Werte immer vom Nullpunkt weg (1,005 → 1,01; −1,005 → −1,01).
 */

/** Obergrenzen: verhindern Exponentialschreibweise und Genauigkeitsverlust jenseits von 2^53. */
export const LIMITS = Object.freeze({
  quantity: 9_999_999, // Menge je Position
  unitPrice: 99_999_999, // Einzelpreis in Euro
  totalCents: 99_999_999_999, // Rechnungsbetrag: knapp 1 Mrd. Euro
});

export const PRICE_SCALE = 10_000; // Einzelpreise: 1/10.000 Euro
export const QUANTITY_SCALE = 10_000; // Mengen: 4 Nachkommastellen

const pow10 = (n) => 10n ** BigInt(n);
const abs = (n) => (n < 0n ? -n : n);

/** Ganzzahlige Division (BigInt) mit kaufmännischer Rundung: halbe Werte vom Nullpunkt weg. */
export function roundDiv(a, b) {
  let [x, y] = [BigInt(a), BigInt(b)];
  if (y === 0n) throw new Error('Division durch null');
  if (y < 0n) { x = -x; y = -y; }
  const q = x / y; // schneidet Richtung null ab
  const r = x % y;
  return 2n * abs(r) >= y ? q + (x < 0n ? -1n : 1n) : q;
}

/** Wie roundDiv, aber für gewöhnliche (sichere) Ganzzahlen. */
export const roundDivInt = (a, b) => toSafe(roundDiv(a, b));

function toSafe(big, what = 'Betrag') {
  const n = Number(big);
  if (!Number.isSafeInteger(n)) throw new Error(`${what} ist zu groß.`);
  return n === 0 ? 0 : n; // kein −0
}

/**
 * Zerlegt eine Eingabe in Vorzeichen, Ganzzahl- und Nachkommateil.
 * Deutsch zuerst: „1.234,56“ und „1.500“ (= eintausendfünfhundert). Ohne Komma gilt der Punkt nur dann
 * als Dezimalzeichen, wenn er keine Tausendergruppe bildet („12.5“, „99.90“).
 */
function splitNumber(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const s = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    return m && { neg: m[1] === '-', int: m[2], frac: m[3] ?? '' };
  }
  const s = String(value ?? '').replace(/[\s  €]/g, '').replace(/^\+/, '').replace(/^[−–]/, '-');
  if (s === '') return { neg: false, int: '0', frac: '', empty: true };
  let m;
  if (s.includes(',')) m = /^(-?)(\d{1,3}(?:\.\d{3})+|\d*),(\d*)$/.exec(s);
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) m = /^(-?)([\d.]+)()$/.exec(s);
  else m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  return { neg: m[1] === '-', int: (m[2] || '0').replace(/\./g, ''), frac: m[3] ?? '' };
}

/** Eingabe → ganze Zahl in 10^-decimals (BigInt), kaufmännisch gerundet. Leere Eingabe = 0. */
export function parseScaled(value, decimals, what = 'Betrag') {
  const p = splitNumber(value);
  if (!p) throw new Error(`Ungültiger ${what}: ${value}`);
  let n = BigInt(p.int) * pow10(decimals) + BigInt(p.frac.slice(0, decimals).padEnd(decimals, '0') || '0');
  if ((p.frac[decimals] ?? '0') >= '5') n += 1n;
  return p.neg ? -n : n;
}

export const isEmptyNumber = (value) => typeof value !== 'number' && String(value ?? '').trim() === '';

/** Betrag in Cent: „1.234,56“ → 123456, „1.500“ → 150000, „1,005“ → 101. */
export function toCents(value) {
  return toSafe(parseScaled(value, 2));
}

/** Einzelpreis in 1/10.000 Euro (bis zu vier Nachkommastellen, z. B. 0,0150 € je Stück). */
export function toPriceUnits(value) {
  const units = parseScaled(value, 4, 'Preis');
  if (abs(units) > BigInt(LIMITS.unitPrice) * BigInt(PRICE_SCALE)) throw new Error(`Der Preis ist zu hoch (höchstens ${LIMITS.unitPrice.toLocaleString('de-DE')} €).`);
  return toSafe(units, 'Preis');
}

/** Menge in Zehntausendsteln; nie negativ, höchstens LIMITS.quantity. */
export function toQuantityUnits(value) {
  const p = splitNumber(value);
  if (!p || p.neg) throw new Error(`Ungültige Menge: ${value}`);
  const units = parseScaled(value, 4, 'Menge');
  if (units > BigInt(LIMITS.quantity) * BigInt(QUANTITY_SCALE)) throw new Error(`Ungültige Menge: höchstens ${LIMITS.quantity.toLocaleString('de-DE')}.`);
  return toSafe(units, 'Menge');
}

/** Menge als Zahl (z. B. 1,5 Stunden → 1.5). */
export const toQuantity = (value) => toQuantityUnits(value) / QUANTITY_SCALE;

/** Prozentwert 0-100 mit bis zu vier Nachkommastellen: „2,5“ → 2.5 */
export function toPercent(value) {
  let units;
  try { units = parseScaled(value, 4, 'Prozentwert'); } catch { throw new Error(`Ungültiger Prozentwert: ${value}`); }
  if (units < 0n || units > 100n * 10_000n) throw new Error(`Ungültiger Prozentwert: ${value}`);
  return Number(units) / 10_000;
}

// ---------- Ausgabe ----------
const formatters = new Map();
function currencyFormat(currency, maxDigits = 2) {
  const key = `${currency}:${maxDigits}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: maxDigits }));
  }
  return formatters.get(key);
}

/** Cent → „1.234,56 €“ (oder andere Währung). */
export const formatMoney = (cents, currency = 'EUR') => currencyFormat(currency).format((cents || 0) / 100);
export const formatEUR = (cents) => formatMoney(cents, 'EUR');

/** Einzelpreis (1/10.000) → „0,015 €“ / „12,50 €“: mindestens zwei, höchstens vier Nachkommastellen. */
export const formatPrice = (units, currency = 'EUR') => currencyFormat(currency, 4).format((units || 0) / PRICE_SCALE);

/** Skalierte Ganzzahl → Dezimaltext ohne Rundungsfehler und ohne Exponent („1234.50“, „-0.0150“). */
export function scaledToString(n, decimals, { trim = false, comma = false } = {}) {
  const big = BigInt(n);
  const digits = abs(big).toString().padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  let frac = decimals ? digits.slice(-decimals) : '';
  if (trim) frac = frac.replace(/0+$/, '');
  const sign = big < 0n ? '-' : '';
  return `${sign}${int}${frac ? (comma ? ',' : '.') + frac : ''}`;
}

/** Cent → „1234.56“ (für XML und GiroCode). */
export const centsToDecimal = (cents) => scaledToString(cents, 2);
/** Cent → „1234,56“ (für Eingabefelder). */
export const centsToInput = (cents) => scaledToString(cents, 2, { comma: true });
/** Menge (Zehntausendstel) → „1,5“ (Anzeige) bzw. „1.5“ (XML). */
export const formatQuantity = (units, { comma = true } = {}) => scaledToString(units, 4, { trim: true, comma });
/** Einzelpreis (1/10.000) → Eingabetext „12,50“ bzw. „0,015“. */
export const priceToInput = (units) => {
  const s = scaledToString(units, 4, { trim: true, comma: true });
  const [int, frac = ''] = s.split(',');
  return `${int},${frac.padEnd(2, '0')}`;
};
