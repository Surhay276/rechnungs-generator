/**
 * Summen einer Rechnung – centgenau und nach den Rechenregeln der E-Rechnung (EN 16931).
 *
 * - Steuer je Steuerart auf die Summe, nicht je Zeile (keine Rundungsdifferenzen)
 * - Gesamtrabatt anteilig auf die Steuerarten verteilt (Verfahren der größten Reste)
 * - Netto- oder Bruttopreise: Bei Bruttopreisen wird die Steuer aus dem Bruttobetrag herausgerechnet,
 *   der Rechnungsbetrag ist dann genau die Summe der eingegebenen Preise (99,99 € bleiben 99,99 €).
 */
import { toCents, toPriceUnits, toQuantityUnits, toPercent, roundDiv, roundDivInt, isEmptyNumber, LIMITS, PRICE_SCALE } from './money.js?v=25';

const TOO_HIGH = 'Der Rechnungsbetrag ist zu hoch (höchstens knapp 1 Mrd. €).';
import { taxTypeOf } from './tax.js?v=25';
import { addDays, isValidIsoDate } from './dates.js?v=25';

/** Rabattbetrag in Cent für eine Basis – als Prozent oder fester Betrag, nie mehr als die Basis. Vorzeichen folgt der Basis. */
export function discountCents(baseCents, discount) {
  if (!discount || isEmptyNumber(discount.value)) return 0;
  const magnitude = Math.abs(baseCents);
  const raw = discount.type === 'percent'
    ? roundDivInt(BigInt(magnitude) * BigInt(Math.round(toPercent(discount.value) * 10_000)), 1_000_000)
    : toCents(discount.value);
  if (raw < 0) throw new Error('Rabatt darf nicht negativ sein.');
  const amount = Math.sign(baseCents) * Math.min(raw, magnitude);
  return amount === 0 ? 0 : amount;
}

/** Betrag einer Position vor Rabatt: Menge × Einzelpreis, kaufmännisch auf Cent gerundet. */
export function lineBase(item) {
  const qty = BigInt(toQuantityUnits(item.quantity));
  const price = BigInt(toPriceUnits(item.unitPrice));
  const cents = roundDiv(qty * price, (PRICE_SCALE * 10_000) / 100); // 1/10.000 × 1/10.000 → Cent
  if ((cents < 0n ? -cents : cents) > BigInt(LIMITS.totalCents)) throw new Error(TOO_HIGH);
  return Number(cents) || 0;
}

/** Betrag einer Position nach Positionsrabatt (in der Eingabeart: netto oder brutto). */
export function lineNet(item) {
  const base = lineBase(item);
  return base - discountCents(base, item.discount);
}

/**
 * Verteilt einen Betrag proportional auf Anteile – nach dem Verfahren der größten Reste, damit die Summe exakt stimmt.
 * Funktioniert auch mit negativen Anteilen (Gutschriftspositionen).
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
  return result.map((n) => (n === 0 ? 0 : n));
}

/** Steuer aus einem Bruttobetrag herausrechnen. */
const taxFromGross = (gross, rate) => roundDivInt(BigInt(gross) * BigInt(rate), 100 + rate);
/** Netto aus Brutto (für Positionsrabatte bei Bruttopreisen). */
const netFromGrossAmount = (gross, rate) => gross - taxFromGross(gross, rate);
const taxOfNet = (net, rate) => roundDivInt(BigInt(net) * BigInt(rate), 100);

/**
 * Zerlegt einen Bruttobetrag so in Netto + Steuer, dass Steuer = Netto × Satz (gerundet) gilt (EN 16931, BR-CO-17)
 * und Netto + Steuer genau den Bruttobetrag ergibt. Nur wenn das rechnerisch unmöglich ist (z. B. 0,03 € zu 19 %),
 * bleibt ein Rundungsbetrag von einem Cent (BT-114).
 */
export function splitGross(gross, rate) {
  const start = gross - taxFromGross(gross, rate);
  for (const delta of [0, -1, 1, -2, 2]) {
    const net = start + delta;
    if (net + taxOfNet(net, rate) === gross) return { net, tax: gross - net, rounding: 0 };
  }
  const tax = taxOfNet(start, rate);
  return { net: start, tax, rounding: gross - start - tax };
}
/** Reihenfolge der Steuerarten in der Aufstellung: höchster Satz zuerst, dann Kategorie. */
const CATEGORY_ORDER = ['S', 'Z', 'E', 'AE', 'K', 'G', 'O'];

/**
 * Berechnet alle Beträge einer Rechnung (alle Werte in Cent, positiv für normale Rechnungen).
 *
 * lines[i]:   base/discount/net – netto (für die E-Rechnung) · shown – Beträge in Eingabeart (für die Anzeige)
 * breakdown:  je Steuerart: netBefore (vor Gesamtrabatt), discount, base (Bemessungsgrundlage), amount (Steuer)
 * subtotal (BT-106) · discount (BT-107) · net (BT-109) · tax (BT-110) · gross (BT-112) · rounding (BT-114)
 * total (Rechnungsbetrag = gross + rounding) · prepaid (BT-113) · payable (BT-115)
 */
export function calculateTotals(items, { kleinunternehmer = false, discount = null, pricesGross = false, prepaid = 0 } = {}) {
  const lines = items.map((item) => {
    const type = taxTypeOf(item, kleinunternehmer);
    const base = lineBase(item);
    const lineDiscount = discountCents(base, item.discount);
    return { type, rate: type.rate, shown: { base, discount: lineDiscount, total: base - lineDiscount } };
  });

  // Steuerarten mit gleicher Kategorie und gleichem Satz bilden eine Gruppe (EN 16931: eine Aufstellung je Kategorie/Satz)
  const groupKey = (t) => `${t.category}:${t.rate}`;
  const keys = [...new Set(lines.map((l) => groupKey(l.type)))].sort((a, b) => {
    const [ca, ra] = a.split(':');
    const [cb, rb] = b.split(':');
    return Number(rb) - Number(ra) || CATEGORY_ORDER.indexOf(ca) - CATEGORY_ORDER.indexOf(cb);
  });
  const shownSubtotal = lines.reduce((s, l) => s + l.shown.total, 0);
  const shownDiscount = discountCents(shownSubtotal, discount);
  const groupShown = keys.map((k) => lines.filter((l) => groupKey(l.type) === k).reduce((s, l) => s + l.shown.total, 0));
  const groupDiscount = allocate(shownDiscount, groupShown);

  const breakdown = keys.map((key, i) => {
    const groupLines = lines.filter((l) => groupKey(l.type) === key);
    const { type, rate } = groupLines[0];
    const before = groupShown[i];
    const after = before - groupDiscount[i];
    let netBefore; let base; let amount; let rounding = 0;
    if (pricesGross) {
      netBefore = splitGross(before, rate).net;
      ({ net: base, tax: amount, rounding } = splitGross(after, rate));
      // Positionsbeträge netto: Bemessungsgrundlage anteilig auf die Zeilen verteilen, damit die Summe exakt stimmt
      allocate(netBefore, groupLines.map((l) => l.shown.total)).forEach((net, j) => {
        const l = groupLines[j];
        const discountNet = netFromGrossAmount(l.shown.discount, rate);
        Object.assign(l, { net, discount: discountNet, base: net + discountNet });
      });
    } else {
      netBefore = before;
      base = after;
      amount = taxOfNet(base, rate);
      for (const l of groupLines) Object.assign(l, { net: l.shown.total, discount: l.shown.discount, base: l.shown.base });
    }
    const notes = [...new Set(groupLines.map((l) => l.type.note).filter(Boolean))];
    return { key, category: type.category, rate, types: [...new Set(groupLines.map((l) => l.type.key))], notes, netBefore, discount: netBefore - base, base, amount, gross: base + amount, rounding };
  });

  const subtotal = breakdown.reduce((s, b) => s + b.netBefore, 0);
  const totalDiscount = breakdown.reduce((s, b) => s + b.discount, 0);
  const net = subtotal - totalDiscount;
  const tax = breakdown.reduce((s, b) => s + b.amount, 0);
  const gross = net + tax;
  const rounding = breakdown.reduce((s, b) => s + b.rounding, 0);
  if (Math.abs(gross) > LIMITS.totalCents) throw new Error(TOO_HIGH);
  const taxes = breakdown.filter((b) => b.rate > 0).map(({ rate, base, amount }) => ({ rate, base, amount }));
  return {
    lines,
    subtotal,
    discount: totalDiscount,
    net,
    breakdown,
    taxes,
    tax,
    gross,
    rounding,
    total: gross + rounding,
    prepaid,
    payable: gross + rounding - prepaid,
    pricesGross,
    shown: { subtotal: shownSubtotal, discount: shownDiscount },
  };
}

/** Summe der bereits gezahlten Abschläge (brutto) einer Schlussrechnung. */
export const prepaidCents = (inv) => (inv?.kind === 'final' ? (inv.prepayments ?? []).reduce((s, p) => s + toCents(p.gross), 0) : 0);

/** Summen einer Rechnung mit allen Optionen aus Rechnung und Einstellungen. */
export const invoiceTotals = (inv, settings = {}) => calculateTotals(inv.items, {
  kleinunternehmer: Boolean(settings.kleinunternehmer),
  discount: inv.discount,
  pricesGross: Boolean(inv.pricesGross),
  prepaid: prepaidCents(inv),
});

/** Netto ↔ Brutto für einen Einzelpreis (beim Umschalten der Eingabeart). */
export function convertPrice(priceUnits, rate, toGross) {
  if (!rate) return priceUnits;
  return toGross ? roundDivInt(BigInt(priceUnits) * BigInt(100 + rate), 100) : roundDivInt(BigInt(priceUnits) * 100n, 100 + rate);
}

/** Skonto: Betrag und Frist für schnelle Zahlung (auf den Zahlbetrag). null, wenn aus oder unvollständig. */
export function skontoInfo(payableCents, issueDate, skonto) {
  if (!skonto?.enabled || payableCents <= 0) return null;
  let percent;
  try { percent = toPercent(skonto.percent); } catch { return null; }
  const days = Number(skonto.days);
  if (!percent || !Number.isInteger(days) || days < 1 || days > 365) return null;
  const amount = roundDivInt(BigInt(payableCents) * BigInt(Math.round(percent * 10_000)), 1_000_000);
  return { percent, days, amount, payable: payableCents - amount, until: isValidIsoDate(issueDate) ? addDays(issueDate, days) : null };
}
