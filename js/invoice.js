/**
 * Rechenlogik des Rechnungsgenerators – ohne DOM, vollständig testbar.
 *
 * Geldbeträge werden intern in **Cent als Ganzzahl** geführt, damit keine
 * Gleitkomma-Rundungsfehler entstehen (0.1 + 0.2 !== 0.3).
 */

export const TAX_RATES = Object.freeze([19, 7, 0]);
export const KLEINUNTERNEHMER_HINWEIS = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

/** Einheiten mit UN/ECE-Codes (Rec. 20) – nötig für die E-Rechnung. */
export const UNITS = Object.freeze([
  { code: 'H87', label: 'Stk.' },
  { code: 'HUR', label: 'Std.' },
  { code: 'DAY', label: 'Tag' },
  { code: 'MON', label: 'Monat' },
  { code: 'LS', label: 'Pausch.' },
  { code: 'KMT', label: 'km' },
  { code: 'KGM', label: 'kg' },
  { code: 'C62', label: 'Einheit' },
]);
export const unitLabel = (code) => UNITS.find((u) => u.code === code)?.label ?? '';

// ---------- Zahlen ----------
/** Wandelt eine Eingabe wie "1.234,56", "12,5" oder 12.5 in Cent um. */
export function toCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Ungültiger Betrag');
    return Math.round(value * 100);
  }
  const s = String(value ?? '').trim().replace(/\s|€/g, '');
  if (s === '') return 0;
  // deutsches Format: Punkt = Tausendertrennzeichen, Komma = Dezimaltrennzeichen
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new Error(`Ungültiger Betrag: ${value}`);
  return Math.round(Number(normalized) * 100);
}

/** Parst eine Menge (darf Nachkommastellen haben, z. B. 1,5 Stunden). */
export function toQuantity(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültige Menge: ${value}`);
  return n;
}

/** Prozentwert wie "2,5" → 2.5 */
export function toPercent(value) {
  const n = Number(String(value ?? '').trim().replace(',', '.') || 0);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Ungültiger Prozentwert: ${value}`);
  return n;
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const formatEUR = (cents) => eur.format(cents / 100);
const dec = (cents) => (cents / 100).toFixed(2);

/** Netto → Brutto und zurück (für das Feld „Preis inkl. USt“). */
export const grossFromNet = (netCents, rate) => Math.round(netCents * (1 + rate / 100));
export const netFromGross = (grossCents, rate) => Math.round(grossCents / (1 + rate / 100));

// ---------- Positionen & Summen ----------
/** Rabattbetrag in Cent für eine Basis – als Prozent oder fester Betrag, nie mehr als die Basis. */
export function discountCents(baseCents, discount) {
  if (!discount || discount.value === '' || discount.value === undefined || discount.value === null) return 0;
  const raw = discount.type === 'percent'
    ? Math.round((baseCents * toPercent(discount.value)) / 100)
    : toCents(discount.value);
  if (raw < 0) throw new Error('Rabatt darf nicht negativ sein.');
  return Math.min(raw, Math.max(baseCents, 0));
}

/** Betrag einer Position vor Rabatt (Menge × Einzelpreis, kaufmännisch gerundet). */
export const lineBase = ({ quantity, unitPrice }) => Math.round(toQuantity(quantity) * toCents(unitPrice));

/** Nettobetrag einer Position nach Positionsrabatt. */
export function lineNet(item) {
  const base = lineBase(item);
  return base - discountCents(base, item.discount);
}

/**
 * Verteilt einen Betrag proportional auf Anteile – nach dem Verfahren der größten Reste,
 * damit die Summe exakt stimmt (wichtig, wenn ein Gesamtrabatt mehrere Steuersätze betrifft).
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const result = exact.map(Math.floor);
  let rest = total - result.reduce((a, b) => a + b, 0);
  exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (rest > 0) { result[i] += 1; rest -= 1; }
  });
  return result;
}

/**
 * Berechnet alle Beträge einer Rechnung.
 * Steuer wird je Steuersatz auf die Summe berechnet (nicht je Zeile) → keine Rundungsdifferenzen.
 * Ein Gesamtrabatt mindert die Bemessungsgrundlage anteilig je Steuersatz.
 */
export function calculateTotals(items, { kleinunternehmer = false, discount = null } = {}) {
  const lines = items.map((item) => {
    const rate = kleinunternehmer ? 0 : Number(item.taxRate);
    if (!TAX_RATES.includes(rate)) throw new Error(`Ungültiger Steuersatz: ${item.taxRate}`);
    const base = lineBase(item);
    const lineDiscount = discountCents(base, item.discount);
    return { base, discount: lineDiscount, net: base - lineDiscount, rate };
  });

  const subtotal = lines.reduce((s, l) => s + l.net, 0);
  const totalDiscount = discountCents(subtotal, discount);

  const rates = [...new Set(lines.map((l) => l.rate))].sort((a, b) => b - a);
  const rateNet = rates.map((r) => lines.filter((l) => l.rate === r).reduce((s, l) => s + l.net, 0));
  const rateDiscount = allocate(totalDiscount, rateNet);

  const breakdown = rates.map((rate, i) => {
    const base = rateNet[i] - rateDiscount[i];
    return { rate, base, discount: rateDiscount[i], amount: Math.round((base * rate) / 100) };
  });
  const taxes = breakdown.filter((b) => b.rate > 0).map(({ rate, base, amount }) => ({ rate, base, amount }));
  const tax = taxes.reduce((s, t) => s + t.amount, 0);
  const net = subtotal - totalDiscount;
  return { lines, subtotal, discount: totalDiscount, net, breakdown, taxes, tax, gross: net + tax };
}

/** Skonto: Betrag und Frist für schnelle Zahlung. */
export function skontoInfo(grossCents, issueDate, skonto) {
  if (!skonto?.enabled) return null;
  const percent = toPercent(skonto.percent);
  const days = Number(skonto.days);
  if (!percent || !Number.isInteger(days) || days <= 0) return null;
  const amount = Math.round((grossCents * percent) / 100);
  return { percent, days, amount, payable: grossCents - amount, until: issueDate ? addDays(issueDate, days) : null };
}

// ---------- Datum & Nummern ----------
/** Nächste Rechnungsnummer im Format RE-JJJJ-0001; Zähler beginnt jedes Jahr neu. */
export function nextInvoiceNumber(lastNumber, year = new Date().getFullYear()) {
  const match = /^RE-(\d{4})-(\d+)$/.exec(lastNumber ?? '');
  const counter = match && Number(match[1]) === year ? Number(match[2]) + 1 : 1;
  return `RE-${year}-${String(counter).padStart(4, '0')}`;
}

/** Addiert Tage zu einem ISO-Datum (JJJJ-MM-TT), zeitzonensicher in UTC. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** Fälligkeitsdatum: festes Datum („Wählen“) oder Rechnungsdatum + Zahlungsziel. */
export function dueDate(inv) {
  if (inv.paymentDays === 'custom') return inv.dueDate || null;
  return inv.date ? addDays(inv.date, Number(inv.paymentDays) || 0) : null;
}

// ---------- Bankdaten ----------
/** Prüft eine IBAN per ISO-13616-Prüfsumme (Modulo 97). */
export function isValidIBAN(input) {
  const iban = String(input ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export const cleanIBAN = (iban) => String(iban ?? '').replace(/\s/g, '').toUpperCase();
export const formatIBAN = (iban) => cleanIBAN(iban).replace(/(.{4})/g, '$1 ').trim();

/**
 * Inhalt eines GiroCodes (EPC-QR, Version 002) – die Banking-App liest Empfänger, IBAN,
 * Betrag und Verwendungszweck direkt ein.
 */
export function epcPayload({ name, iban, bic = '', amountCents, reference = '' }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Empfängername fehlt.');
  if (!isValidIBAN(iban)) throw new Error('Ungültige IBAN.');
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 99999999999) throw new Error('Ungültiger Betrag.');
  return [
    'BCD', '002', '1', 'SCT',
    String(bic ?? '').replace(/\s/g, '').toUpperCase(),
    cleanName.slice(0, 70),
    cleanIBAN(iban),
    `EUR${dec(amountCents)}`,
    '', // Zweck-Code
    '', // strukturierte Referenz
    String(reference ?? '').slice(0, 140),
  ].join('\n');
}

// ---------- Adressen ----------
export const formatAddress = (a = {}) =>
  [a.street, [a.zip, a.city].filter(Boolean).join(' '), a.country && a.country !== 'DE' ? a.country : '']
    .filter((x) => String(x ?? '').trim()).join('\n');

// ---------- Pflichtangaben ----------
/**
 * Prüft eine Rechnung auf Pflichtangaben (vereinfacht nach § 14 Abs. 4 UStG).
 * Liefert je Fehler das betroffene Feld, damit die Oberfläche genau dieses Feld markieren kann.
 * Felder unter `company.` liegen in den Einstellungen, alle anderen in der Rechnung.
 */
export function validateInvoiceFields(inv, settings = {}) {
  const errors = [];
  const c = settings.company ?? {};
  const k = inv.customer ?? {};
  const require = (field, value, message) => { if (!String(value ?? '').trim()) errors.push({ field, message }); };

  require('company.name', c.name, 'Bitte Name oder Firma angeben.');
  require('company.street', c.street, 'Bitte Straße und Hausnummer angeben.');
  require('company.zip', c.zip, 'Bitte die Postleitzahl angeben.');
  require('company.city', c.city, 'Bitte den Ort angeben.');
  if (!String(c.taxId ?? '').trim() && !String(c.vatId ?? '').trim()) {
    errors.push({ field: 'company.taxId', message: 'Bitte Steuernummer oder USt-IdNr. angeben.' });
  }
  if (c.iban && !isValidIBAN(c.iban)) errors.push({ field: 'company.iban', message: 'Diese IBAN ist ungültig – bitte prüfen.' });

  require('customer.name', k.name, 'Bitte Name oder Firma des Kunden angeben.');
  require('customer.street', k.street, 'Bitte Straße und Hausnummer des Kunden angeben.');
  require('customer.zip', k.zip, 'Bitte die Postleitzahl des Kunden angeben.');
  require('customer.city', k.city, 'Bitte den Ort des Kunden angeben.');
  require('number', inv.number, 'Bitte eine Rechnungsnummer angeben.');
  require('date', inv.date, 'Bitte das Rechnungsdatum angeben.');
  if (inv.paymentDays === 'custom') require('dueDate', inv.dueDate, 'Bitte ein Fälligkeitsdatum wählen.');
  if (inv.serviceFrom && inv.serviceTo && inv.serviceTo < inv.serviceFrom) {
    errors.push({ field: 'serviceTo', message: 'Das Enddatum liegt vor dem Anfangsdatum.' });
  }

  if (!inv.items?.length) errors.push({ field: 'items', message: 'Bitte mindestens eine Leistung hinzufügen.' });
  inv.items?.forEach((item, i) => {
    require(`items.${i}.description`, item.description, `Leistung ${i + 1}: Titel fehlt.`);
    try {
      if (toQuantity(item.quantity) === 0) errors.push({ field: `items.${i}.quantity`, message: `Leistung ${i + 1}: Menge muss größer 0 sein.` });
    } catch {
      errors.push({ field: `items.${i}.quantity`, message: `Leistung ${i + 1}: Menge ist keine gültige Zahl.` });
    }
    try {
      toCents(item.unitPrice);
      if (String(item.unitPrice ?? '').trim() === '') errors.push({ field: `items.${i}.unitPrice`, message: `Leistung ${i + 1}: Preis fehlt.` });
    } catch {
      errors.push({ field: `items.${i}.unitPrice`, message: `Leistung ${i + 1}: Preis ist kein gültiger Betrag.` });
    }
    try { discountCents(lineBase(item), item.discount); } catch {
      errors.push({ field: `items.${i}.discount`, message: `Leistung ${i + 1}: Rabatt ist ungültig.` });
    }
  });
  try { discountCents(1, inv.discount); } catch { errors.push({ field: 'discount', message: 'Der Gesamtrabatt ist ungültig.' }); }
  return errors;
}

/** Kurzform: nur die Fehlermeldungen. */
export const validateInvoice = (inv, settings) => validateInvoiceFields(inv, settings).map((e) => e.message);

/** Zusätzliche Angaben, die eine E-Rechnung nach XRechnung braucht. */
export function validateXRechnungFields(inv, settings = {}) {
  const errors = validateInvoiceFields(inv, settings);
  const c = settings.company ?? {};
  const add = (field, ok, message) => { if (!ok) errors.push({ field, message }); };
  add('company.email', /\S+@\S+\.\S+/.test(c.email ?? ''), 'Für die E-Rechnung wird deine E-Mail-Adresse benötigt.');
  add('company.phone', String(c.phone ?? '').trim().length >= 3, 'Für die E-Rechnung wird deine Telefonnummer benötigt.');
  add('company.iban', isValidIBAN(c.iban), 'Für die E-Rechnung wird eine gültige IBAN benötigt.');
  add('customer.email', /\S+@\S+\.\S+/.test(inv.customer?.email ?? ''), 'Für die E-Rechnung wird die E-Mail-Adresse des Kunden benötigt.');
  return errors.filter((e, i, all) => all.findIndex((x) => x.field === e.field) === i);
}

// ---------- E-Rechnung (XRechnung 3.0, UBL) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
const amt = (cents) => `currencyID="EUR">${dec(cents)}`;

function taxCategory(rate, kleinunternehmer, withReason = false, tag = 'cac:TaxCategory') {
  const id = kleinunternehmer ? 'E' : rate === 0 ? 'Z' : 'S';
  const reason = withReason && id === 'E' ? `<cbc:TaxExemptionReason>Kleinunternehmer gemäß § 19 UStG</cbc:TaxExemptionReason>` : '';
  return `<${tag}><cbc:ID>${id}</cbc:ID><cbc:Percent>${rate}</cbc:Percent>${reason}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></${tag}>`;
}

function postalAddress(a) {
  return `<cac:PostalAddress><cbc:StreetName>${esc(a.street)}</cbc:StreetName><cbc:CityName>${esc(a.city)}</cbc:CityName>`
    + `<cbc:PostalZone>${esc(a.zip)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${esc(a.country || 'DE')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
}

/**
 * Erzeugt eine E-Rechnung im Format XRechnung 3.0 (Syntax UBL 2.1).
 * Wirft einen Fehler, wenn Pflichtangaben fehlen.
 */
export function toXRechnung(inv, settings) {
  const errors = validateXRechnungFields(inv, settings);
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
  const c = settings.company;
  const k = inv.customer;
  const ku = Boolean(settings.kleinunternehmer);
  const totals = calculateTotals(inv.items, { kleinunternehmer: ku, discount: inv.discount });
  const due = dueDate(inv);
  const skonto = skontoInfo(totals.gross, inv.date, inv.skonto);

  const terms = [
    due ? `Zahlbar ohne Abzug bis ${due.split('-').reverse().join('.')}.` : '',
    skonto ? `#SKONTO#TAGE=${skonto.days}#PROZENT=${skonto.percent.toFixed(2)}#\n` : '',
  ].filter(Boolean).join('\n');

  const sellerTax = [
    c.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(c.vatId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '',
    c.taxId ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(c.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '',
  ].join('');

  const docAllowances = totals.breakdown.filter((b) => b.discount > 0).map((b) =>
    `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>`
    + `<cbc:Amount ${amt(b.discount)}</cbc:Amount>${taxCategory(b.rate, ku)}</cac:AllowanceCharge>`).join('');

  const subtotals = totals.breakdown.map((b) =>
    `<cac:TaxSubtotal><cbc:TaxableAmount ${amt(b.base)}</cbc:TaxableAmount><cbc:TaxAmount ${amt(b.amount)}</cbc:TaxAmount>`
    + `${taxCategory(b.rate, ku, true)}</cac:TaxSubtotal>`).join('');

  const lines = inv.items.map((item, i) => {
    const l = totals.lines[i];
    const allowance = l.discount > 0
      ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason><cbc:Amount ${amt(l.discount)}</cbc:Amount></cac:AllowanceCharge>`
      : '';
    return `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID>`
      + `<cbc:InvoicedQuantity unitCode="${esc(item.unit || 'C62')}">${toQuantity(item.quantity)}</cbc:InvoicedQuantity>`
      + `<cbc:LineExtensionAmount ${amt(l.net)}</cbc:LineExtensionAmount>${allowance}`
      + `<cac:Item>${item.details ? `<cbc:Description>${esc(item.details)}</cbc:Description>` : ''}<cbc:Name>${esc(item.description)}</cbc:Name>`
      + `${taxCategory(l.rate, ku, false, 'cac:ClassifiedTaxCategory')}</cac:Item>`
      + `<cac:Price><cbc:PriceAmount ${amt(toCents(item.unitPrice))}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
  }).join('');

  const period = inv.serviceFrom
    ? `<cac:InvoicePeriod><cbc:StartDate>${inv.serviceFrom}</cbc:StartDate><cbc:EndDate>${inv.serviceTo || inv.serviceFrom}</cbc:EndDate></cac:InvoicePeriod>`
    : '';
  const delivery = inv.serviceFrom ? '' : `<cac:Delivery><cbc:ActualDeliveryDate>${inv.date}</cbc:ActualDeliveryDate></cac:Delivery>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${esc(inv.number)}</cbc:ID>
<cbc:IssueDate>${inv.date}</cbc:IssueDate>
${due ? `<cbc:DueDate>${due}</cbc:DueDate>` : ''}
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
${ku ? `<cbc:Note>${esc(KLEINUNTERNEHMER_HINWEIS)}</cbc:Note>` : ''}
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cbc:BuyerReference>${esc(k.reference || inv.number)}</cbc:BuyerReference>
${period}
<cac:AccountingSupplierParty><cac:Party>
<cbc:EndpointID schemeID="EM">${esc(c.email)}</cbc:EndpointID>
${postalAddress(c)}
${sellerTax}
<cac:PartyLegalEntity><cbc:RegistrationName>${esc(c.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
<cac:Contact><cbc:Name>${esc(c.contact || c.name)}</cbc:Name><cbc:Telephone>${esc(c.phone)}</cbc:Telephone><cbc:ElectronicMail>${esc(c.email)}</cbc:ElectronicMail></cac:Contact>
</cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party>
<cbc:EndpointID schemeID="EM">${esc(k.email)}</cbc:EndpointID>
${postalAddress(k)}
<cac:PartyLegalEntity><cbc:RegistrationName>${esc(k.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
</cac:Party></cac:AccountingCustomerParty>
${delivery}
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>${esc(inv.number)}</cbc:PaymentID>
<cac:PayeeFinancialAccount><cbc:ID>${cleanIBAN(c.iban)}</cbc:ID><cbc:Name>${esc(c.name)}</cbc:Name>${c.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(c.bic.replace(/\s/g, '').toUpperCase())}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount>
</cac:PaymentMeans>
${terms ? `<cac:PaymentTerms><cbc:Note>${esc(terms)}</cbc:Note></cac:PaymentTerms>` : ''}
${docAllowances}
<cac:TaxTotal><cbc:TaxAmount ${amt(totals.tax)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>
<cac:LegalMonetaryTotal>
<cbc:LineExtensionAmount ${amt(totals.subtotal)}</cbc:LineExtensionAmount>
<cbc:TaxExclusiveAmount ${amt(totals.net)}</cbc:TaxExclusiveAmount>
<cbc:TaxInclusiveAmount ${amt(totals.gross)}</cbc:TaxInclusiveAmount>
${totals.discount > 0 ? `<cbc:AllowanceTotalAmount ${amt(totals.discount)}</cbc:AllowanceTotalAmount>` : ''}
<cbc:PayableAmount ${amt(totals.gross)}</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
${lines}
</ubl:Invoice>
`.replace(/\n{2,}/g, '\n');
}
