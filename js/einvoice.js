/**
 * E-Rechnung nach EN 16931 in der Syntax UN/CEFACT CII (Cross Industry Invoice D16B).
 *
 * Eine Quelle für zwei Formate:
 * - XRechnung 3.0 (profile „xrechnung“): als eigene XML-Datei, z. B. für Behörden
 * - ZUGFeRD 2 / Factur-X, Profil EN 16931 (profile „en16931“): eingebettet ins PDF/A-3
 */
import { centsToDecimal, formatQuantity, toQuantityUnits, toPriceUnits, parseScaled, roundDiv, scaledToString, QUANTITY_SCALE } from './money.js?v=28';
import { invoiceTotals, skontoInfo } from './calc.js?v=28';
import { dueDate, servicePeriod, formatDate } from './dates.js?v=28';
import { kindOf, KLEINUNTERNEHMER_HINWEIS, RETENTION_NOTICE, TAX_TYPES, LEGAL_FORMS } from './tax.js?v=28';
import { cleanIBAN, cleanVatId, isValidIBAN } from './checks.js?v=28';
import { validateXRechnungFields, validateInvoiceFields } from './validate.js?v=28';

export const PROFILES = Object.freeze({
  xrechnung: {
    guideline: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    process: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    validate: validateXRechnungFields,
  },
  en16931: { guideline: 'urn:cen.eu:en16931:2017', process: null, validate: validateInvoiceFields },
});

/**
 * Text für XML: Sonderzeichen maskieren und Zeichen entfernen, die XML 1.0 nicht erlaubt
 * (Steuerzeichen aus kopierten Word-/PDF-Texten, einzelne Surrogate).
 */
export function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}
const esc = xmlText;
const d102 = (iso) => String(iso).replace(/-/g, '');
const dateEl = (tag, iso, ns = 'udt') => `<ram:${tag}><${ns}:DateTimeString format="102">${d102(iso)}</${ns}:DateTimeString></ram:${tag}>`;
const tag = (name, value) => (value === '' || value === null || value === undefined ? '' : `<ram:${name}>${esc(value)}</ram:${name}>`);
const indicator = (v) => `<ram:ChargeIndicator><udt:Indicator>${v}</udt:Indicator></ram:ChargeIndicator>`;

/** Rechtliche Zusatzangaben des Verkäufers (BT-33): Rechtsform, Sitz, Register, Vertretung. */
export function legalInfo(c = {}) {
  const form = LEGAL_FORMS[c.legalForm];
  if (!form || (!form.register && !form.officers)) return '';
  return [
    form.label && `Rechtsform: ${form.label}`,
    c.city && `Sitz: ${c.city}`,
    c.registerCourt && `Registergericht: ${c.registerCourt}`,
    c.registerNumber && `Registernummer: ${c.registerNumber}`,
    form.officers && c.officers && `${form.officersLabel}: ${c.officers}`,
  ].filter(Boolean).join(', ');
}

/** Befreiungsgrund einer Steuer-Aufstellung (BT-120/121). */
function exemption(group, inv, ku) {
  if (!['E', 'AE', 'K', 'G'].includes(group.category)) return {};
  if (ku) return { text: KLEINUNTERNEHMER_HINWEIS };
  if (group.types.includes('M')) return { text: TAX_TYPES.M.note, code: TAX_TYPES.M.code };
  if (group.types.includes('E')) return { text: inv.exemptionReason || 'Steuerfreie Leistung nach § 4 UStG.' };
  const type = TAX_TYPES[group.types[0]];
  return { text: type.note, code: type.code };
}

/** Betrag in Euro umrechnen (Kurs = Euro je Einheit der Fremdwährung, bis zu 6 Nachkommastellen). */
export function centsInEUR(cents, fxRate) {
  return Number(roundDiv(BigInt(cents) * parseScaled(fxRate, 6, 'Kurs'), 1_000_000n));
}
/** Umsatzsteuer in Euro bei Fremdwährungsrechnungen (§ 16 Abs. 6 UStG, BT-111). */
export const taxInEUR = centsInEUR;

function address(a) {
  return `<ram:PostalTradeAddress>${tag('PostcodeCode', a.zip)}${tag('LineOne', a.street)}${tag('CityName', a.city)}`
    + `<ram:CountryID>${esc(String(a.country || 'DE').toUpperCase())}</ram:CountryID></ram:PostalTradeAddress>`;
}
const email = (value) => (value ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(value)}</ram:URIID></ram:URIUniversalCommunication>` : '');
const taxRegistration = (scheme, id) => (id ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="${scheme}">${esc(id)}</ram:ID></ram:SpecifiedTaxRegistration>` : '');
const tradeTax = (category, rate, element = 'ApplicableTradeTax') => `<ram:${element}><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category}</ram:CategoryCode><ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent></ram:${element}>`;

/**
 * Erzeugt die E-Rechnung als XML-Text. Wirft einen Fehler mit allen fehlenden Angaben.
 * @param profile „xrechnung“ oder „en16931“ (ZUGFeRD)
 */
export function toCII(inv, settings, { profile = 'xrechnung', context = {} } = {}) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`Unbekanntes Profil: ${profile}`);
  const errors = p.validate(inv, settings, context);
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));

  const c = settings.company;
  const k = inv.customer;
  const ku = Boolean(settings.kleinunternehmer);
  const kind = kindOf(inv);
  const storno = kind.key === 'storno';
  const currency = inv.currency || 'EUR';
  const t = invoiceTotals(inv, settings);
  const amt = (cents) => centsToDecimal(cents);
  const due = storno ? null : dueDate(inv);
  const skonto = storno ? null : skontoInfo(t.payable, inv.date, inv.skonto);
  const period = servicePeriod(inv);

  // ---------- Hinweise (BT-21/22) ----------
  const notes = [
    ku && KLEINUNTERNEHMER_HINWEIS,
    kind.key === 'final' && inv.prepayments?.length && `Abschlagsrechnungen: ${inv.prepayments.map((x) => `${x.number} vom ${formatDate(x.date)}`).join(', ')}`,
    inv.retentionNotice && RETENTION_NOTICE,
  ].filter(Boolean).map((text) => `<ram:IncludedNote><ram:Content>${esc(text)}</ram:Content></ram:IncludedNote>`).join('');

  // ---------- Positionen ----------
  const lines = inv.items.map((item, i) => {
    const l = t.lines[i];
    const qtyUnits = toQuantityUnits(item.quantity);
    const negative = l.base < 0; // BR-27: Preis nie negativ → negative Positionen über die Menge
    const priceUnits = t.pricesGross
      ? Number(roundDiv(BigInt(Math.abs(l.base)) * 100n * BigInt(QUANTITY_SCALE), BigInt(qtyUnits)))
      : Math.abs(toPriceUnits(item.unitPrice));
    const allowance = l.discount !== 0
      ? `<ram:SpecifiedTradeAllowanceCharge>${indicator(false)}<ram:ActualAmount>${amt(l.discount)}</ram:ActualAmount><ram:Reason>Rabatt</ram:Reason></ram:SpecifiedTradeAllowanceCharge>`
      : '';
    return '<ram:IncludedSupplyChainTradeLineItem>'
      + `<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>`
      + `<ram:SpecifiedTradeProduct>${tag('Name', item.description)}${tag('Description', item.details)}</ram:SpecifiedTradeProduct>`
      + `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${scaledToString(priceUnits, 4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`
      + `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(item.unit || 'C62')}">${negative ? '-' : ''}${formatQuantity(qtyUnits, { comma: false })}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`
      + `<ram:SpecifiedLineTradeSettlement>${tradeTax(l.type.category, l.rate)}${allowance}`
      + `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>`
      + '</ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>';
  }).join('');

  // ---------- Verkäufer & Käufer ----------
  const sellerId = !c.vatId && c.taxId ? `<ram:ID>${esc(c.taxId)}</ram:ID>` : ''; // BR-CO-26 ohne USt-IdNr.
  const info = legalInfo(c);
  const contact = (c.contact || c.phone || c.email)
    ? `<ram:DefinedTradeContact>${tag('PersonName', c.contact || c.name)}`
      + `${c.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(c.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}`
      + `${c.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${esc(c.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>`
    : '';
  const seller = `<ram:SellerTradeParty>${sellerId}${tag('Name', c.name)}${tag('Description', info)}`
    + `${c.registerNumber && info ? `<ram:SpecifiedLegalOrganization><ram:ID>${esc(c.registerNumber)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}`
    + `${contact}${address({ ...c, country: c.country || 'DE' })}${email(c.email)}`
    + `${taxRegistration('VA', c.vatId && cleanVatId(c.vatId))}${taxRegistration('FC', c.taxId)}</ram:SellerTradeParty>`;
  const buyer = `<ram:BuyerTradeParty>${tag('Name', k.name)}${address(k)}${email(k.email)}${taxRegistration('VA', k.vatId && cleanVatId(k.vatId))}</ram:BuyerTradeParty>`;

  // ---------- Lieferung ----------
  const hasK = t.breakdown.some((b) => b.category === 'K');
  const shipTo = hasK ? `<ram:ShipToTradeParty>${tag('Name', k.name)}${address(k)}</ram:ShipToTradeParty>` : '';
  const delivery = period && period.mode !== 'period'
    ? `<ram:ActualDeliverySupplyChainEvent>${dateEl('OccurrenceDateTime', period.from)}</ram:ActualDeliverySupplyChainEvent>` : '';

  // ---------- Abrechnung ----------
  const payment = storno || !isValidIBAN(c.iban)
    ? (profile === 'xrechnung' || storno ? '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>' : '')
    : '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>'
      + `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${cleanIBAN(c.iban)}</ram:IBANID>${tag('AccountName', c.name)}</ram:PayeePartyCreditorFinancialAccount>`
      + `${c.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(c.bic.replace(/\s/g, '').toUpperCase())}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}`
      + '</ram:SpecifiedTradeSettlementPaymentMeans>';

  const taxes = t.breakdown.map((b) => {
    const ex = exemption(b, inv, ku);
    return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(b.amount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${tag('ExemptionReason', ex.text)}`
      + `<ram:BasisAmount>${amt(b.base)}</ram:BasisAmount><ram:CategoryCode>${b.category}</ram:CategoryCode>${tag('ExemptionReasonCode', ex.code)}`
      + `<ram:RateApplicablePercent>${b.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
  }).join('');

  const billingPeriod = period?.mode === 'period'
    ? `<ram:BillingSpecifiedPeriod>${dateEl('StartDateTime', period.from)}${dateEl('EndDateTime', period.to)}</ram:BillingSpecifiedPeriod>` : '';

  const allowances = t.breakdown.filter((b) => b.discount !== 0).map((b) => `<ram:SpecifiedTradeAllowanceCharge>${indicator(false)}`
    + `<ram:ActualAmount>${amt(b.discount)}</ram:ActualAmount><ram:Reason>Rabatt</ram:Reason>${tradeTax(b.category, b.rate, 'CategoryTradeTax')}</ram:SpecifiedTradeAllowanceCharge>`).join('');

  const termsText = [
    storno && 'Der Betrag wird verrechnet oder erstattet.',
    due && `Zahlbar ohne Abzug bis ${formatDate(due)}.`,
    skonto && `#SKONTO#TAGE=${skonto.days}#PROZENT=${skonto.percent.toFixed(2)}#${t.prepaid ? `BASISBETRAG=${amt(t.payable)}#` : ''}\n`,
  ].filter(Boolean).join('\n');
  const terms = termsText || due
    ? `<ram:SpecifiedTradePaymentTerms>${tag('Description', termsText)}${due ? dateEl('DueDateDateTime', due) : ''}</ram:SpecifiedTradePaymentTerms>` : '';

  const foreign = currency !== 'EUR';
  const sums = '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>'
    + `<ram:LineTotalAmount>${amt(t.subtotal)}</ram:LineTotalAmount>`
    + `${t.discount ? `<ram:AllowanceTotalAmount>${amt(t.discount)}</ram:AllowanceTotalAmount>` : ''}`
    + `<ram:TaxBasisTotalAmount>${amt(t.net)}</ram:TaxBasisTotalAmount>`
    + `<ram:TaxTotalAmount currencyID="${currency}">${amt(t.tax)}</ram:TaxTotalAmount>`
    + `${foreign ? `<ram:TaxTotalAmount currencyID="EUR">${amt(taxInEUR(t.tax, inv.fxRate))}</ram:TaxTotalAmount>` : ''}`
    + `${t.rounding ? `<ram:RoundingAmount>${amt(t.rounding)}</ram:RoundingAmount>` : ''}`
    + `<ram:GrandTotalAmount>${amt(t.gross)}</ram:GrandTotalAmount>`
    + `${t.prepaid ? `<ram:TotalPrepaidAmount>${amt(t.prepaid)}</ram:TotalPrepaidAmount>` : ''}`
    + `<ram:DuePayableAmount>${amt(t.payable)}</ram:DuePayableAmount>`
    + '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>';

  const referenced = storno
    ? `<ram:InvoiceReferencedDocument>${tag('IssuerAssignedID', inv.reference.number)}${dateEl('FormattedIssueDateTime', inv.reference.date, 'qdt')}</ram:InvoiceReferencedDocument>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>${p.process ? `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${p.process}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>` : ''}<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${p.guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${esc(inv.number)}</ram:ID><ram:TypeCode>${kind.code}</ram:TypeCode>${dateEl('IssueDateTime', inv.date)}${notes}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lines}
<ram:ApplicableHeaderTradeAgreement>${tag('BuyerReference', k.reference || inv.number)}
${seller}
${buyer}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${shipTo}${delivery}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>${storno ? '' : tag('PaymentReference', inv.number)}${foreign ? '<ram:TaxCurrencyCode>EUR</ram:TaxCurrencyCode>' : ''}<ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
${payment}
${taxes}
${billingPeriod}${allowances}${terms}
${sums}
${referenced}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n{2,}/g, '\n');
}

/** E-Rechnung im Format XRechnung 3.0 (CII). */
export const toXRechnung = (inv, settings, context) => toCII(inv, settings, { profile: 'xrechnung', context });
