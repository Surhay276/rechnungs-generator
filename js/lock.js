/**
 * Festschreibung (GoBD): Eine ausgestellte Rechnung wird nicht mehr verändert.
 *
 * Beim Abschließen wird alles eingefroren, was von außen auf die Rechnung wirkt: Firmendaten,
 * Kleinunternehmer-Status, Design. Spätere Änderungen in den Einstellungen gelten nur für neue Rechnungen.
 * Korrekturen laufen über eine neue Rechnung (Kopie oder Stornorechnung) mit eigener Nummer.
 */
import { formatDate } from './dates.js?v=26';

/** Ist die Rechnung abgeschlossen (festgeschrieben)? */
export const isLocked = (inv) => inv?.status === 'erstellt';

/** Schließt eine Rechnung ab: Status + eingefrorene Kopie der Einstellungen. Gibt eine neue Rechnung zurück. */
export function finalizeInvoice(inv, settings, { design = null, now = Date.now() } = {}) {
  if (isLocked(inv)) return inv;
  const snapshot = structuredClone({ company: settings.company, kleinunternehmer: Boolean(settings.kleinunternehmer), design });
  return { ...structuredClone(inv), status: 'erstellt', lockedAt: now, snapshot };
}

/** Einstellungen, mit denen eine Rechnung dargestellt/exportiert wird: eingefroren oder aktuell. */
export const settingsFor = (inv, current) => (isLocked(inv) && inv.snapshot ? { ...current, ...inv.snapshot } : current);

/** Kopie als neuer Entwurf mit neuer Nummer – das Original bleibt unverändert. */
export function copyAsDraft(inv, { id, number, date }) {
  const { snapshot, lockedAt, ...rest } = structuredClone(inv);
  return { ...rest, id, number, date, status: 'entwurf', dueDate: inv.paymentDays === 'custom' ? '' : rest.dueDate, updatedAt: Date.now() };
}

/**
 * Stornorechnung zu einer abgeschlossenen Rechnung: gleiche Positionen, Verweis auf das Original (BT-25/26).
 * Für eine Teilkorrektur lassen sich die Positionen im Entwurf noch anpassen.
 */
export function createStorno(inv, { id, number, date }) {
  const { snapshot, lockedAt, prepayments, ...rest } = structuredClone(inv);
  return {
    ...rest,
    id,
    number,
    date,
    kind: 'storno',
    status: 'entwurf',
    reference: { number: inv.number, date: inv.date },
    paymentDays: 0,
    dueDate: '',
    skonto: { ...(rest.skonto ?? {}), enabled: false },
    giroCode: false,
    intro: `Hiermit stornieren wir die Rechnung ${inv.number} vom ${formatDate(inv.date)} in voller Höhe.`,
    updatedAt: Date.now(),
  };
}
