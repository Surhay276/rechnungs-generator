/**
 * Prüfung einer Rechnung auf Pflichtangaben (§ 14 Abs. 4, § 14a UStG, Handels- und Gesellschaftsrecht)
 * und auf plausible Eingaben.
 *
 * Jede Meldung nennt das betroffene Feld, damit die Oberfläche genau dieses Feld markieren kann.
 * level „error“ blockiert den Export, level „warning“ ist nur ein Hinweis.
 * Felder unter `company.` liegen in den Einstellungen, alle anderen in der Rechnung.
 */
import {
  nameError, nameWarning, streetError, streetWarning, checkZip, cityError, cityWarning, isValidEmail, isValidPhone,
  isValidTaxNumber, vatIdError, vatIdCountry, isValidIBAN, isValidBIC, leitwegIdError, looksLikeLeitwegId, looksLikeGibberish,
} from './checks.js?v=26';
import { toCents, toQuantityUnits, toPriceUnits, toPercent, parseScaled, isEmptyNumber } from './money.js?v=26';
import { discountCents, lineBase, invoiceTotals } from './calc.js?v=26';
import { isValidIsoDate, dueDate, serviceModeOf, daysBetween, addDays, todayIso } from './dates.js?v=26';
import { TAX_TYPES, taxTypeOf, taxKeyOf, isEU, CURRENCIES, LEGAL_FORMS, guessLegalForm, kindOf } from './tax.js?v=26';
import { sequenceOf, sameNumber, numberPatternError } from './numbering.js?v=26';

const filled = (value) => String(value ?? '').trim() !== '';
export const isError = (issue) => issue.level !== 'warning';

/**
 * Alle Meldungen (Fehler und Warnungen).
 * @param context { others: andere Rechnungen (für Nummern und Reihenfolge), today: ISO-Datum }
 */
export function checkInvoice(inv, settings = {}, context = {}) {
  const issues = [];
  const error = (field, message) => issues.push({ field, message, level: 'error' });
  const warn = (field, message) => issues.push({ field, message, level: 'warning' });
  const c = settings.company ?? {};
  const k = inv.customer ?? {};
  const ku = Boolean(settings.kleinunternehmer);
  const today = context.today ?? todayIso();
  const kind = kindOf(inv);

  /** Pflichtfeld mit harter Prüfung und optionaler Warnung. */
  const required = (field, value, missing, hard, soft) => {
    if (!filled(value)) { error(field, missing); return; }
    const problem = hard?.(value);
    if (problem) { error(field, problem); return; }
    const hint = soft?.(value);
    if (hint) warn(field, hint);
  };
  const address = (prefix, a, whose) => {
    required(`${prefix}.name`, a.name, `Bitte Name oder Firma${whose} angeben.`, nameError, nameWarning);
    required(`${prefix}.street`, a.street, `Bitte Straße und Hausnummer${whose} angeben.`, streetError, streetWarning);
    required(`${prefix}.zip`, a.zip, `Bitte die Postleitzahl${whose} angeben.`, (v) => checkZip(v, a.country));
    required(`${prefix}.city`, a.city, `Bitte den Ort${whose} angeben.`, cityError, cityWarning);
    if (filled(a.email) && !isValidEmail(a.email)) error(`${prefix}.email`, 'Diese E-Mail-Adresse ist ungültig – z. B. „name@firma.de“.');
  };

  // ---------- Eigene Firma ----------
  address('company', c, '');
  if (filled(c.contact)) {
    const problem = nameError(c.contact) ?? nameWarning(c.contact);
    if (problem) warn('company.contact', 'Bitte einen echten Namen angeben.');
  }
  if (filled(c.phone) && !isValidPhone(c.phone)) error('company.phone', 'Bitte eine gültige Telefonnummer angeben (mindestens 6 Ziffern).');
  if (!filled(c.taxId) && !filled(c.vatId)) error('company.taxId', 'Bitte Steuernummer oder USt-IdNr. angeben.');
  if (filled(c.taxId) && !isValidTaxNumber(c.taxId)) error('company.taxId', 'Die Steuernummer hat 10, 11 oder 13 Ziffern – z. B. 12/345/67890.');
  if (filled(c.vatId)) {
    const problem = vatIdError(c.vatId);
    if (problem) error('company.vatId', problem);
    else if (vatIdCountry(c.vatId) !== 'DE') warn('company.vatId', 'Eine deutsche USt-IdNr. beginnt mit „DE“.');
  }
  if (filled(c.iban) && !isValidIBAN(c.iban)) error('company.iban', 'Diese IBAN ist ungültig – bitte prüfen.');
  if (filled(c.bic) && !isValidBIC(c.bic)) error('company.bic', 'Die BIC hat 8 oder 11 Zeichen – z. B. COBADEFFXXX.');
  checkLegalForm(c, error, warn);

  // ---------- Kunde ----------
  address('customer', k, ' des Kunden');
  const country = String(k.country || 'DE').toUpperCase();
  if (filled(k.vatId)) {
    const problem = vatIdError(k.vatId);
    if (problem) error('customer.vatId', problem);
    else if (vatIdCountry(k.vatId) !== country) warn('customer.vatId', 'Das Länderkürzel der USt-IdNr. passt nicht zum Land des Kunden.');
  }
  if (k.isPublic && !filled(k.reference)) error('customer.reference', 'Öffentliche Auftraggeber verlangen eine Leitweg-ID – bitte beim Auftraggeber erfragen.');
  if (filled(k.reference) && (k.isPublic || looksLikeLeitwegId(k.reference))) {
    const problem = leitwegIdError(k.reference);
    if (problem) error('customer.reference', problem);
  }

  // ---------- Nummer und Datum ----------
  const others = (context.others ?? []).filter((o) => o.id !== inv.id);
  if (!filled(inv.number)) error('number', 'Bitte eine Rechnungsnummer angeben.');
  else if (String(inv.number).length > 50) error('number', 'Die Rechnungsnummer ist zu lang (höchstens 50 Zeichen).');
  else if (others.some((o) => sameNumber(o.number, inv.number))) error('number', 'Diese Rechnungsnummer ist schon vergeben – jede Nummer darf nur einmal vorkommen.');

  if (!filled(inv.date)) error('date', 'Bitte das Rechnungsdatum angeben.');
  else if (!isValidIsoDate(inv.date) || inv.date < '2000-01-01') error('date', 'Bitte ein gültiges Rechnungsdatum angeben.');
  else {
    const ahead = daysBetween(today, inv.date);
    if (ahead > 365) error('date', 'Das Rechnungsdatum liegt mehr als ein Jahr in der Zukunft.');
    else if (ahead > 0) warn('date', 'Das Rechnungsdatum liegt in der Zukunft.');
    else if (ahead < -365) warn('date', 'Das Rechnungsdatum liegt mehr als ein Jahr zurück.');
    checkSequence(inv, others, settings.numberFormat, warn);
  }

  if (inv.paymentDays === 'custom') {
    if (!filled(inv.dueDate)) error('dueDate', 'Bitte ein Fälligkeitsdatum wählen.');
    else if (!isValidIsoDate(inv.dueDate)) error('dueDate', 'Bitte ein gültiges Fälligkeitsdatum angeben.');
    else if (isValidIsoDate(inv.date) && inv.dueDate < inv.date) error('dueDate', 'Das Fälligkeitsdatum liegt vor dem Rechnungsdatum.');
  }

  // Leistungsdatum (§ 14 Abs. 4 Nr. 6 UStG) – ausdrücklich gewählt, nicht stillschweigend angenommen
  const mode = serviceModeOf(inv);
  if (mode !== 'same') {
    if (!isValidIsoDate(inv.serviceFrom)) error('serviceFrom', mode === 'date' ? 'Bitte das Leistungsdatum angeben.' : 'Bitte den Beginn des Leistungszeitraums angeben.');
    if (mode === 'period') {
      if (!isValidIsoDate(inv.serviceTo)) error('serviceTo', 'Bitte das Ende des Leistungszeitraums angeben.');
      else if (isValidIsoDate(inv.serviceFrom) && inv.serviceTo < inv.serviceFrom) error('serviceTo', 'Das Enddatum liegt vor dem Anfangsdatum.');
    }
  }

  // ---------- Dokumentart ----------
  if (kind.key === 'storno') {
    if (!filled(inv.reference?.number)) error('reference.number', 'Bitte die Nummer der Rechnung angeben, die storniert oder korrigiert wird.');
    if (!isValidIsoDate(inv.reference?.date)) error('reference.date', 'Bitte das Datum der ursprünglichen Rechnung angeben.');
    else if (isValidIsoDate(inv.date) && inv.reference.date > inv.date) error('reference.date', 'Die ursprüngliche Rechnung kann nicht nach dieser Rechnung ausgestellt sein.');
    if (filled(inv.reference?.number) && sameNumber(inv.reference.number, inv.number)) error('reference.number', 'Die Stornorechnung braucht eine eigene, neue Nummer.');
  }
  if (kind.key === 'final') {
    (inv.prepayments ?? []).forEach((p, i) => {
      const label = `Abschlag ${i + 1}`;
      if (!filled(p.number)) error(`prepayments.${i}.number`, `${label}: Bitte die Nummer der Abschlagsrechnung angeben.`);
      if (!isValidIsoDate(p.date)) error(`prepayments.${i}.date`, `${label}: Bitte das Datum angeben.`);
      let gross = 0;
      try { gross = toCents(p.gross); } catch { error(`prepayments.${i}.gross`, `${label}: Betrag ist ungültig.`); }
      if (gross <= 0 && !issues.some((x) => x.field === `prepayments.${i}.gross`)) error(`prepayments.${i}.gross`, `${label}: Betrag muss größer 0 sein.`);
      try { if (toCents(p.tax) < 0 || toCents(p.tax) > gross) error(`prepayments.${i}.tax`, `${label}: Die enthaltene Umsatzsteuer ist ungültig.`); } catch { error(`prepayments.${i}.tax`, `${label}: Die enthaltene Umsatzsteuer ist ungültig.`); }
    });
  }

  // ---------- Währung ----------
  const currency = inv.currency || 'EUR';
  if (!CURRENCIES.includes(currency)) error('currency', 'Diese Währung wird nicht unterstützt.');
  else if (currency !== 'EUR') {
    let rate = 0n;
    try { rate = parseScaled(inv.fxRate, 6, 'Kurs'); } catch { /* unten */ }
    if (rate <= 0n) error('fxRate', `Bitte den Umrechnungskurs angeben: 1 ${currency} = … EUR.`);
  }

  // ---------- Leistungen ----------
  if (!inv.items?.length) error('items', 'Bitte mindestens eine Leistung hinzufügen.');
  inv.items?.forEach((item, i) => {
    const label = `Leistung ${i + 1}`;
    const f = (key) => `items.${i}.${key}`;
    if (!filled(item.description)) error(f('description'), `${label}: Titel fehlt.`);
    else if (String(item.description).trim().length < 2 || !/\p{L}/u.test(item.description)) error(f('description'), `${label}: Bitte die Leistung verständlich benennen – z. B. „Webdesign Startseite“.`);
    else if (String(item.description).length > 500) error(f('description'), `${label}: Der Titel ist zu lang (höchstens 500 Zeichen).`);
    else if (looksLikeGibberish(item.description)) warn(f('description'), `${label}: Ist die Leistung verständlich benannt? (§ 14 Abs. 4 Nr. 5 UStG)`);
    try {
      if (toQuantityUnits(item.quantity) === 0) error(f('quantity'), `${label}: Menge muss größer 0 sein.`);
    } catch (e) {
      error(f('quantity'), `${label}: ${/höchstens/.test(e.message) ? e.message.replace('Ungültige Menge: ', 'Menge ') : 'Menge ist keine gültige Zahl.'}`);
    }
    if (isEmptyNumber(item.unitPrice)) error(f('unitPrice'), `${label}: Preis fehlt.`);
    else {
      try { toPriceUnits(item.unitPrice); } catch (e) { error(f('unitPrice'), `${label}: ${/zu hoch/.test(e.message) ? e.message : 'Preis ist kein gültiger Betrag.'}`); }
    }
    try { discountCents(lineBase(item), item.discount); } catch {
      if (!issues.some((x) => x.field.startsWith(`items.${i}.`))) error(f('discount.value'), `${label}: Rabatt ist ungültig.`);
    }
    if (!ku && !TAX_TYPES[taxKeyOf(item)]) error(f('taxType'), `${label}: Ungültige Steuerart.`);
  });
  if (!isEmptyNumber(inv.discount?.value)) {
    try { discountCents(1, inv.discount); } catch { error('discount.value', 'Der Gesamtrabatt ist ungültig.'); }
  }
  if (!ku) checkTaxTypes(inv, c, k, error, warn);

  // ---------- Skonto ----------
  if (inv.skonto?.enabled && kind.key !== 'storno') {
    let percent = null;
    try { percent = toPercent(inv.skonto.percent); } catch { /* unten */ }
    if (!percent || percent >= 100) error('skonto.percent', 'Skonto: bitte einen Prozentwert zwischen 0 und 100 angeben – z. B. 2.');
    const days = Number(inv.skonto.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) error('skonto.days', 'Skonto: bitte eine Frist von 1 bis 365 Tagen angeben.');
    else if (isValidIsoDate(inv.date)) {
      const due = dueDate(inv);
      if (due && addDays(inv.date, days) > due) warn('skonto.days', 'Die Skontofrist endet nach dem Fälligkeitsdatum.');
    }
  }

  // ---------- Summen ----------
  if (!issues.some((x) => isError(x) && x.field.startsWith('items'))) {
    try {
      const t = invoiceTotals(inv, settings);
      if (kind.key === 'final' && t.payable < 0) error('prepayments', 'Die Abschläge sind höher als der Rechnungsbetrag.');
      else if (kind.key !== 'storno' && t.gross < 0) warn('items', 'Der Rechnungsbetrag ist negativ – für Gutschriften und Korrekturen bitte die Dokumentart „Stornorechnung“ wählen.');
    } catch (e) {
      error('items', e.message);
    }
  }
  return issues;
}

/** Rechtsform: Registergericht, Registernummer und Vertretungsberechtigte, wo das Gesetz sie verlangt. */
function checkLegalForm(c, error, warn) {
  const guessed = guessLegalForm(c.name);
  const form = LEGAL_FORMS[c.legalForm];
  if (!form) {
    if (guessed) error('company.legalForm', `Der Firmenname enthält die Rechtsform „${LEGAL_FORMS[guessed].label}“ – bitte Rechtsform und Registerangaben ergänzen.`);
    return;
  }
  if (guessed && guessed !== c.legalForm && !['sonstige'].includes(c.legalForm)) {
    warn('company.legalForm', `Der Firmenname deutet auf „${LEGAL_FORMS[guessed].label}“ hin – bitte die Rechtsform prüfen.`);
  }
  if (form.register) {
    if (!filled(c.registerCourt)) error('company.registerCourt', 'Bitte das Registergericht angeben – z. B. „Amtsgericht Charlottenburg“.');
    if (!filled(c.registerNumber)) error('company.registerNumber', 'Bitte die Registernummer angeben – z. B. „HRB 123456 B“.');
    else if (!/^(HRA|HRB|VR|GnR|PR)\s?\d+/i.test(String(c.registerNumber).trim())) warn('company.registerNumber', 'Registernummern beginnen meist mit HRA, HRB, VR, GnR oder PR.');
  }
  if (form.officers && !filled(c.officers)) error('company.officers', `Bitte ${form.officersLabel === 'Vorstand' ? 'den Vorstand' : 'die Geschäftsführung'} angeben (Pflicht auf Geschäftsbriefen).`);
}

/** Voraussetzungen der Steuerarten (§ 13b, § 4 Nr. 1, § 6a, § 14a, § 25a UStG und EN 16931). */
function checkTaxTypes(inv, c, k, error, warn) {
  const types = new Map();
  inv.items?.forEach((item, i) => {
    let type;
    try { type = taxTypeOf(item); } catch { return; }
    if (!types.has(type.key)) types.set(type.key, i);
  });
  const field = (key) => `items.${types.get(key)}.taxType`;
  const country = String(k.country || 'DE').toUpperCase();
  for (const key of types.keys()) {
    const type = TAX_TYPES[key];
    for (const need of type.requires ?? []) {
      if (need === 'buyerVatId' && !filled(k.vatId)) error('customer.vatId', `${type.label}: Bitte die USt-IdNr. des Kunden angeben (§ 14a UStG).`);
      if (need === 'sellerVatId' && !filled(c.vatId)) error('company.vatId', `${type.label}: Dafür brauchst du eine eigene USt-IdNr.`);
      if (need === 'euBuyer' && (!isEU(country) || country === 'DE')) error(field(key), 'Innergemeinschaftliche Lieferungen gehen nur an Kunden in einem anderen EU-Land.');
      if (need === 'nonEuBuyer' && isEU(country)) error(field(key), 'Ausfuhrlieferungen gehen nur an Kunden außerhalb der EU.');
    }
    if (key === 'K' && filled(k.vatId) && vatIdCountry(k.vatId) === 'DE') error('customer.vatId', 'Bei innergemeinschaftlichen Lieferungen braucht der Kunde eine ausländische USt-IdNr.');
  }
  if (types.has('E') && !filled(inv.exemptionReason)) error('exemptionReason', 'Bitte den Grund der Steuerbefreiung angeben – z. B. „Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG“.');
  if (types.has('E') && types.has('M')) error(field('M'), 'Steuerfreie Leistungen (§ 4) und Differenzbesteuerung (§ 25a) bitte auf getrennten Rechnungen abrechnen.');
  if (types.has('AE') && types.size > 1 && country !== 'DE') warn(field('AE'), 'Reverse-Charge und andere Steuerarten auf einer Rechnung – bitte prüfen, ob das so gewollt ist.');
}

/** Nummernfolge: eine höhere Nummer mit früherem Datum (oder umgekehrt) deutet auf eine Lücke oder einen Fehler hin. */
function checkSequence(inv, others, numberFormat, warn) {
  const pattern = numberFormat?.pattern;
  if (pattern && numberPatternError(pattern)) return;
  const own = sequenceOf(inv.number, { pattern, date: inv.date });
  if (own === null) return;
  const conflict = others.filter((o) => o.status === 'erstellt' && isValidIsoDate(o.date)).find((o) => {
    const seq = sequenceOf(o.number, { pattern, date: inv.date });
    return seq !== null && ((seq < own && o.date > inv.date) || (seq > own && o.date < inv.date));
  });
  if (conflict) warn('date', `Die Reihenfolge passt nicht zu ${conflict.number} vom ${conflict.date.split('-').reverse().join('.')} – Nummern sollten mit dem Datum aufsteigen.`);
}

/** Nur die Fehler, die den Export blockieren. */
export const validateInvoiceFields = (inv, settings, context) => checkInvoice(inv, settings, context).filter(isError);
/** Kurzform: nur die Fehlermeldungen. */
export const validateInvoice = (inv, settings, context) => validateInvoiceFields(inv, settings, context).map((e) => e.message);

/** Zusätzliche Angaben, die eine E-Rechnung im Format XRechnung braucht (BR-DE-2, -5, -6, -7, -19 …). */
export function validateXRechnungFields(inv, settings = {}, context = {}) {
  const errors = validateInvoiceFields(inv, settings, context);
  const c = settings.company ?? {};
  const add = (field, ok, message) => { if (!ok) errors.push({ field, message, level: 'error' }); };
  add('company.email', isValidEmail(c.email), 'Für die E-Rechnung wird deine E-Mail-Adresse benötigt.');
  add('company.phone', isValidPhone(c.phone), 'Für die E-Rechnung wird deine Telefonnummer benötigt.');
  if (kindOf(inv).key !== 'storno') add('company.iban', isValidIBAN(c.iban), 'Für die E-Rechnung wird eine gültige IBAN benötigt.');
  add('customer.email', isValidEmail(inv.customer?.email), 'Für die E-Rechnung wird die E-Mail-Adresse des Kunden benötigt.');
  return errors.filter((e, i, all) => all.findIndex((x) => x.field === e.field) === i);
}
