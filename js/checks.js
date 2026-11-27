/**
 * Prüfungen einzelner Angaben: Namen, Adressen, Kennungen (IBAN, BIC, USt-IdNr., Steuernummer, Leitweg-ID).
 * Jede Prüfung liefert eine verständliche Meldung oder null.
 */

// ---------- Plausibilität von Namen und Adressen ----------
// Pflichtfelder allein reichen nicht: „a“ oder „asdf“ wären sonst ein gültiger Name. Harte Fehler gibt es nur
// für eindeutig Unbrauchbares; alles, was nur verdächtig aussieht („Test“, „qwertz“), ist eine Warnung.

const PLACEHOLDERS = new Set(['test', 'tester', 'testtest', 'asdf', 'abc', 'abcd', 'xyz', 'xxx', 'foo', 'bar', 'foobar', 'name', 'firma',
  'kunde', 'straße', 'strasse', 'ort', 'stadt', 'quatsch', 'bla', 'blabla', 'keine', 'keiner', 'unbekannt', 'na', 'n/a', 'none', 'null',
  'undefined', 'dummy', 'lorem', 'ipsum', 'lorem ipsum', 'hallo', 'hello']);
// Tastaturreihen (deutsch und englisch) und das Alphabet: „asdfg“ oder „qwertz“ sind keine Namen
const KEY_ROWS = ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnm', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz'];
const VOWELS = /[aeiouyäöüıøæœ]/i;

const letterCount = (s) => (String(s).match(/\p{L}/gu) ?? []).length;
const alnumCount = (s) => (String(s).match(/[\p{L}\d]/gu) ?? []).length;
const lettersOnly = (s) => String(s).toLowerCase().replace(/[^\p{L}]/gu, '');

/**
 * Sieht ein Text nach Tastatur-Gehämmer, Platzhalter oder Wiederholung aus?
 * Echte Namen mit Silbendopplung („Mama“, „Coco“, „Dede“, „Bonbon“) bleiben erlaubt.
 */
export function looksLikeGibberish(value) {
  const s = String(value ?? '').trim();
  const lower = s.toLowerCase();
  if (PLACEHOLDERS.has(lower) || PLACEHOLDERS.has(lettersOnly(s))) return true;
  if (/(\p{L})\1{3,}/iu.test(s)) return true; // „aaaa“ – drei gleiche Buchstaben gibt es („Schifffahrt“), vier nicht
  const letters = lettersOnly(s);
  if (/^(\p{L})\1$/u.test(letters)) return true; // „xx“
  if (letters.length >= 6 && /^(\p{L}{1,3})\1{2,}$/u.test(letters)) return true; // „jdjdjd“, „lalala“
  if (letters.length >= 4 && KEY_ROWS.some((row) => row.includes(letters) || [...row].reverse().join('').includes(letters))) return true;
  // Längere Wörter ohne einen einzigen Vokal („hjkgfd“); kurze Abkürzungen wie „BMW“ oder „KPMG“ bleiben erlaubt
  return s.split(/[\s\-/.,&]+/).some((word) => {
    const w = lettersOnly(word.normalize('NFD').replace(/\p{M}/gu, ''));
    return w.length >= 5 && !VOWELS.test(w);
  });
}

/** Harte Fehler bei Namen (Person/Firma). „O2“ und „3M“ sind gültig. */
export function nameError(value) {
  const s = String(value ?? '').trim();
  if (alnumCount(s) < 2 || letterCount(s) < 1) return 'Bitte den vollständigen Namen angeben (mindestens 2 Zeichen).';
  if (s.length > 200) return 'Der Name ist zu lang (höchstens 200 Zeichen).';
  if (!/^[\p{L}\p{M}\d\s&.,'’´`"„“”()\-+/@!:·|]+$/u.test(s)) return 'Der Name enthält ungültige Zeichen.';
  return null;
}
/** Warnung bei verdächtigen Namen – blockiert nicht. */
export const nameWarning = (value) => (looksLikeGibberish(value) ? 'Sieht nicht nach einem echten Namen aus – bitte prüfen.' : null);
/** Fehler oder Warnung (für Tests und einfache Prüfungen). */
export const checkName = (value) => nameError(value) ?? nameWarning(value);

/** Straße mit Hausnummer („Hauptstraße 5“, „Am Markt 12a“, „Postfach 12 34“). */
export function streetError(value) {
  const s = String(value ?? '').trim();
  if (letterCount(s) < 3) return 'Bitte Straße und Hausnummer angeben – z. B. „Hauptstraße 5“.';
  if (!/\d/.test(s)) return 'Die Hausnummer fehlt – z. B. „Hauptstraße 5“.';
  if (s.length > 150) return 'Die Straße ist zu lang.';
  if (!/^[\p{L}\p{M}\d\s.,'’\-/()]+$/u.test(s)) return 'Die Straße enthält ungültige Zeichen.';
  return null;
}
export const streetWarning = (value) => (looksLikeGibberish(String(value ?? '').replace(/\d+\s*[a-z]?\b/giu, ' ')) ? 'Diese Straße sieht nicht echt aus – bitte prüfen.' : null);
export const checkStreet = (value) => streetError(value) ?? streetWarning(value);

/** Postleitzahl: in Deutschland genau fünf Ziffern, sonst 2–10 Zeichen. */
export function checkZip(value, country = 'DE') {
  const s = String(value ?? '').trim();
  if ((country || 'DE') === 'DE') {
    if (!/^\d{5}$/.test(s)) return 'Die Postleitzahl besteht aus 5 Ziffern.';
    if (Number(s) < 1001) return 'Diese Postleitzahl gibt es nicht.';
    return null;
  }
  return /^[A-Z0-9][A-Z0-9 -]{1,9}$/i.test(s) ? null : 'Bitte eine gültige Postleitzahl angeben.';
}

/** Ort ohne Ziffern („Frankfurt (Oder)“, „St. Ingbert“). */
export function cityError(value) {
  const s = String(value ?? '').trim();
  if (letterCount(s) < 2) return 'Bitte den Ort angeben.';
  if (/\d/.test(s)) return 'Der Ort darf keine Ziffern enthalten.';
  if (!/^[\p{L}\p{M}\s.'’()\-/]+$/u.test(s)) return 'Der Ort enthält ungültige Zeichen.';
  return null;
}
export const cityWarning = (value) => (looksLikeGibberish(value) ? 'Diesen Ort gibt es so wohl nicht – bitte prüfen.' : null);
export const checkCity = (value) => cityError(value) ?? cityWarning(value);

export const isValidEmail = (value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(String(value ?? '').trim());
export const isValidPhone = (value) => {
  const s = String(value ?? '').trim();
  return /^\+?[\d\s()/\-–.]+$/.test(s) && (s.match(/\d/g) ?? []).length >= 6;
};

// ---------- Steuerliche Kennungen ----------
/**
 * Steuernummer: Länderformat mit 10 oder 11 Ziffern (z. B. 12/345/67890, 123/456/78901)
 * oder bundeseinheitlich mit 13 Ziffern (z. B. 1121081508150).
 */
export const isValidTaxNumber = (value) => {
  const s = String(value ?? '').trim();
  const digits = (s.match(/\d/g) ?? []).length;
  return /^[\d\s/]+$/.test(s) && [10, 11, 13].includes(digits);
};

/** USt-IdNr.-Formate der EU (VIES) und einiger Nachbarländer. */
const VAT_FORMATS = {
  AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/, EE: /^EE\d{9}$/, EL: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/, FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/, IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/, LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, XI: /^XI(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  CH: /^CHE\d{9}(MWST|TVA|IVA)?$/, GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, NO: /^NO\d{9}(MVA)?$/,
};
export const cleanVatId = (value) => String(value ?? '').replace(/[\s.\-]/g, '').toUpperCase();

/** Prüfziffer der deutschen USt-IdNr. (ISO 7064, MOD 11,10). */
function deVatChecksum(digits) {
  let p = 10;
  for (const c of digits.slice(0, 8)) {
    let s = (Number(c) + p) % 10;
    if (s === 0) s = 10;
    p = (2 * s) % 11;
  }
  const check = 11 - p === 10 ? 0 : 11 - p;
  return check === Number(digits[8]);
}

/** Meldung zu einer USt-IdNr. oder null. */
export function vatIdError(value) {
  const s = cleanVatId(value);
  const format = VAT_FORMATS[s.slice(0, 2)] ?? (s.startsWith('CHE') ? VAT_FORMATS.CH : null);
  if (!format) return s.startsWith('GR') ? 'Griechische USt-IdNr. beginnen mit „EL“, nicht „GR“.' : 'Unbekanntes Länderkürzel – die USt-IdNr. beginnt mit dem Länderkürzel, z. B. „DE“ oder „ATU“.';
  if (!format.test(s)) return s.startsWith('DE') ? 'Die USt-IdNr. besteht aus „DE“ und 9 Ziffern.' : 'Die USt-IdNr. hat nicht das Format dieses Landes.';
  if (s.startsWith('DE') && !deVatChecksum(s.slice(2))) return 'Die Prüfziffer der USt-IdNr. stimmt nicht – bitte Zahlendreher prüfen.';
  return null;
}
export const isValidVatId = (value) => vatIdError(value) === null;
/** Länderkürzel einer USt-IdNr. als ISO-Land („EL…“ → „GR“). */
export const vatIdCountry = (value) => {
  const prefix = cleanVatId(value).slice(0, 2);
  return prefix === 'EL' ? 'GR' : prefix;
};

export const isValidBIC = (value) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(value ?? '').replace(/\s/g, '').toUpperCase());

/** Prüft eine IBAN per ISO-13616-Prüfsumme (Modulo 97). */
export function isValidIBAN(input) {
  const iban = cleanIBAN(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}
export const cleanIBAN = (iban) => String(iban ?? '').replace(/\s/g, '').toUpperCase();
export const formatIBAN = (iban) => cleanIBAN(iban).replace(/(.{4})/g, '$1 ').trim();

/** Rest modulo 97 einer alphanumerischen Kennung (A = 10 … Z = 35). */
function mod97(text) {
  const digits = text.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

/**
 * Leitweg-ID der öffentlichen Verwaltung: Grobadressierung (2–12 Ziffern) – optional Feinadressierung (bis 30 Zeichen)
 * – Prüfziffer (2 Ziffern, ISO 7064 MOD 97-10). Beispiel: 04011000-1234512345-06.
 */
export const LEITWEG_PATTERN = /^\d{2,12}(-[A-Z0-9]{1,30})?-\d{2}$/i;
export function leitwegIdError(value) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!LEITWEG_PATTERN.test(s)) return 'Die Leitweg-ID hat das Format „Grobadresse-Feinadresse-Prüfziffer“, z. B. 04011000-1234512345-06.';
  if (mod97(s.replace(/-/g, '')) !== 1) return 'Die Prüfziffer der Leitweg-ID stimmt nicht – bitte mit dem Auftraggeber abgleichen.';
  return null;
}
/** Sieht die Käuferreferenz wie eine Leitweg-ID aus? Dann wird sie auch so geprüft. */
export const looksLikeLeitwegId = (value) => /^\d{2,12}-/.test(String(value ?? '').trim());
