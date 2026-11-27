/**
 * Datenhaltung im Browser (localStorage): Rechnungen, Kunden, Einstellungen.
 * Ältere Speicherstände werden beim Laden ergänzt, ohne abgeschlossene Rechnungen inhaltlich zu verändern.
 */
import {
  nextInvoiceNumber, DEFAULT_NUMBER_FORMAT, todayIso, isLocked, finalizeInvoice, settingsFor, invoiceTotals, serviceModeOf, taxKeyOf,
} from './invoice.js?v=28';
import { DEFAULT_COLOR, normalizeHex } from './color.js?v=28';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs?v=28';

export const STORAGE_KEY = 'rechnungen:v3';

/** Der gesamte Speicherstand: als Objekt, damit andere Module ihn austauschen können (Rückgängig, Import). */
export const state = { store: null };

export const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const settings = () => state.store.settings;
export const invoice = () => state.store.invoices.find((i) => i.id === state.store.currentId);
/** Einstellungen für eine Rechnung: bei abgeschlossenen die eingefrorenen. */
export const invSettings = (inv = invoice()) => settingsFor(inv, settings());
/** Kontext für die Prüfung: alle anderen Rechnungen (eindeutige Nummer, Reihenfolge) und das heutige Datum. */
export const validationContext = () => ({ others: state.store.invoices, today: todayIso() });
/** Summen oder null bei ungültigen Eingaben. */
export function totalsOf(inv = invoice()) {
  try { return invoiceTotals(inv, invSettings(inv)); } catch { return null; }
}

/** Gewähltes Rechnungsdesign: ältere Speicherstände ohne Design bekommen den Standard. */
export function design(source = settings()) {
  const d = source.design ?? {};
  return { color: normalizeHex(d.color) ?? DEFAULT_COLOR, head: d.head === 'light' ? 'light' : 'filled' };
}

// ---------- Neue Objekte ----------
export const emptyCustomer = () => ({ id: null, name: '', street: '', zip: '', city: '', country: 'DE', email: '', vatId: '', reference: '', isPublic: false });
export const emptyItem = () => ({ description: '', details: '', quantity: '1', unit: 'H87', unitPrice: '', taxType: 'S19', discount: null });

/** Nächste freie Rechnungsnummer nach dem eingestellten Format. */
export function nextNumber(s = state.store, date = todayIso()) {
  const format = s.settings.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  return nextInvoiceNumber(s.invoices.map((i) => i.number), { ...format, date });
}

export function newInvoice(s = state.store) {
  const d = s.settings.defaults ?? {};
  const date = todayIso();
  return {
    id: newId(),
    number: nextNumber(s, date),
    kind: 'invoice',
    status: 'entwurf',
    date,
    paymentDays: d.paymentDays ?? 14,
    dueDate: '',
    serviceMode: 'same',
    serviceFrom: '',
    serviceTo: '',
    currency: 'EUR',
    fxRate: '',
    pricesGross: Boolean(d.pricesGross),
    customer: emptyCustomer(),
    items: [emptyItem()],
    discount: { type: 'amount', value: '' },
    exemptionReason: '',
    skonto: { enabled: false, percent: '2', days: 7 }, // Skonto und GiroCode nur, wenn der Nutzer sie einschaltet
    giroCode: false,
    prepayments: [],
    retentionNotice: false,
    intro: d.intro ?? '',
    note: d.note ?? '',
    updatedAt: Date.now(),
  };
}

/** Leere Einstellungen: beim ersten Start trägt man seine eigenen Daten ein. */
export function emptySettings() {
  return {
    company: {
      name: '', contact: '', street: '', zip: '', city: '', country: 'DE', taxId: '', vatId: '', email: '', phone: '', iban: '', bic: '', bank: '', logo: '',
      legalForm: '', registerCourt: '', registerNumber: '', officers: '',
    },
    kleinunternehmer: false,
    design: { color: DEFAULT_COLOR, head: 'filled' },
    numberFormat: { ...DEFAULT_NUMBER_FORMAT },
    zugferd: true,
    defaults: {
      intro: 'Sehr geehrte Damen und Herren,\nhiermit stelle ich Ihnen folgende Leistungen in Rechnung:',
      note: 'Vielen Dank für Ihren Auftrag.\n\nMit freundlichen Grüßen',
      paymentDays: 14,
    },
  };
}

/** Standard: leerer Start ohne Beispieldaten. */
export function seed() {
  const base = { settings: emptySettings(), customers: [], invoices: [] };
  const inv = newInvoice(base);
  return { ...base, invoices: [inv], currentId: inv.id };
}

/** Ausgefülltes Beispiel zum Ausprobieren (in den Einstellungen). */
export function demo() {
  const t = todayIso();
  const base = { settings: { ...emptySettings(), ...sampleSettings() }, customers: [], invoices: [] };
  const invoice = { ...sampleInvoice(t), id: newId(), number: nextNumber(base, t), serviceFrom: `${t.slice(0, 8)}01`, serviceTo: t, prepayments: [], updatedAt: Date.now() };
  return { ...base, customers: [{ ...invoice.customer }], invoices: [invoice], currentId: invoice.id };
}

/**
 * Ergänzt Felder, die ältere Speicherstände noch nicht kennen.
 * Abgeschlossene Rechnungen behalten ihren Inhalt: Steuerarten werden dort aus `taxRate` abgeleitet, nicht umgeschrieben.
 */
export function normalize(s) {
  const st = s.settings;
  st.addressLookup ??= true;
  st.geoBias ??= false; // Standort nur nach ausdrücklicher Einwilligung
  st.zugferd ??= true;
  st.numberFormat ??= { ...DEFAULT_NUMBER_FORMAT };
  st.company = { ...emptySettings().company, ...st.company };
  st.defaults ??= emptySettings().defaults;
  s.customers = (s.customers ?? []).map((c) => ({ ...emptyCustomer(), ...c }));
  s.invoices = s.invoices.map((inv) => {
    const base = { kind: 'invoice', currency: 'EUR', prepayments: [], ...inv, customer: { ...emptyCustomer(), ...inv.customer } };
    base.serviceMode ??= serviceModeOf(inv);
    if (isLocked(base)) {
      // Abgeschlossene Rechnungen ohne eingefrorene Firmendaten (sehr alte Speicherstände) nachträglich festschreiben
      return base.snapshot ? base : finalizeInvoice({ ...base, status: 'entwurf' }, st, { design: st.design ?? null, now: base.updatedAt });
    }
    base.items = base.items.map((item) => {
      const { taxRate, grossPrice, ...rest } = item;
      return { ...rest, taxType: taxKeyOf(item) };
    });
    return base;
  });
  if (!s.invoices.length) s.invoices.push(newInvoice(s));
  if (!s.invoices.some((i) => i.id === s.currentId)) s.currentId = s.invoices[0].id;
  return s;
}

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.settings && Array.isArray(saved.invoices)) return normalize(saved);
  } catch { /* beschädigt oder nicht verfügbar → neu anfangen */ }
  return normalize(seed());
}

/** Sofort speichern. Liefert false, wenn der Speicher voll ist. */
export function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
    return true;
  } catch {
    return false;
  }
}

let saveTimer;
/** Verzögert speichern (beim Tippen); onDone(ok) meldet das Ergebnis. */
export function save(onDone = () => {}) {
  const inv = invoice();
  if (inv && !isLocked(inv)) inv.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => onDone(persist()), 250);
}

/** Bittet den Browser, die Daten nicht bei Speicherknappheit zu löschen (wichtig für die Aufbewahrung). */
export function requestPersistentStorage() {
  navigator.storage?.persisted?.().then((done) => (done ? true : navigator.storage.persist?.())).catch(() => {});
}

state.store = load();
