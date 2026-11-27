/**
 * Steuerarten, Länder und Dokumentarten: die fachlichen Stammdaten der Rechnung.
 *
 * Jede Position hat eine Steuerart. Sie bestimmt den Steuersatz, den Pflichthinweis auf der Rechnung
 * (§ 14 Abs. 4 Nr. 8, § 14a UStG) und die Steuerkategorie der E-Rechnung (EN 16931, UNCL 5305).
 */

export const KLEINUNTERNEHMER_HINWEIS = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';
/** Pflichthinweis bei Bau- und Grundstücksleistungen an Privatkunden. */
export const RETENTION_NOTICE = 'Sie sind gesetzlich verpflichtet, diese Rechnung zwei Jahre aufzubewahren (§ 14b Abs. 1 Satz 5 UStG).';

/**
 * category: Steuerkategorie der E-Rechnung · rate: Satz in % · note: Pflichthinweis auf der Rechnung
 * code: Befreiungsgrund (VATEX) · requires: Angaben, ohne die die Steuerart nicht zulässig ist
 */
export const TAX_TYPES = Object.freeze({
  S19: { key: 'S19', category: 'S', rate: 19, label: '19 %', short: '19 %' },
  S7: { key: 'S7', category: 'S', rate: 7, label: '7 %', short: '7 %' },
  Z: { key: 'Z', category: 'Z', rate: 0, label: '0 % Nullsteuersatz (§ 12 Abs. 3 UStG)', short: '0 %', note: 'Nullsteuersatz nach § 12 Abs. 3 UStG.' },
  E: { key: 'E', category: 'E', rate: 0, label: 'Steuerfrei (§ 4 UStG)', short: 'frei', reasonRequired: true, group: 'E' },
  AE: {
    key: 'AE', category: 'AE', rate: 0, label: 'Reverse-Charge (§ 13b UStG)', short: '0 % RC',
    note: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).', code: 'VATEX-EU-AE', requires: ['buyerVatId'],
  },
  K: {
    key: 'K', category: 'K', rate: 0, label: 'Innergemeinschaftliche Lieferung (EU)', short: '0 % igL',
    note: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b i. V. m. § 6a UStG).', code: 'VATEX-EU-IC',
    requires: ['buyerVatId', 'sellerVatId', 'euBuyer'],
  },
  G: {
    key: 'G', category: 'G', rate: 0, label: 'Ausfuhrlieferung (Drittland)', short: '0 % Ausfuhr',
    note: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a i. V. m. § 6 UStG).', code: 'VATEX-EU-G', requires: ['sellerVatId', 'nonEuBuyer'],
  },
  M: {
    key: 'M', category: 'E', rate: 0, label: 'Differenzbesteuerung (§ 25a UStG)', short: '§ 25a',
    note: 'Gebrauchtgegenstände/Sonderregelung (§ 25a UStG). Die Umsatzsteuer wird nicht gesondert ausgewiesen.', code: 'VATEX-EU-F', group: 'E',
  },
});

export const TAX_TYPE_GROUPS = Object.freeze([
  { label: 'Regelsteuersatz', keys: ['S19', 'S7'] },
  { label: 'Sonderfälle', keys: ['E', 'AE', 'K', 'G', 'M', 'Z'] },
]);

/** Kleinunternehmer: alle Positionen steuerbefreit, ein gemeinsamer Hinweis. */
export const KU_TYPE = Object.freeze({ key: 'KU', category: 'E', rate: 0, label: 'Kleinunternehmer', short: '', note: KLEINUNTERNEHMER_HINWEIS, group: 'E' });

/** Alte Speicherstände kennen nur `taxRate`: so bleiben auch abgeschlossene Rechnungen exakt wie ausgestellt. */
const LEGACY = { 19: 'S19', 7: 'S7', 0: 'Z' };

/** Steuerart einer Position. */
export function taxTypeOf(item, kleinunternehmer = false) {
  if (kleinunternehmer) return KU_TYPE;
  const key = item?.taxType ?? LEGACY[Number(item?.taxRate)];
  const type = TAX_TYPES[key];
  if (!type) throw new Error(`Ungültiger Steuersatz: ${item?.taxType ?? item?.taxRate}`);
  return type;
}

/** Steuerart-Schlüssel aus einem alten Steuersatz (für Formulare). */
export const taxKeyOf = (item) => item?.taxType ?? LEGACY[Number(item?.taxRate)] ?? 'S19';

// ---------- Länder ----------
/** EU-Mitgliedstaaten (ISO 3166-1): Griechenland hat bei der USt-IdNr. das Kürzel „EL“. */
export const EU_COUNTRIES = Object.freeze(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
export const isEU = (country) => EU_COUNTRIES.includes(String(country || 'DE').toUpperCase());

const OTHER_COUNTRIES = ['CH', 'LI', 'NO', 'IS', 'GB', 'TR', 'US', 'CA', 'AE', 'AU', 'CN', 'IN', 'JP', 'RS', 'BA', 'MK', 'AL', 'UA', 'MA'];
let countryNames;
/** Anzeigename eines Landes auf Deutsch („AT“ → „Österreich“). */
export function countryName(code) {
  countryNames ??= typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['de'], { type: 'region' }) : null;
  try { return countryNames?.of(code) ?? code; } catch { return code; }
}
/** Auswahlliste: Deutschland zuerst, dann EU, dann weitere Länder: jeweils alphabetisch. */
export function countryOptions() {
  const sort = (list) => list.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [
    { label: '', options: [{ code: 'DE', name: countryName('DE') }] },
    { label: 'EU', options: sort(EU_COUNTRIES.filter((c) => c !== 'DE')) },
    { label: 'Weitere Länder', options: sort(OTHER_COUNTRIES) },
  ];
}

// ---------- Währungen ----------
export const CURRENCIES = Object.freeze(['EUR', 'CHF', 'USD', 'GBP', 'PLN', 'CZK', 'DKK', 'SEK', 'NOK', 'HUF', 'TRY']);

// ---------- Dokumentarten (UNTDID 1001) ----------
export const DOCUMENT_KINDS = Object.freeze({
  invoice: { key: 'invoice', code: '380', title: 'Rechnung', label: 'Rechnung' },
  partial: { key: 'partial', code: '326', title: 'Abschlagsrechnung', label: 'Abschlagsrechnung' },
  final: { key: 'final', code: '380', title: 'Schlussrechnung', label: 'Schlussrechnung' },
  storno: { key: 'storno', code: '381', title: 'Stornorechnung', label: 'Stornorechnung / Korrektur' },
});
export const kindOf = (inv) => DOCUMENT_KINDS[inv?.kind] ?? DOCUMENT_KINDS.invoice;

// ---------- Rechtsformen (Pflichtangaben auf Geschäftsbriefen) ----------
/** register: Registergericht + -nummer nötig · officers: Geschäftsführung/Vorstand nötig (§ 35a GmbHG, § 80 AktG, § 125a/§ 177a HGB, § 37a HGB) */
export const LEGAL_FORMS = Object.freeze({
  einzel: { label: 'Einzelunternehmen / Freiberufler', register: false, officers: false },
  gbr: { label: 'GbR', register: false, officers: false },
  ek: { label: 'e. K. (eingetragener Kaufmann)', register: true, officers: false, suffix: /\be\.?\s?K(fm|fr)?\.?(?!\w)/i },
  ohg: { label: 'OHG', register: true, officers: false, suffix: /\bOHG\b/i },
  kg: { label: 'KG', register: true, officers: false, suffix: /\bKG\b/i },
  gmbhcokg: { label: 'GmbH & Co. KG', register: true, officers: true, officersLabel: 'Geschäftsführer der Komplementär-GmbH', suffix: /GmbH\s*&\s*Co\.?\s*KG/i },
  gmbh: { label: 'GmbH', register: true, officers: true, officersLabel: 'Geschäftsführer', suffix: /\bGmbH\b/i },
  ug: { label: 'UG (haftungsbeschränkt)', register: true, officers: true, officersLabel: 'Geschäftsführer', suffix: /\bUG\b/i },
  ag: { label: 'AG', register: true, officers: true, officersLabel: 'Vorstand', suffix: /\bAG\b/i },
  ev: { label: 'e. V. (Verein)', register: true, officers: false, suffix: /\be\.\s?V\./i },
  sonstige: { label: 'Sonstige', register: false, officers: false },
});

/** Rechtsform aus dem Firmennamen erraten („Muster GmbH“ → gmbh): für den Hinweis in den Einstellungen. */
export function guessLegalForm(name) {
  const order = ['gmbhcokg', 'gmbh', 'ug', 'ag', 'ohg', 'kg', 'ek', 'ev'];
  return order.find((key) => LEGAL_FORMS[key].suffix.test(String(name ?? ''))) ?? null;
}
