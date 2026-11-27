/**
 * Rechnungsnummern (§ 14 Abs. 4 Nr. 4 UStG): fortlaufend und einmalig.
 *
 * Das Format ist frei wählbar, z. B. „RE-{JJJJ}-{NR}“ → RE-2026-0001. Platzhalter:
 * {JJJJ} Jahr · {JJ} Jahr zweistellig · {MM} Monat · {NR} laufende Nummer.
 * Enthält das Format ein Jahr (oder einen Monat), beginnt die Zählung in jedem Jahr (Monat) neu.
 */

export const DEFAULT_NUMBER_FORMAT = Object.freeze({ pattern: 'RE-{JJJJ}-{NR}', digits: 4 });
const TOKENS = /\{(JJJJ|JJ|MM|NR)\}/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Meldung zu einem Nummernformat oder null. */
export function numberPatternError(pattern) {
  const p = String(pattern ?? '');
  if ((p.match(/\{NR\}/g) ?? []).length !== 1) return 'Das Format braucht genau einmal {NR} für die laufende Nummer.';
  const rest = p.replace(TOKENS, '');
  if (/[{}]/.test(rest)) return 'Unbekannter Platzhalter – erlaubt sind {JJJJ}, {JJ}, {MM} und {NR}.';
  if (!/^[A-Za-z0-9\-_/.]*$/.test(rest)) return 'Erlaubt sind Buchstaben, Ziffern und - _ / .';
  if (p.length > 30) return 'Das Format ist zu lang.';
  return null;
}

function parts(isoDate) {
  const [y, m] = String(isoDate ?? '').split('-');
  return { JJJJ: y, JJ: y?.slice(2), MM: m };
}

/** Regulärer Ausdruck für alle Nummern desselben Zeitraums; Gruppe 1 = laufende Nummer. */
function seriesRegex(pattern, isoDate) {
  const p = parts(isoDate);
  const source = pattern.split(TOKENS).map((piece, i) => {
    if (i % 2 === 0) return escapeRe(piece);
    return piece === 'NR' ? '(\\d+)' : escapeRe(p[piece] ?? '');
  }).join('');
  return new RegExp(`^${source}$`);
}

/**
 * Nächste freie Nummer – die höchste vorhandene Nummer der Serie + 1 (numerisch, nicht als Text sortiert:
 * nach RE-2026-9999 kommt RE-2026-10000).
 */
export function nextInvoiceNumber(existingNumbers, { pattern = DEFAULT_NUMBER_FORMAT.pattern, digits = DEFAULT_NUMBER_FORMAT.digits, date } = {}) {
  const usable = numberPatternError(pattern) ? DEFAULT_NUMBER_FORMAT.pattern : pattern;
  const re = seriesRegex(usable, date);
  const max = (existingNumbers ?? []).reduce((m, n) => {
    const hit = re.exec(String(n ?? ''));
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  const p = parts(date);
  const width = Math.min(8, Math.max(1, Number(digits) || DEFAULT_NUMBER_FORMAT.digits));
  return usable.replace(TOKENS, (_, t) => (t === 'NR' ? String(max + 1).padStart(width, '0') : p[t] ?? ''));
}

/** Laufende Nummer einer Rechnungsnummer innerhalb ihrer Serie (für die Reihenfolge-Prüfung) – oder null. */
export function sequenceOf(number, { pattern = DEFAULT_NUMBER_FORMAT.pattern, date } = {}) {
  const hit = seriesRegex(numberPatternError(pattern) ? DEFAULT_NUMBER_FORMAT.pattern : pattern, date).exec(String(number ?? ''));
  return hit ? Number(hit[1]) : null;
}

/** Vergleich ohne Leerzeichen und Groß-/Kleinschreibung – „re-2026-1 “ und „RE-2026-1“ sind dieselbe Nummer. */
export const sameNumber = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
