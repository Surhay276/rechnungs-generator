/**
 * Wertet die Prüfberichte des KoSIT-Validators aus.
 * Bricht mit Fehler ab, wenn ein Bericht fehlt oder eine E-Rechnung abgelehnt wurde.
 * Aufruf: node scripts/check-kosit-reports.mjs <berichtsordner> <anzahl-erwarteter-rechnungen>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'reports';
const expected = Number(process.argv[3] ?? 1);
let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('-report.xml'));
} catch {
  console.error(`Kein Berichtsordner „${dir}“ gefunden: der Validator ist nicht gelaufen.`);
  process.exit(1);
}

let failed = files.length < expected;
if (files.length < expected) console.error(`Nur ${files.length} von ${expected} Berichten gefunden.`);

for (const file of files.sort()) {
  const xml = readFileSync(join(dir, file), 'utf8');
  const accepted = /<rep:accept\b/.test(xml);
  // Alle gemeldeten Regelverstöße (Fehler und Warnungen) mit Regel-ID ausgeben
  const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const findings = [
    // KoSIT-Bericht: <rep:message level="error" code="BR-…">Text</rep:message>
    ...[...xml.matchAll(/<rep:message\b([^>]*)>([\s\S]*?)<\/rep:message>/g)].map(([, attrs, text]) => ({
      id: /\bcode="([^"]+)"/.exec(attrs)?.[1] ?? '?',
      level: /\blevel="([^"]+)"/.exec(attrs)?.[1] ?? 'error',
      text,
    })),
    // Schematron-Rohausgabe (falls enthalten)
    ...[...xml.matchAll(/<svrl:failed-assert\b([^>]*)>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>/g)].map(([, attrs, text]) => ({
      id: /\bid="([^"]+)"/.exec(attrs)?.[1] ?? '?',
      level: /\bflag="([^"]+)"/.exec(attrs)?.[1] ?? 'error',
      text,
    })),
  ].map(({ id, level, text }) => `   ${/warn|info/i.test(level) ? '⚠' : '✗'} ${id}: ${decode(text).replace(/\s+/g, ' ').trim()}`);
  console.log(`${accepted ? '✓ angenommen' : '✗ ABGELEHNT '}  ${file.replace('-report.xml', '.xml')}`);
  for (const line of findings) console.log(line);
  if (!accepted) failed = true;
}

if (failed) {
  console.error('\nMindestens eine E-Rechnung entspricht nicht XRechnung 3.0 / EN 16931.');
  process.exit(1);
}
console.log(`\nAlle ${files.length} E-Rechnungen entsprechen XRechnung 3.0 (EN 16931).`);
