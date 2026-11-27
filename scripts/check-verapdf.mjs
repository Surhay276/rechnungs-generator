/**
 * Wertet die Textausgabe von veraPDF aus („PASS <datei> 3b“ / „FAIL <datei> 3b“).
 * Aufruf: node scripts/check-verapdf.mjs <bericht.txt> <anzahl-erwarteter-pdfs>
 */
import { readFileSync } from 'node:fs';

const [file = 'verapdf.txt', expected = '1'] = process.argv.slice(2);
const lines = readFileSync(file, 'utf8').split('\n');
const pass = lines.filter((l) => l.startsWith('PASS'));
const fail = lines.filter((l) => l.startsWith('FAIL'));
for (const l of [...pass, ...fail]) console.log(l.startsWith('PASS') ? `✓ ${l}` : `✗ ${l}`);
if (fail.length || pass.length < Number(expected)) {
  console.error(`\n${fail.length} PDF(s) nicht PDF/A-3b-konform, ${pass.length} von ${expected} bestanden.`);
  process.exit(1);
}
console.log(`\nAlle ${pass.length} ZUGFeRD-PDFs sind PDF/A-3b-konform.`);
