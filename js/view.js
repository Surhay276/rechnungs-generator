/**
 * Inhalt der Rechnung, fertig formatiert: ohne DOM.
 * Die Vorschau im Browser und das PDF bauen beide auf diesem Modell auf: So steht im PDF
 * garantiert dasselbe wie in der Vorschau.
 */
import {
  toPriceUnits, toQuantityUnits, toCents, formatMoney, formatPrice, formatQuantity, unitLabel, dueDate, servicePeriod, skontoInfo,
  isValidIBAN, epcPayload, formatAddress, formatIBAN, formatDate, kindOf, legalInfo, taxInEUR, centsInEUR, KLEINUNTERNEHMER_HINWEIS, RETENTION_NOTICE, LEGAL_FORMS,
} from './invoice.js?v=27';
import { invoiceTheme } from './color.js?v=27';
import { qrcode } from './vendor/qrcode.mjs';
import { stringToBytes as utf8Bytes } from './vendor/qrcode_UTF8.mjs';

qrcode.stringToBytes = utf8Bytes; // GiroCode verlangt UTF-8 (Umlaute im Namen)

export { formatDate };
const decimal = (value) => String(value).replace('.', ',');

/** QR-Code als Raster (true = dunkles Modul). */
export function qrModules(payload) {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => qr.isDark(r, c)));
}

/**
 * Dateiname nur aus ASCII-Zeichen („Bäckerei“ → „Baeckerei“): Umlaute im Download-Namen verwerfen manche
 * Browser/Systeme und speichern dann nur „download“. Zeichen, die Windows oder macOS stören, fliegen raus.
 */
export const pdfFileName = (inv) => [inv.number, inv.customer?.name].filter(Boolean).join(' ')
  .replace(/[äöüÄÖÜß]/g, (ch) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }[ch]))
  .replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Rechnung';

/** Hinweise zur Steuer (§ 14 Abs. 4 Nr. 8, § 14a UStG): je Steuerart einmal. */
function taxNotes(inv, totals, ku) {
  if (ku) return [KLEINUNTERNEHMER_HINWEIS];
  if (!totals) return [];
  return [...new Set(totals.breakdown.flatMap((b) => [...b.notes, b.types.includes('E') ? inv.exemptionReason || 'Steuerfreie Leistung nach § 4 UStG.' : null]).filter(Boolean))];
}

/**
 * @param inv       Rechnung
 * @param s         Einstellungen (bei abgeschlossenen Rechnungen die eingefrorenen)
 * @param totals    Ergebnis von invoiceTotals/calculateTotals oder null bei ungültigen Eingaben
 * @param design    { color, head }
 */
export function buildInvoiceView(inv, s, totals, design) {
  const c = s.company ?? {};
  const k = inv.customer ?? {};
  const ku = Boolean(s.kleinunternehmer);
  const kind = kindOf(inv);
  const storno = kind.key === 'storno';
  const sign = storno ? -1 : 1; // Stornorechnungen zeigen negative Beträge
  const currency = inv.currency || 'EUR';
  const money = (cents) => formatMoney(sign * cents, currency);
  const gross = Boolean(totals?.pricesGross ?? inv.pricesGross);
  const due = storno ? null : dueDate(inv);
  const period = servicePeriod(inv);
  const payable = totals?.payable ?? 0;
  const skonto = totals && !storno ? skontoInfo(payable, inv.date, inv.skonto) : null;

  // ---------- Rechnungsdaten rechts oben ----------
  const serviceLabel = period?.mode === 'period' ? 'Leistungszeitraum' : 'Leistungsdatum';
  const serviceValue = !period ? '-' : period.from === period.to ? formatDate(period.from) : `${formatDate(period.from)} bis ${formatDate(period.to)}`;
  const meta = [
    [storno ? 'Stornonummer' : 'Rechnungsnummer', inv.number || '-'],
    ['Rechnungsdatum', formatDate(inv.date) || '-'],
    storno && inv.reference?.number && ['Zu Rechnung', `${inv.reference.number}${inv.reference.date ? ` vom ${formatDate(inv.reference.date)}` : ''}`],
    [serviceLabel, serviceValue],
    due && ['Fällig am', formatDate(due)],
    k.vatId && ['Ihre USt-IdNr.', k.vatId],
    k.reference && [k.isPublic || /^\d{2,12}-/.test(k.reference) ? 'Leitweg-ID' : 'Ihre Referenz', k.reference],
    currency !== 'EUR' && ['Währung', `${currency}${inv.fxRate ? ` (1 ${currency} = ${decimal(inv.fxRate)} EUR${inv.fxDate ? `, EZB ${formatDate(inv.fxDate)}` : ''})` : ''}`],
  ].filter(Boolean);

  // ---------- Positionen ----------
  const rows = inv.items.map((item, i) => {
    const line = totals?.lines[i];
    let price = '-';
    let quantity = String(item.quantity ?? '');
    try { price = formatPrice(sign * toPriceUnits(item.unitPrice), currency); } catch { /* ungültig */ }
    try { quantity = formatQuantity(toQuantityUnits(item.quantity)); } catch { /* ungültig */ }
    const discount = line?.shown.discount
      ? `abzgl. ${item.discount.type === 'percent' ? `${decimal(item.discount.value)} % ` : ''}Rabatt (−${formatMoney(Math.abs(line.shown.discount), currency)})`
      : '';
    return {
      pos: String(i + 1),
      description: item.description || '-',
      details: [item.details, discount].filter(Boolean),
      quantity: `${quantity} ${unitLabel(item.unit)}`.trim(),
      price,
      tax: line?.type.short ?? '',
      total: line ? money(line.shown.total) : '-',
    };
  });

  // ---------- Summen ----------
  let sums = null;
  if (totals) {
    const withPrepaid = totals.prepaid > 0;
    sums = [
      totals.shown.discount !== 0 && { label: `Zwischensumme${gross ? ' (brutto)' : ''}`, value: money(totals.shown.subtotal) },
      totals.shown.discount !== 0 && { label: `Rabatt${inv.discount?.type === 'percent' ? ` (${decimal(inv.discount.value)} %)` : ''}${gross ? ' (brutto)' : ''}`, value: money(-totals.shown.discount) },
      { label: 'Nettobetrag', value: money(totals.net) },
      ...totals.taxes.map((t) => ({ label: `USt ${t.rate} % auf ${money(t.base)}`, value: money(t.amount) })),
      currency !== 'EUR' && totals.tax !== 0 && inv.fxRate && { label: 'Umsatzsteuer in EUR', value: formatMoney(sign * safe(() => taxInEUR(totals.tax, inv.fxRate)), 'EUR') },
      totals.rounding !== 0 && { label: 'Rundungsdifferenz', value: money(totals.rounding) },
      { label: storno ? 'Stornobetrag' : 'Rechnungsbetrag', value: money(totals.total), grand: !withPrepaid },
      ...(withPrepaid ? (inv.prepayments ?? []).map((p) => ({
        label: `abzgl. Abschlag ${p.number} vom ${formatDate(p.date)}${safe(() => toCents(p.tax)) ? ` (darin USt ${formatMoney(toCents(p.tax), currency)})` : ''}`,
        value: formatMoney(-safe(() => toCents(p.gross)), currency),
      })) : []),
      withPrepaid && { label: 'Noch zu zahlen', value: money(payable), grand: true },
    ].filter(Boolean);
  }

  // ---------- Zahlung ----------
  const payTexts = [];
  if (totals) {
    if (storno) payTexts.push(`Der Betrag von ${formatMoney(totals.total, currency)} wird mit offenen Forderungen verrechnet oder Ihnen erstattet.`);
    else if (payable > 0) {
      payTexts.push(!due || due === inv.date
        ? `Bitte überweisen Sie den Betrag von ${money(payable)} sofort unter Angabe der Rechnungsnummer ${inv.number}.`
        : `Bitte überweisen Sie den Betrag von ${money(payable)} bis zum ${formatDate(due)} unter Angabe der Rechnungsnummer ${inv.number}.`);
    } else if (kind.key === 'final' && payable === 0) payTexts.push('Der Rechnungsbetrag ist durch die Abschlagszahlungen vollständig beglichen.');
  }
  if (skonto?.until) {
    payTexts.push(`Bei Zahlung bis zum ${formatDate(skonto.until)} gewähren wir ${decimal(skonto.percent)} % Skonto (${money(skonto.amount)}). Zu zahlen sind dann ${money(skonto.payable)}.`
      + `${totals.tax > 0 ? ' Entgelt und Umsatzsteuer mindern sich entsprechend.' : ''}`);
  }

  // GiroCode (EPC-QR) kennt nur Euro: Bei Fremdwährung enthält er den zum Rechnungskurs umgerechneten Euro-Betrag.
  let qr = null;
  let qrMissing = null;
  let qrCaption = 'Jetzt mit dem Smartphone scannen';
  const euroPayable = currency === 'EUR' ? payable : safe(() => centsInEUR(payable, inv.fxRate));
  if (inv.giroCode && !storno && payable > 0 && euroPayable > 0) {
    if (isValidIBAN(c.iban) && c.name) {
      try { qr = qrModules(epcPayload({ name: c.name, iban: c.iban, bic: c.bic, amountCents: euroPayable, reference: inv.number })); } catch { qr = null; }
      if (qr && currency !== 'EUR') {
        qrCaption = `Scannen und ${formatMoney(euroPayable, 'EUR')} zahlen`;
        payTexts.push(`Per GiroCode zahlen Sie den umgerechneten Betrag von ${formatMoney(euroPayable, 'EUR')} (1 ${currency} = ${decimal(inv.fxRate)} EUR).`);
      }
    } else if (!isValidIBAN(c.iban)) {
      qrMissing = { invalid: Boolean(c.iban) }; // nur am Bildschirm, nie im PDF
    }
  }

  // ---------- Fußzeile ----------
  const form = LEGAL_FORMS[c.legalForm];
  const legal = legalInfo(c) ? [
    c.city && form?.register && `Sitz: ${c.city}`,
    c.registerCourt && c.registerNumber && `${c.registerCourt}, ${c.registerNumber}`,
    form?.officers && c.officers && `${form.officersLabel}: ${c.officers}`,
  ].filter(Boolean) : [];

  return {
    number: inv.number,
    kind: kind.key,
    fileName: pdfFileName(inv),
    theme: invoiceTheme(design.color),
    headStyle: design.head === 'light' ? 'light' : 'filled',
    title: kind.title,
    logo: c.logo || null,
    brand: c.name || 'Dein Unternehmen',
    companyName: c.name || '',
    sender: [c.name, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    recipient: { name: k.name || 'Kunde', address: formatAddress(k) },
    meta,
    intro: inv.intro || '',
    showTax: !ku,
    priceHead: 'Einzelpreis',
    totalHead: 'Betrag',
    rows,
    sums,
    notes: [gross && !ku && 'Alle Einzelpreise und Beträge der Positionen enthalten die Umsatzsteuer.', ...taxNotes(inv, totals, ku), inv.retentionNotice && RETENTION_NOTICE].filter(Boolean),
    payTexts,
    qr,
    qrCaption,
    qrMissing,
    note: inv.note || '',
    footer: [
      [c.name && { text: c.name, bold: true }, ...formatAddress(c).split('\n').filter(Boolean).map((text) => ({ text })), ...legal.map((text) => ({ text }))].filter(Boolean),
      [c.phone && `Tel. ${c.phone}`, c.email, c.taxId && `Steuernr. ${c.taxId}`, c.vatId && `USt-IdNr. ${c.vatId}`].filter(Boolean).map((text) => ({ text })),
      [c.bank, c.iban && `IBAN ${formatIBAN(c.iban)}`, c.bic && `BIC ${c.bic}`].filter(Boolean).map((text) => ({ text })),
    ],
  };
}

function safe(fn) {
  try { return fn(); } catch { return 0; }
}
