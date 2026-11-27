/**
 * Inhalt der Rechnung, fertig formatiert – ohne DOM.
 * Die Vorschau im Browser und das PDF bauen beide auf diesem Modell auf: So steht im PDF
 * garantiert dasselbe wie in der Vorschau.
 */
import {
  toCents, formatEUR, unitLabel, dueDate, skontoInfo, isValidIBAN, epcPayload, formatAddress, formatIBAN, KLEINUNTERNEHMER_HINWEIS,
} from './invoice.js?v=23';
import { invoiceTheme } from './color.js?v=23';
import { qrcode } from './vendor/qrcode.mjs';
import { stringToBytes as utf8Bytes } from './vendor/qrcode_UTF8.mjs';

qrcode.stringToBytes = utf8Bytes; // GiroCode verlangt UTF-8 (Umlaute im Namen)

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const formatDate = (iso) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '');
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

/**
 * @param inv       Rechnung
 * @param s         Einstellungen (bei abgeschlossenen Rechnungen die eingefrorenen)
 * @param totals    Ergebnis von calculateTotals oder null bei ungültigen Eingaben
 * @param design    { color, head }
 */
export function buildInvoiceView(inv, s, totals, design) {
  const c = s.company ?? {};
  const k = inv.customer ?? {};
  const ku = Boolean(s.kleinunternehmer);
  const due = dueDate(inv);
  const skonto = totals ? skontoInfo(totals.gross, inv.date, inv.skonto) : null;

  const meta = [
    ['Rechnungsnummer', inv.number || '—'],
    ['Rechnungsdatum', formatDate(inv.date) || '—'],
    inv.serviceFrom
      ? ['Leistungszeitraum', inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? `${formatDate(inv.serviceFrom)} – ${formatDate(inv.serviceTo)}` : formatDate(inv.serviceFrom)]
      : ['Leistungsdatum', formatDate(inv.date) || '—'],
    due && ['Fällig am', formatDate(due)],
    k.reference && ['Ihre Referenz', k.reference],
  ].filter(Boolean);

  const rows = inv.items.map((item, i) => {
    const line = totals?.lines[i];
    let price = '–';
    try { price = formatEUR(toCents(item.unitPrice)); } catch { /* ungültig */ }
    const discount = line?.discount
      ? `abzgl. ${item.discount.type === 'percent' ? `${decimal(item.discount.value)} % ` : ''}Rabatt (−${formatEUR(line.discount)})`
      : '';
    return {
      pos: String(i + 1),
      description: item.description || '—',
      details: [item.details, discount].filter(Boolean),
      quantity: `${item.quantity} ${unitLabel(item.unit)}`.trim(),
      price,
      tax: `${item.taxRate} %`,
      total: line ? formatEUR(line.net) : '–',
    };
  });

  const sums = totals
    ? [
      totals.discount > 0 && { label: 'Zwischensumme', value: formatEUR(totals.subtotal) },
      totals.discount > 0 && { label: `Rabatt${inv.discount?.type === 'percent' ? ` (${decimal(inv.discount.value)} %)` : ''}`, value: `−${formatEUR(totals.discount)}` },
      { label: 'Nettobetrag', value: formatEUR(totals.net) },
      ...totals.taxes.map((t) => ({ label: `USt ${t.rate} % auf ${formatEUR(t.base)}`, value: formatEUR(t.amount) })),
      { label: 'Rechnungsbetrag', value: formatEUR(totals.gross), grand: true },
    ].filter(Boolean)
    : null;

  const payTexts = [];
  if (totals && totals.gross > 0) {
    payTexts.push(!due || due === inv.date
      ? `Bitte überweisen Sie den Betrag von ${formatEUR(totals.gross)} sofort unter Angabe der Rechnungsnummer ${inv.number}.`
      : `Bitte überweisen Sie den Betrag von ${formatEUR(totals.gross)} bis zum ${formatDate(due)} unter Angabe der Rechnungsnummer ${inv.number}.`);
  }
  if (skonto?.until) {
    payTexts.push(`Bei Zahlung bis zum ${formatDate(skonto.until)} gewähren wir ${decimal(skonto.percent)} % Skonto (${formatEUR(skonto.amount)}) – zu zahlen sind dann ${formatEUR(skonto.payable)}.`);
  }

  let qr = null;
  let qrMissing = null;
  if (inv.giroCode && totals?.gross > 0) {
    if (isValidIBAN(c.iban) && c.name) {
      try { qr = qrModules(epcPayload({ name: c.name, iban: c.iban, bic: c.bic, amountCents: totals.gross, reference: inv.number })); } catch { qr = null; }
    } else if (!isValidIBAN(c.iban)) {
      qrMissing = { invalid: Boolean(c.iban) }; // nur am Bildschirm, nie im PDF
    }
  }

  return {
    number: inv.number,
    fileName: pdfFileName(inv),
    theme: invoiceTheme(design.color),
    headStyle: design.head === 'light' ? 'light' : 'filled',
    title: 'Rechnung',
    logo: c.logo || null,
    brand: c.name || 'Dein Unternehmen',
    companyName: c.name || '',
    sender: [c.name, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    recipient: { name: k.name || 'Kunde', address: formatAddress(k) },
    meta,
    intro: inv.intro || '',
    showTax: !ku,
    rows,
    sums,
    kuNote: ku ? KLEINUNTERNEHMER_HINWEIS : '',
    payTexts,
    qr,
    qrCaption: 'Jetzt mit dem Smartphone scannen',
    qrMissing,
    note: inv.note || '',
    footer: [
      [c.name && { text: c.name, bold: true }, ...formatAddress(c).split('\n').filter(Boolean).map((text) => ({ text }))].filter(Boolean),
      [c.phone && `Tel. ${c.phone}`, c.email, c.taxId && `Steuernr. ${c.taxId}`, c.vatId && `USt-IdNr. ${c.vatId}`].filter(Boolean).map((text) => ({ text })),
      [c.bank, c.iban && `IBAN ${formatIBAN(c.iban)}`, c.bic && `BIC ${c.bic}`].filter(Boolean).map((text) => ({ text })),
    ],
  };
}
