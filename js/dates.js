/** Datumsrechnung auf ISO-Daten (JJJJ-MM-TT) – zeitzonensicher in UTC. */

/** Ist das ein echtes Kalenderdatum? („2026-02-30“ ist es nicht.) */
export function isValidIsoDate(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Addiert Tage zu einem ISO-Datum. */
export function addDays(isoDate, days) {
  if (!isValidIsoDate(isoDate)) throw new Error(`Ungültiges Datum: ${isoDate}`);
  const n = Number(days);
  if (!Number.isInteger(n) || Math.abs(n) > 36_500) throw new Error(`Ungültige Anzahl Tage: ${days}`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Tage zwischen zwei ISO-Daten (b − a). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Heutiges Datum in lokaler Zeit als ISO-Datum. */
export const todayIso = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Fälligkeitsdatum: festes Datum („Datum wählen“) oder Rechnungsdatum + Zahlungsziel. */
export function dueDate(inv) {
  if (inv.paymentDays === 'custom') return isValidIsoDate(inv.dueDate) ? inv.dueDate : null;
  if (!isValidIsoDate(inv.date)) return null;
  return addDays(inv.date, Number(inv.paymentDays) || 0);
}

/**
 * Leistungsdatum (§ 14 Abs. 4 Nr. 6 UStG): „same“ = wie Rechnungsdatum, „date“ = eigener Tag, „period“ = Zeitraum.
 * Ältere Rechnungen ohne `serviceMode` werden aus den vorhandenen Feldern abgeleitet.
 */
export function serviceModeOf(inv) {
  if (inv.serviceMode) return inv.serviceMode;
  if (!inv.serviceFrom) return 'same';
  return inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? 'period' : 'date';
}

/** { from, to } des Leistungszeitraums bzw. -tags; null, wenn unvollständig. */
export function servicePeriod(inv) {
  const mode = serviceModeOf(inv);
  if (mode === 'same') return isValidIsoDate(inv.date) ? { from: inv.date, to: inv.date, mode } : null;
  if (!isValidIsoDate(inv.serviceFrom)) return null;
  if (mode === 'date') return { from: inv.serviceFrom, to: inv.serviceFrom, mode };
  return isValidIsoDate(inv.serviceTo) ? { from: inv.serviceFrom, to: inv.serviceTo, mode } : null;
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
/** „2026-11-27“ → „27.11.2026“ */
export const formatDate = (iso) => (isValidIsoDate(iso) ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '');
