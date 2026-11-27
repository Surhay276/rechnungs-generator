import {
  UNITS, toCents, calculateTotals, lineNet, formatEUR, nextInvoiceNumber, addDays, dueDate,
  isValidIBAN, formatIBAN, grossFromNet, netFromGross, formatAddress,
  validateInvoiceFields, validateXRechnungFields, toXRechnung,
  isLocked, finalizeInvoice, settingsFor, copyAsDraft,
} from './invoice.js?v=23';
import { DEFAULT_COLOR, PRESET_COLORS, normalizeHex, invoiceTheme, hsvToHex, hexToHsv } from './color.js?v=23';
import { buildInvoiceView, formatDate } from './view.js?v=23';
import { attachAddressLookup } from './address.js?v=23';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs?v=23';

const STORAGE_KEY = 'rechnungen:v3';
const THEME_KEY = 'rechnungen:theme';
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- Helfer ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const present = (c) => c !== null && c !== undefined && c !== false && c !== '';
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(present));
  return node;
};
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const centsToInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}
const multiline = (text) => String(text ?? '').split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line]));
const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Daten ----------
const emptyCustomer = () => ({ id: null, name: '', street: '', zip: '', city: '', country: 'DE', email: '', reference: '' });
const emptyItem = () => ({ description: '', details: '', quantity: '1', unit: 'H87', unitPrice: '', taxRate: 19, discount: null });

function newInvoice(s = store) {
  const year = new Date().getFullYear();
  const last = s.invoices.map((i) => i.number).filter((n) => n?.startsWith(`RE-${year}-`)).sort().at(-1);
  const d = s.settings.defaults ?? {};
  return {
    id: newId(),
    number: nextInvoiceNumber(last ?? null, year),
    status: 'entwurf',
    date: today(),
    paymentDays: d.paymentDays ?? 14,
    dueDate: '',
    serviceFrom: '',
    serviceTo: '',
    customer: emptyCustomer(),
    items: [emptyItem()],
    discount: { type: 'amount', value: '' },
    skonto: { enabled: false, percent: '2', days: 7 },
    giroCode: true,
    intro: d.intro ?? '',
    note: d.note ?? '',
    updatedAt: Date.now(),
  };
}

/** Leere Einstellungen – beim ersten Start trägt man seine eigenen Daten ein. */
function emptySettings() {
  return {
    company: { name: '', contact: '', street: '', zip: '', city: '', country: 'DE', taxId: '', vatId: '', email: '', phone: '', iban: '', bic: '', bank: '', logo: '' },
    kleinunternehmer: false,
    design: { color: DEFAULT_COLOR, head: 'filled' },
    defaults: {
      intro: 'Sehr geehrte Damen und Herren,\nhiermit stelle ich Ihnen folgende Leistungen in Rechnung:',
      note: 'Vielen Dank für Ihren Auftrag.\n\nMit freundlichen Grüßen',
      paymentDays: 14,
    },
  };
}

/** Standard: leerer Start ohne Beispieldaten. */
function seed() {
  const base = { settings: emptySettings(), customers: [], invoices: [] };
  const inv = newInvoice(base);
  return { ...base, invoices: [inv], currentId: inv.id };
}

/** Optional: ausgefülltes Beispiel zum Ausprobieren (in den Einstellungen). */
function demo() {
  const t = today();
  const invoice = { ...sampleInvoice(t), id: newId(), number: `RE-${t.slice(0, 4)}-0001`, serviceFrom: `${t.slice(0, 8)}01`, serviceTo: t, updatedAt: Date.now() };
  return { settings: sampleSettings(), customers: [{ ...invoice.customer }], invoices: [invoice], currentId: invoice.id };
}

/** Sind die Firmendaten vollständig genug für eine Rechnung? */
const companyMissing = () => validateInvoiceFields(invoice(), settings()).filter((e) => e.field.startsWith('company.'));

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.settings && Array.isArray(saved.invoices) && saved.invoices.length) return saved;
  } catch { /* ignorieren */ }
  return seed();
}

let store = normalize(load());
/** Ergänzt Einstellungen, die ältere Speicherstände noch nicht kennen. */
function normalize(s) {
  s.settings.addressLookup ??= true;
  return s;
}
if (!store.invoices.some((i) => i.id === store.currentId)) store.currentId = store.invoices[0].id;
// Ältere Speicherstände: abgeschlossene Rechnungen ohne eingefrorene Firmendaten nachträglich festschreiben
store.invoices = store.invoices.map((inv) => (isLocked(inv) && !inv.snapshot ? finalizeInvoice({ ...inv, status: 'entwurf' }, store.settings, { design: store.settings.design ?? null, now: inv.updatedAt }) : inv));
const invoice = () => store.invoices.find((i) => i.id === store.currentId);
/** Einstellungen für die geöffnete Rechnung – bei abgeschlossenen die eingefrorenen. */
const invSettings = (inv = invoice()) => settingsFor(inv, settings());
const settings = () => store.settings;

let saveTimer;
function save() {
  invoice().updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      renderSaveState(true);
    } catch {
      $('#save-state').textContent = 'Speichern nicht möglich – Speicher voll (Logo zu groß?)';
    }
  }, 250);
}

// ---------- Schritte ----------
let step = 1;
const layout = $('.layout');

function setStep(n) {
  step = Math.min(3, Math.max(1, n));
  $$('.step-panel').forEach((p) => { p.hidden = Number(p.dataset.panel) !== step; });
  $$('.step').forEach((b) => {
    const s = Number(b.dataset.step);
    b.classList.toggle('is-active', s === step);
    b.classList.toggle('is-done', s < step);
    if (s === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  $('#prev-step').disabled = step === 1; // bleibt sichtbar → Leiste springt nicht
  const last = step === 3;
  $('#export-xml-bar').hidden = !last;
  for (const btn of [$('#next-step'), $('#sumbar-action')]) {
    btn.replaceChildren(last ? icon('download') : '', last ? 'PDF exportieren' : 'Weiter', last ? '' : icon('right'));
  }
  if (step === 3) renderBankSummary();
  $('#scroller').scrollTo?.({ top: 0 });
  $('.editor').scrollTo?.({ top: 0 });
}

const STEP_FIELDS = {
  1: (f) => f.startsWith('customer.') || ['number', 'date', 'dueDate', 'serviceFrom', 'serviceTo'].includes(f),
  2: (f) => f.startsWith('items') || f === 'discount',
};
const stepOf = (field) => (field.startsWith('company.') ? 'settings' : STEP_FIELDS[1](field) ? 1 : STEP_FIELDS[2](field) ? 2 : 3);

function next() {
  if (step === 3) { exportPdf(); return; }
  const errors = validateInvoiceFields(invoice(), settings()).filter((e) => stepOf(e.field) === step);
  if (errors.length) {
    errors.forEach((e) => touched.add(e.field));
    renderFieldErrors();
    goToField(errors[0].field);
    toast(errors.length === 1 ? 'Bitte das rot markierte Feld ausfüllen.' : `Bitte die ${errors.length} rot markierten Felder ausfüllen.`);
    return;
  }
  setStep(step + 1);
}

$$('.step').forEach((b) => b.addEventListener('click', () => setStep(Number(b.dataset.step))));
$('#next-step').addEventListener('click', next);
$('#sumbar-action').addEventListener('click', next);
$('#prev-step').addEventListener('click', () => setStep(step - 1));

// ---------- Formular: Rechnung ----------
const form = $('#invoice-form');
const itemsBox = $('#items');
const collapsedItems = new Set();

function fillForm() {
  const inv = invoice();
  for (const input of $$('[data-field]', form)) {
    const value = getPath(inv, input.dataset.field);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  }
  customerLookup.reset();
  renderCustomerSelect();
  renderPaymentChips();
  renderItems();
  $('#skonto-fields').hidden = !inv.skonto?.enabled;
  renderBankSummary(); // setzt den GiroCode-Schalter passend zur IBAN
  applyLock();
}

/**
 * Abgeschlossene Rechnung: alle Eingaben gesperrt, Hinweis oben, Korrektur nur als Kopie.
 * Steuerelemente mit [data-keep] (Export, Kopie anlegen) bleiben bedienbar.
 */
function applyLock() {
  const locked = isLocked(invoice());
  $('.editor').classList.toggle('is-locked', locked);
  $('#locked-note').hidden = !locked;
  $('#save-draft').hidden = locked;
  const controls = $$('.step-panel input, .step-panel select, .step-panel textarea, .step-panel button').filter((c) => !c.closest('[data-keep]') && !('keep' in c.dataset));
  if (locked) {
    for (const c of controls) if (!c.disabled) { c.disabled = true; c.dataset.locked = ''; }
  } else if (controls.some((c) => 'locked' in c.dataset)) {
    for (const c of controls) if ('locked' in c.dataset) { c.disabled = false; delete c.dataset.locked; }
    renderBankSummary(); // GiroCode-Schalter wieder nach IBAN richten
  }
}
$('#locked-copy').addEventListener('click', () => duplicateInvoice(invoice().id));

form.addEventListener('input', (e) => {
  const t = e.target;
  const inv = invoice();
  if (t.dataset.field) {
    const value = t.type === 'checkbox' ? t.checked : t.dataset.field === 'skonto.days' ? Number(t.value) : t.value;
    setPath(inv, t.dataset.field, value);
    if (t.dataset.field.startsWith('customer.')) syncSavedCustomer();
    if (t.dataset.field === 'skonto.enabled') $('#skonto-fields').hidden = !t.checked;
    if (t.dataset.field === 'date' || t.dataset.field === 'dueDate') renderPaymentChips();
  }
  update();
});

// Adressvorschläge (Straße → PLZ + Ort, PLZ → Ort) – abschaltbar in den Einstellungen
const lookupEnabled = () => settings().addressLookup !== false;
const customerLookup = attachAddressLookup({
  street: $('[data-field="customer.street"]', form),
  zip: $('[data-field="customer.zip"]', form),
  city: $('[data-field="customer.city"]', form),
  enabled: () => lookupEnabled() && !isLocked(invoice()),
});
attachAddressLookup({
  street: $('[data-setting="company.street"]'),
  zip: $('[data-setting="company.zip"]'),
  city: $('[data-setting="company.city"]'),
  enabled: lookupEnabled,
});

// Kunden
function renderCustomerSelect() {
  const inv = invoice();
  const select = $('#customer-select');
  select.replaceChildren(
    el('option', { value: '', textContent: '＋ Neuer Kunde' }),
    ...store.customers.map((c) => el('option', { value: c.id, textContent: [c.name, c.city].filter(Boolean).join(' · ') })),
  );
  select.value = store.customers.some((c) => c.id === inv.customer.id) ? inv.customer.id : '';
  $('#save-customer').checked = store.customers.some((c) => c.id === inv.customer.id);
}

$('#customer-select').addEventListener('change', (e) => {
  const chosen = store.customers.find((c) => c.id === e.target.value);
  invoice().customer = chosen ? { ...chosen } : emptyCustomer();
  fillForm();
  update();
  if (!chosen) $('[data-field="customer.name"]').focus();
});

function syncSavedCustomer() {
  const k = invoice().customer;
  const saved = store.customers.find((c) => c.id === k.id);
  if (saved) Object.assign(saved, k);
}

$('#save-customer').addEventListener('change', (e) => {
  const k = invoice().customer;
  if (e.target.checked) {
    if (!k.name.trim()) {
      e.target.checked = false;
      toast('Bitte zuerst den Namen des Kunden eingeben.');
      $('[data-field="customer.name"]').focus();
      return;
    }
    k.id ??= newId();
    if (!store.customers.some((c) => c.id === k.id)) store.customers.push({ ...k });
    toast(`„${k.name}“ in der Kundenliste gespeichert`);
  } else {
    store.customers = store.customers.filter((c) => c.id !== k.id);
    toast('Aus der Kundenliste entfernt');
  }
  renderCustomerSelect();
  renderCustomerList();
  save();
});

// Zahlungsfrist
function renderPaymentChips() {
  const inv = invoice();
  for (const chip of $$('#payment-chips .chip')) {
    const active = String(inv.paymentDays) === chip.dataset.days;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-checked', String(active));
  }
  $('#due-custom').hidden = inv.paymentDays !== 'custom';
  const due = dueDate(inv);
  $('#due-hint').textContent = due ? (due === inv.date ? 'Fällig sofort.' : `Fällig am ${formatDate(due)}.`) : '';
}
$('#payment-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const inv = invoice();
  inv.paymentDays = chip.dataset.days === 'custom' ? 'custom' : Number(chip.dataset.days);
  if (inv.paymentDays === 'custom' && !inv.dueDate && inv.date) inv.dueDate = addDays(inv.date, 21);
  $('[data-field="dueDate"]').value = inv.dueDate;
  renderPaymentChips();
  update();
});

// ---------- Leistungen ----------
const template = $('#item-template');

function renderItems() {
  const inv = invoice();
  const ku = invSettings(inv).kleinunternehmer;
  itemsBox.replaceChildren(...inv.items.map((item, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.index = index;
    const unit = card.querySelector('[data-key="unit"]');
    unit.replaceChildren(...UNITS.map((u) => el('option', { value: u.code, textContent: u.label })));
    for (const input of $$('[data-key]', card)) {
      const key = input.dataset.key;
      if (key === 'grossPrice') continue;
      input.value = getPath(item, key) ?? '';
    }
    const tax = card.querySelector('[data-key="taxRate"]');
    tax.disabled = ku;
    if (ku) tax.title = 'Als Kleinunternehmer wird keine Umsatzsteuer ausgewiesen';
    card.querySelector('[data-key="grossPrice"]').closest('.field').hidden = ku;
    card.querySelector('.item-discount').hidden = !item.discount;
    card.querySelector('[data-action="add-discount"]').hidden = Boolean(item.discount);
    const collapsed = collapsedItems.has(item);
    card.classList.toggle('is-collapsed', collapsed);
    card.querySelector('.item-toggle').setAttribute('aria-expanded', String(!collapsed));
    card.querySelector('[data-action="remove"]').hidden = inv.items.length === 1;
    updateItemCard(card, item, index);
    return card;
  }));
}

function updateItemCard(card, item, index) {
  card.querySelector('.item-name').textContent = item.description.trim() || `Leistung ${index + 1}`;
  let total = '';
  try { total = formatEUR(lineNet(item)); } catch { /* ungültige Eingabe */ }
  card.querySelector('.item-total').textContent = total;
  const gross = card.querySelector('[data-key="grossPrice"]');
  if (document.activeElement !== gross) {
    try { gross.value = item.unitPrice === '' ? '' : centsToInput(grossFromNet(toCents(item.unitPrice), Number(item.taxRate))); } catch { gross.value = ''; }
  }
}

itemsBox.addEventListener('input', (e) => {
  const t = e.target;
  const card = t.closest('.item');
  if (!card || !t.dataset.key) return;
  const index = Number(card.dataset.index);
  const item = invoice().items[index];
  const key = t.dataset.key;
  if (key === 'grossPrice') {
    try {
      item.unitPrice = t.value.trim() === '' ? '' : centsToInput(netFromGross(toCents(t.value), Number(item.taxRate)));
      card.querySelector('[data-key="unitPrice"]').value = item.unitPrice;
    } catch { /* Zwischenstand beim Tippen */ }
  } else {
    setPath(item, key, key === 'taxRate' ? Number(t.value) : t.value);
  }
  updateItemCard(card, item, index);
  update();
});

itemsBox.addEventListener('click', (e) => {
  const card = e.target.closest('.item');
  if (!card) return;
  const inv = invoice();
  const index = Number(card.dataset.index);
  const item = inv.items[index];
  if (e.target.closest('.item-toggle')) {
    collapsedItems[collapsedItems.has(item) ? 'delete' : 'add'](item);
    renderItems();
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'remove') {
    const before = structuredClone(inv.items);
    inv.items.splice(index, 1);
    renderItems();
    update();
    toast('Leistung entfernt', { label: 'Rückgängig', run: () => { invoice().items = before; renderItems(); update(); } });
  } else if (action === 'add-discount') {
    item.discount = { type: 'percent', value: '' };
    renderItems();
    itemsBox.children[index].querySelector('[data-key="discount.value"]').focus();
  } else if (action === 'remove-discount') {
    item.discount = null;
    renderItems();
    update();
  }
});

$('#add-item').addEventListener('click', () => {
  const inv = invoice();
  inv.items.forEach((i) => { if (i.description.trim()) collapsedItems.add(i); }); // fertige Leistungen einklappen
  inv.items.push(emptyItem());
  renderItems();
  update();
  const card = itemsBox.lastElementChild;
  card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  card.querySelector('[data-key="description"]').focus({ preventScroll: true });
});

// ---------- Zahlung & Texte ----------
function renderBankSummary() {
  const c = invSettings().company;
  const ok = isValidIBAN(c.iban);
  const status = ok ? formatIBAN(c.iban) : c.iban ? `${formatIBAN(c.iban)} – IBAN ungültig (Prüfziffer stimmt nicht)` : 'Noch keine IBAN hinterlegt';
  const summary = $('#bank-summary');
  summary.classList.toggle('is-invalid', !ok);
  summary.replaceChildren(
    el('div', {},
      el('span', { className: 'field-label', textContent: 'Bankverbindung' }),
      el('p', { className: c.iban ? 'mono' : 'bank-missing', textContent: status }),
      c.bank && el('p', { className: 'field-hint', textContent: c.bank })),
    el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: ok ? 'Ändern' : c.iban ? 'Korrigieren' : 'Eintragen', onclick: () => openSettings('company.iban') }),
  );
  // Ohne gültige IBAN: Schalter aus und gesperrt, nur ein kurzer Hinweis. Die Wahl selbst bleibt gespeichert.
  const giro = $('[data-field="giroCode"]');
  giro.disabled = !ok;
  giro.checked = ok && Boolean(invoice().giroCode);
  giro.closest('.switch').classList.toggle('is-disabled', !ok);
  $('#giro-desc').hidden = !ok;
  const warning = $('#giro-warning');
  warning.hidden = ok;
  warning.textContent = c.iban ? 'Nicht verfügbar – die IBAN ist ungültig.' : 'Nicht verfügbar – keine IBAN eingetragen.';
}

$('#save-defaults').addEventListener('click', () => {
  const inv = invoice();
  Object.assign(settings().defaults, { intro: inv.intro, note: inv.note });
  save();
  toast('Kopfzeile und Anmerkungen werden für neue Rechnungen übernommen');
});

// ---------- Pflichtfelder: rot markieren & hinführen ----------
const touched = new Set();
let showAllErrors = false;

function fieldKeyOf(input) {
  if (input.dataset.field) return input.dataset.field;
  if (input.dataset.setting) return input.dataset.setting;
  const card = input.closest('.item');
  return card && input.dataset.key ? `items.${card.dataset.index}.${input.dataset.key}` : null;
}
const errorInputs = () => $$('[data-field], [data-setting], .item [data-key]');

function renderFieldErrors(errors = currentErrors()) {
  const byField = new Map(errors.map((e) => [e.field, e.message]));
  for (const input of errorInputs()) {
    const key = fieldKeyOf(input);
    if (!key) continue;
    const message = (showAllErrors || touched.has(key)) ? byField.get(key) : undefined;
    const container = input.closest('.field') ?? input.parentElement;
    const hintId = `err-${key.replace(/\./g, '-')}`;
    let hint = container.querySelector(`#${CSS.escape(hintId)}`);
    if (message) {
      if (!hint) container.append(hint = el('p', { className: 'field-error', id: hintId }));
      hint.textContent = key.startsWith('items.') ? message.replace(/^Leistung \d+: /, '') : message;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', hintId);
    } else {
      hint?.remove();
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }
  $('#add-item').classList.toggle('is-invalid', Boolean(byField.get('items') && showAllErrors));
  // Schritte mit Fehlern kennzeichnen (nach dem ersten Exportversuch)
  for (const b of $$('.step')) {
    const s = Number(b.dataset.step);
    b.classList.toggle('has-error', showAllErrors && errors.some((e) => stepOf(e.field) === s));
  }
  $('#open-settings').classList.toggle('has-error', showAllErrors && errors.some((e) => stepOf(e.field) === 'settings'));
}

let exportMode = 'pdf';
const currentErrors = () => (exportMode === 'xml' ? validateXRechnungFields : validateInvoiceFields)(invoice(), invSettings());

function goToField(field) {
  const target = stepOf(field);
  if (target === 'settings') { openSettings(field); return; }
  if (layout.dataset.view !== 'edit') switchView('edit');
  if (step !== target) setStep(target);
  const m = /^items\.(\d+)\./.exec(field);
  if (m) {
    const item = invoice().items[Number(m[1])];
    if (collapsedItems.delete(item)) renderItems();
  }
  renderFieldErrors();
  const input = field === 'items' ? $('#add-item') : errorInputs().find((i) => fieldKeyOf(i) === field);
  if (!input) return;
  input.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
}

document.addEventListener('focusout', (e) => {
  if (!e.target.matches?.('[data-field], [data-setting], .item [data-key]')) return;
  const key = fieldKeyOf(e.target);
  if (key) { touched.add(key); renderFieldErrors(); }
});

// ---------- Export ----------
function checkBeforeExport(mode) {
  exportMode = mode;
  if (isLocked(invoice())) return true; // wurde beim Abschließen geprüft und bleibt unverändert
  const errors = currentErrors();
  if (!errors.length) return true;
  showAllErrors = true;
  renderFieldErrors(errors);
  goToField(errors[0].field);
  toast(errors.length === 1 ? 'Eine Angabe fehlt noch – sie ist rot markiert.' : `${errors.length} Angaben fehlen noch – sie sind rot markiert.`);
  return false;
}

/** Rechnung festschreiben: Status, Zeitpunkt und eingefrorene Firmendaten/Design. */
function markCreated() {
  const inv = invoice();
  if (isLocked(inv)) return;
  const done = finalizeInvoice(inv, settings(), { design: design() });
  store.invoices[store.invoices.indexOf(inv)] = done;
  fillForm();
  update();
}

/** Vor dem ersten Export fragen – danach ist die Rechnung nicht mehr änderbar. */
function confirmFinalize(mode) {
  if (isLocked(invoice())) return Promise.resolve(true);
  const dialog = $('#finalize');
  $('#finalize-number').textContent = invoice().number;
  $('#finalize-confirm-label').textContent = mode === 'xml' ? 'Abschließen & E-Rechnung laden' : 'Abschließen & PDF exportieren';
  return new Promise((resolve) => {
    const done = (ok) => { dialog.removeEventListener('close', onClose); resolve(ok); };
    const onClose = () => done(dialog.returnValue === 'confirm');
    dialog.returnValue = '';
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    $('#finalize-confirm').focus();
  });
}

// ---------- PDF direkt im Programm erzeugen (ohne Druckdialog) ----------
let pdfFonts = null;
/** Schriften fürs PDF einmalig laden (Inter, Teilmenge mit Umlauten und Latin Extended, ca. 24 KB je Schnitt). */
function loadPdfFonts() {
  pdfFonts ??= Promise.all([400, 600, 700].map((w) => fetch(`fonts/inter-pdf-${w}.ttf?v=23`).then((r) => {
    if (!r.ok) throw new Error('Schrift nicht gefunden');
    return r.arrayBuffer();
  }))).then(([regular, semibold, bold]) => ({ regular, semibold, bold }))
    .catch((e) => { pdfFonts = null; throw e; });
  return pdfFonts;
}

/** Logo als Rohpixel (RGB + Transparenz) – Seitenverhältnis bleibt exakt erhalten, nichts wird beschnitten. */
function rasterizeLogo(src) {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || 300;
      const h0 = img.naturalHeight || 150;
      // Pixelgrafiken in Originalgröße, SVGs scharf auf bis zu 1200 × 480 px
      const scale = src.startsWith('data:image/svg') ? Math.min(1200 / w0, 480 / h0) : Math.min(1, 1200 / w0, 480 / h0);
      const width = Math.max(1, Math.round(w0 * scale));
      const height = Math.max(1, Math.round(h0 * scale));
      const canvas = el('canvas', { width, height });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const rgb = new Uint8Array(width * height * 3);
      const alpha = new Uint8Array(width * height);
      let transparent = false;
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        rgb[j * 3] = data[i]; rgb[j * 3 + 1] = data[i + 1]; rgb[j * 3 + 2] = data[i + 2];
        alpha[j] = data[i + 3];
        if (data[i + 3] < 255) transparent = true;
      }
      resolve({ width, height, rgb, alpha: transparent ? alpha : null });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function currentView(inv = invoice()) {
  const s = invSettings(inv);
  let totals = null;
  try { totals = calculateTotals(inv.items, { kleinunternehmer: s.kleinunternehmer, discount: inv.discount }); } catch { /* ungültig */ }
  return buildInvoiceView(inv, s, totals, design(s));
}

let pdfBusy = false;
async function exportPdf() {
  if (pdfBusy) return;
  if (!checkBeforeExport('pdf')) return;
  if (!(await confirmFinalize('pdf'))) return;
  markCreated();
  pdfBusy = true;
  document.documentElement.classList.add('pdf-busy');
  // Neues Fenster sofort öffnen, solange der Klick noch „frisch“ ist – sonst blockt der Browser es als Pop-up.
  // Auf Handys übernimmt das System das Öffnen der heruntergeladenen Datei.
  const canOpenTab = matchMedia('(pointer: fine)').matches;
  const tab = canOpenTab ? window.open('', '_blank') : null;
  tab?.document.write('<title>PDF wird erstellt …</title><p style="font:16px system-ui;padding:24px;color:#475467">PDF wird erstellt …</p>');
  try {
    const { createInvoicePdf } = await import('./invoice-pdf.js?v=23');
    const view = currentView();
    const [fonts, logo] = await Promise.all([loadPdfFonts(), rasterizeLogo(view.logo)]);
    const bytes = await createInvoicePdf(view, { fonts, logo });
    const file = new File([bytes], `${view.fileName}.pdf`, { type: 'application/pdf' });
    const url = URL.createObjectURL(file);
    // 1. herunterladen …
    el('a', { href: url, download: file.name }).click();
    // 2. … und gleich öffnen
    if (tab && !tab.closed) tab.location.href = url;
    toast(`${file.name} gespeichert`, { label: 'Öffnen', run: () => window.open(url, '_blank') });
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (err) {
    tab?.close();
    console.error(err);
    toast('Das PDF konnte nicht erstellt werden. Bitte die Seite neu laden und erneut versuchen.');
  } finally {
    pdfBusy = false;
    document.documentElement.classList.remove('pdf-busy');
  }
}

async function exportXml() {
  if (!checkBeforeExport('xml')) return;
  if (!(await confirmFinalize('xml'))) return;
  markCreated();
  const xml = toXRechnung(invoice(), invSettings());
  const a = el('a', { href: URL.createObjectURL(new Blob([xml], { type: 'application/xml' })), download: `${invoice().number}.xml` });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('E-Rechnung (XRechnung 3.0) heruntergeladen');
}

$('#export-pdf').addEventListener('click', exportPdf);
$('#export-xml').addEventListener('click', exportXml);
$('#save-draft').addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  renderSaveState(true);
  toast(`${invoice().number} als Entwurf gespeichert`);
  openArchive();
});

// ---------- Vorschau ----------
const preview = $('#preview');

/**
 * Logo in exakter Originalform: Breite und Höhe werden aus dem Seitenverhältnis berechnet
 * (passt in 55 × 24 mm, wie im PDF) – kein Zuschneiden, kein Verzerren.
 */
const logoSizes = new Map();
function sizeLogo(img, w, h) {
  const scale = Math.min(55 / w, 24 / h);
  img.style.width = `${(w * scale).toFixed(2)}mm`;
  img.style.height = `${(h * scale).toFixed(2)}mm`;
}
function logoImage(src, alt) {
  const img = el('img', { className: 'inv-logo', src, alt: alt || 'Logo' });
  const known = logoSizes.get(src);
  if (known) sizeLogo(img, ...known);
  else {
    img.style.visibility = 'hidden';
    img.addEventListener('load', () => {
      const size = [img.naturalWidth || 300, img.naturalHeight || 150];
      logoSizes.set(src, size);
      sizeLogo(img, ...size);
      img.style.visibility = '';
    }, { once: true });
  }
  return img;
}

/** GiroCode als SVG aus dem Modul-Raster (2 Module Ruhezone rundherum). */
function giroCodeSvg(modules) {
  const n = modules.length;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (modules[r][c]) d += `M${c} ${r}h1v1h-1z`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `-2 -2 ${n + 4} ${n + 4}`);
  svg.setAttribute('class', 'giro-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'GiroCode zum Bezahlen');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x: -2, y: -2, width: n + 4, height: n + 4, fill: '#fff' }).forEach(([k, v]) => bg.setAttribute(k, v));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}

/** Gewähltes Rechnungsdesign – ältere Speicherstände ohne Design bekommen den Standard. */
function design(source = settings()) {
  const d = source.design ?? {};
  return { color: normalizeHex(d.color) ?? DEFAULT_COLOR, head: d.head === 'light' ? 'light' : 'filled' };
}

/** Überträgt die abgeleiteten Farbtöne als CSS-Variablen auf ein Element (Blatt oder Muster). */
function applyDesign(target, source = settings()) {
  const { color, head } = design(source);
  const t = invoiceTheme(color);
  const vars = { '--ink': t.text, '--ink-fill': t.accent, '--ink-on': t.onAccent, '--ink-soft': t.soft, '--ink-line': t.line };
  for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, v);
  target.classList.toggle('head-light', head === 'light');
}

function renderPreview() {
  const inv = invoice();
  applyDesign(preview, invSettings(inv));
  const v = currentView(inv);

  const rows = v.rows.map((r) => el('tr', {},
    el('td', { className: 'pos', textContent: r.pos }),
    el('td', {},
      el('strong', { textContent: r.description }),
      ...r.details.map((d) => el('span', { className: 'inv-details', textContent: d }))),
    el('td', { className: 'num', textContent: r.quantity }),
    el('td', { className: 'num', textContent: r.price }),
    v.showTax ? el('td', { className: 'num', textContent: r.tax }) : null,
    el('td', { className: 'num', textContent: r.total })));

  const sums = v.sums
    ? v.sums.map((x) => el('tr', { className: x.grand ? 'grand' : '' }, el('td', { textContent: x.label }), el('td', { className: 'num', textContent: x.value })))
    : [el('tr', {}, el('td', { colSpan: 2, textContent: 'Bitte gültige Beträge eingeben.' }))];

  let qr = v.qr ? el('figure', { className: 'inv-qr' }, giroCodeSvg(v.qr), el('figcaption', { textContent: v.qrCaption })) : null;
  // GiroCode gewünscht, aber IBAN fehlt/ungültig → sichtbarer Hinweis (nur am Bildschirm, nie im PDF)
  if (v.qrMissing) {
    qr = el('button', { type: 'button', className: 'inv-qr-missing', onclick: () => openSettings('company.iban') },
      icon('alert'),
      el('strong', { textContent: 'GiroCode fehlt' }),
      el('span', { textContent: v.qrMissing.invalid ? 'IBAN ungültig – hier korrigieren' : 'IBAN eintragen, dann erscheint er hier' }));
  }

  preview.replaceChildren(...[
    el('header', { className: 'inv-head' },
      el('h2', { className: 'inv-title', textContent: v.title }),
      v.logo
        ? logoImage(v.logo, v.companyName)
        : el('div', { className: 'inv-brand', textContent: v.brand })),
    el('p', { className: 'inv-return', textContent: v.sender }),
    el('div', { className: 'inv-address-row' },
      el('div', { className: 'inv-recipient' },
        el('strong', { textContent: v.recipient.name }),
        el('p', {}, ...multiline(v.recipient.address))),
      el('dl', { className: 'inv-meta' }, ...v.meta.flatMap(([dt, dd]) => [el('dt', { textContent: dt }), el('dd', { textContent: dd })]))),
    v.intro && el('p', { className: 'inv-intro', textContent: v.intro }),
    el('table', { className: 'inv-items' },
      el('thead', {}, el('tr', {},
        el('th', { className: 'pos', textContent: 'Pos.' }), el('th', { textContent: 'Beschreibung' }),
        el('th', { className: 'num col-qty', textContent: 'Menge' }), el('th', { className: 'num col-price', textContent: 'Einzelpreis' }),
        v.showTax ? el('th', { className: 'num col-tax', textContent: 'USt' }) : null,
        el('th', { className: 'num col-total', textContent: 'Betrag' }))),
      el('tbody', {}, ...rows)),
    el('table', { className: 'inv-sum' }, el('tbody', {}, ...sums)),
    v.kuNote && el('p', { className: 'inv-note', textContent: v.kuNote }),
    (v.payTexts.length || qr) && el('div', { className: 'inv-pay' },
      el('div', {}, ...v.payTexts.map((t) => el('p', { textContent: t }))),
      qr),
    v.note && el('p', { className: 'inv-note', textContent: v.note }),
    el('div', { className: 'inv-body-end', ariaHidden: 'true' }),
    el('footer', { className: 'inv-foot' },
      ...v.footer.map((col) => el('div', {}, ...col.flatMap((line, i) => [i ? el('br') : null, line.bold ? el('strong', { textContent: line.text }) : line.text])))),
  ].filter(present));
}

// ---------- Kopfzeile, Speicherstatus ----------
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
function renderTitle() {
  const inv = invoice();
  $('#doc-title').replaceChildren(...(inv.number ? [el('span', { className: 'title-prefix', textContent: 'Rechnung ' }), inv.number] : ['Neue Rechnung']));
  renderSaveState(false);
}
function renderSaveState(justSaved) {
  const inv = invoice();
  if (isLocked(inv)) {
    $('#save-state').textContent = `Abgeschlossen${inv.lockedAt ? ` am ${dateFmt.format(new Date(inv.lockedAt - new Date().getTimezoneOffset() * 60000))}` : ''} · nicht mehr änderbar`;
    return;
  }
  $('#save-state').textContent = justSaved ? `Entwurf · gespeichert um ${timeFmt.format(new Date())}` : 'Entwurf · wird automatisch gespeichert';
}

function update() {
  let totals = null;
  try { totals = calculateTotals(invoice().items, { kleinunternehmer: invSettings().kleinunternehmer, discount: invoice().discount }); } catch { /* ungültige Eingabe */ }
  renderPreview();
  applyLock();
  renderFieldErrors();
  renderTitle();
  $('#sumbar-total').textContent = totals ? formatEUR(totals.gross) : '–';
  renderOnboarding();
  if ($('#settings').open) renderCompanyStatus();
  save();
}

// ---------- Ansicht (mobil: Bearbeiten / Vorschau) ----------
function switchView(view) {
  layout.dataset.view = view;
  $$('.view-switch .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  applyZoom();
  $('#scroller').scrollTo({ top: 0 });
}
$$('.view-switch .tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));

// ---------- Vorschau-Zoom (Desktop) ----------
const PAPER_W = 794;
const PAPER_H = 1123;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const desktop = matchMedia('(min-width: 1101px)');
const paperFit = $('#paper-fit');
let manualZoom = null;

function fitScale() {
  const pad = 32;
  const w = paperFit.clientWidth - pad;
  const h = paperFit.clientHeight - pad;
  if (w <= 0) return 1;
  return desktop.matches ? Math.min(w / PAPER_W, h / PAPER_H) : Math.min(1, paperFit.clientWidth / PAPER_W);
}
function applyZoom(anchor) {
  const fit = fitScale();
  const zoom = desktop.matches && manualZoom !== null ? manualZoom : fit;
  const prev = parseFloat(preview.style.getPropertyValue('--paper-zoom')) || zoom;
  const ax = anchor ? anchor.x + paperFit.scrollLeft : 0;
  const ay = anchor ? anchor.y + paperFit.scrollTop : 0;
  preview.style.setProperty('--paper-zoom', zoom.toFixed(4));
  paperFit.classList.toggle('is-zoomed', desktop.matches && zoom > fit + 0.001);
  const pct = `${Math.round((zoom / fit) * 100)} %`; // „Ganze Seite“ = 100 %
  $('#zoom-fit').textContent = pct;
  $('#zoom-fit').setAttribute('aria-label', `${pct} – ganze Seite anzeigen`);
  $('#zoom-fit').classList.toggle('is-fit', manualZoom === null);
  $('#zoom-out').disabled = zoom <= ZOOM_MIN + 0.001;
  $('#zoom-in').disabled = zoom >= ZOOM_MAX - 0.001;
  if (anchor) {
    const ratio = zoom / prev;
    paperFit.scrollLeft = ax * ratio - anchor.x;
    paperFit.scrollTop = ay * ratio - anchor.y;
  }
}
function setZoom(value, anchor) {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  manualZoom = Math.abs(clamped - fitScale()) < 0.02 ? null : clamped;
  applyZoom(anchor);
}
const currentZoom = () => parseFloat(preview.style.getPropertyValue('--paper-zoom')) || fitScale();
$('#zoom-in').addEventListener('click', () => setZoom(currentZoom() * 1.2));
$('#zoom-out').addEventListener('click', () => setZoom(currentZoom() / 1.2));
$('#zoom-fit').addEventListener('click', () => { manualZoom = null; applyZoom(); paperFit.scrollTo({ top: 0, left: 0 }); });
paperFit.addEventListener('wheel', (e) => {
  if (!desktop.matches || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const rect = paperFit.getBoundingClientRect();
  const delta = Math.max(-20, Math.min(20, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
  setZoom(currentZoom() * Math.exp(-delta * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top });
}, { passive: false });
let gestureStart = 1;
paperFit.addEventListener('gesturestart', (e) => { if (!desktop.matches) return; e.preventDefault(); gestureStart = currentZoom(); });
paperFit.addEventListener('gesturechange', (e) => { if (!desktop.matches) return; e.preventDefault(); setZoom(gestureStart * e.scale); });
const topbar = $('.topbar');
new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${topbar.offsetHeight}px`)).observe(topbar);
new ResizeObserver(() => applyZoom()).observe(paperFit);
desktop.addEventListener('change', () => { manualZoom = null; applyZoom(); });

// ---------- Seitenfenster ----------
function openDrawer(dialog) {
  dialog.showModal();
  document.documentElement.classList.add('scroll-locked');
}
for (const d of $$('dialog.drawer')) {
  d.addEventListener('close', () => document.documentElement.classList.remove('scroll-locked'));
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}

// Rechnungsarchiv
function renderArchive() {
  const list = $('#invoice-list');
  const sorted = [...store.invoices].sort((a, b) => b.updatedAt - a.updatedAt);
  list.replaceChildren(...sorted.map((inv) => {
    let gross = '–';
    try { gross = formatEUR(calculateTotals(inv.items, { kleinunternehmer: invSettings(inv).kleinunternehmer, discount: inv.discount }).gross); } catch { /* ungültig */ }
    const isCurrent = inv.id === store.currentId;
    return el('li', { className: `invoice-row${isCurrent ? ' is-current' : ''}` },
      el('button', { type: 'button', className: 'invoice-open', onclick: () => openInvoice(inv.id) },
        el('span', { className: 'invoice-number mono', textContent: inv.number || 'Ohne Nummer' }),
        el('span', { className: 'invoice-customer', textContent: inv.customer.name || 'Kein Kunde' }),
        el('span', { className: 'invoice-date', textContent: formatDate(inv.date) })),
      el('span', { className: 'invoice-amount mono', textContent: gross }),
      el('span', { className: `badge badge-${inv.status}` }, isLocked(inv) ? icon('lock') : '', isLocked(inv) ? 'Abgeschlossen' : 'Entwurf'),
      el('div', { className: 'invoice-actions' },
        el('button', { type: 'button', className: 'icon-btn', title: 'Duplizieren', ariaLabel: `${inv.number} duplizieren`, onclick: () => duplicateInvoice(inv.id) }, icon('copy')),
        el('button', {
          type: 'button', className: 'icon-btn danger', disabled: isLocked(inv),
          title: isLocked(inv) ? 'Abgeschlossene Rechnungen bleiben erhalten (Aufbewahrungspflicht)' : 'Löschen',
          ariaLabel: isLocked(inv) ? `${inv.number} ist abgeschlossen und kann nicht gelöscht werden` : `${inv.number} löschen`,
          onclick: () => deleteInvoice(inv.id),
        }, icon('trash'))));
  }));
}
function openArchive() { renderArchive(); openDrawer($('#archive')); }
$('#open-archive').addEventListener('click', openArchive);

function openInvoice(id) {
  store.currentId = id;
  resetEditorState();
  $('#archive').close();
}
function resetEditorState() {
  touched.clear();
  showAllErrors = false;
  exportMode = 'pdf';
  collapsedItems.clear();
  fillForm();
  setStep(1);
  update();
}
$('#new-invoice').addEventListener('click', () => {
  const inv = newInvoice();
  store.invoices.push(inv);
  openInvoice(inv.id);
  toast(`${inv.number} angelegt`);
  $('[data-field="customer.name"]').focus();
});
function duplicateInvoice(id) {
  const source = store.invoices.find((i) => i.id === id);
  const copy = copyAsDraft(source, { id: newId(), number: newInvoice().number, date: today() });
  store.invoices.push(copy);
  openInvoice(copy.id);
  toast(`Kopie als ${copy.number} angelegt`);
}
function deleteInvoice(id) {
  if (isLocked(store.invoices.find((i) => i.id === id))) return; // Aufbewahrungspflicht
  const before = structuredClone(store);
  store.invoices = store.invoices.filter((i) => i.id !== id);
  if (!store.invoices.length) store.invoices.push(newInvoice());
  if (!store.invoices.some((i) => i.id === store.currentId)) store.currentId = store.invoices[0].id;
  resetEditorState();
  renderArchive();
  toast('Rechnung gelöscht', { label: 'Rückgängig', run: () => { store = before; resetEditorState(); renderArchive(); } });
}

// Einstellungen
const settingsForm = $('#settings-form');
function fillSettings() {
  for (const input of $$('[data-setting]', settingsForm)) {
    const value = getPath(settings(), input.dataset.setting);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  }
  renderLogo();
  closeWheel();
  renderDesign();
  renderCustomerList();
  renderCompanyStatus();
}

// Rechnungsdesign: Farbfelder, Farbrad (eigene Farbe), Hex-Feld und Tabellenkopf
const swatchBox = $('#swatches');
const customSwatch = $('#swatch-custom');
swatchBox.prepend(...PRESET_COLORS.map(({ hex, name }) => {
  const b = el('button', { type: 'button', className: 'swatch', title: name });
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', name);
  b.dataset.color = hex;
  b.style.setProperty('--swatch', hex);
  return b;
}));

function renderDesign() {
  const { color, head } = design();
  const preset = PRESET_COLORS.some((p) => p.hex === color);
  for (const b of $$('.swatch[data-color]', swatchBox)) {
    const on = b.dataset.color === color;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on || (!preset && b === swatchBox.firstElementChild) ? 0 : -1;
  }
  customSwatch.classList.toggle('is-active', !preset);
  customSwatch.style.setProperty('--swatch', preset ? 'transparent' : color);
  const hexInput = $('#hex-input');
  if (document.activeElement !== hexInput) { hexInput.value = color; hexInput.classList.remove('is-invalid'); }
  $('#hex-dot').style.background = color;
  for (const chip of $$('#head-chips .chip')) {
    const on = chip.dataset.head === head;
    chip.classList.toggle('is-active', on);
    chip.setAttribute('aria-checked', String(on));
  }
  $('#design-reset').hidden = color === DEFAULT_COLOR && head === 'filled';
  applyDesign($('#design-sample'));
}

function setDesign(patch) {
  settings().design = { ...design(), ...patch };
  renderDesign();
  update();
}

swatchBox.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch[data-color]');
  if (b) { closeWheel(); setDesign({ color: b.dataset.color }); }
});

// Eigenes Farbrad statt des Browser-Farbwählers (der sieht z. B. auf Android völlig anders aus).
// Farbton = Winkel, Sättigung = Abstand zur Mitte, Helligkeit = Regler daneben.
const wheelPanel = $('#wheel-panel');
const wheel = $('#wheel');
const wheelHandle = $('#wheel-handle');
let wheelState = null; // { h, s, v, before }

function renderWheel() {
  const { h, s, v } = wheelState;
  const hex = hsvToHex(h, s, v);
  const rad = (h * Math.PI) / 180;
  wheelHandle.style.left = `${50 + Math.cos(rad) * s * 50}%`;
  wheelHandle.style.top = `${50 + Math.sin(rad) * s * 50}%`;
  wheelHandle.style.background = hex;
  wheelHandle.setAttribute('aria-valuetext', hex);
  const range = $('#wheel-value');
  range.value = String(Math.round(v * 100));
  range.style.setProperty('--range-to', hsvToHex(h, s, 1));
  $('#wheel-swatch').style.background = hex;
  $('#wheel-hex').textContent = hex;
}
function setWheel(patch) {
  Object.assign(wheelState, patch);
  renderWheel();
  setDesign({ color: hsvToHex(wheelState.h, wheelState.s, wheelState.v) });
}
function openWheel() {
  const { color } = design();
  wheelState = { ...hexToHsv(color), before: color };
  wheelPanel.hidden = false;
  customSwatch.setAttribute('aria-expanded', 'true');
  renderWheel();
  wheelPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function closeWheel(restore = false) {
  if (!wheelState) return;
  if (restore) setDesign({ color: wheelState.before });
  wheelState = null;
  wheelPanel.hidden = true;
  customSwatch.setAttribute('aria-expanded', 'false');
}
customSwatch.addEventListener('click', () => (wheelState ? closeWheel() : openWheel()));
$('#wheel-apply').addEventListener('click', () => { closeWheel(); customSwatch.focus(); });
$('#wheel-cancel').addEventListener('click', () => { closeWheel(true); customSwatch.focus(); });
$('#wheel-value').addEventListener('input', (e) => setWheel({ v: Number(e.target.value) / 100 }));

function pickFromWheel(e) {
  const r = wheel.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
  // Das Rad zeigt die Farben in voller Leuchtkraft. Wer bei sehr dunkler Helligkeit hineintippt,
  // will die angetippte Farbe sehen – daher auf einen kräftigen, gut druckbaren Wert anheben.
  setWheel(wheelState.v < 0.4 ? { h, s, v: 0.75 } : { h, s });
}
wheel.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  wheel.setPointerCapture(e.pointerId);
  wheelHandle.focus({ preventScroll: true });
  pickFromWheel(e);
});
wheel.addEventListener('pointermove', (e) => { if (wheel.hasPointerCapture(e.pointerId)) pickFromWheel(e); });
wheelHandle.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 15 : 4;
  const moves = {
    ArrowRight: { h: wheelState.h + step }, ArrowLeft: { h: wheelState.h - step },
    ArrowUp: { s: Math.min(1, wheelState.s + step / 100) }, ArrowDown: { s: Math.max(0, wheelState.s - step / 100) },
  };
  if (!moves[e.key]) return;
  e.preventDefault();
  const next = { ...moves[e.key] };
  if ('h' in next) next.h = (next.h + 360) % 360;
  setWheel(next);
});
swatchBox.addEventListener('keydown', (e) => {
  const list = $$('.swatch[data-color]', swatchBox);
  const i = list.indexOf(document.activeElement);
  if (i < 0 || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const next = list[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
  next.focus();
  setDesign({ color: next.dataset.color });
});
$('#hex-input').addEventListener('input', (e) => {
  const hex = normalizeHex(e.target.value);
  e.target.classList.toggle('is-invalid', !hex && e.target.value.trim().length >= 4);
  if (!hex) return;
  setDesign({ color: hex });
  if (wheelState) { Object.assign(wheelState, hexToHsv(hex)); renderWheel(); }
});
$('#hex-input').addEventListener('blur', () => renderDesign());
$('#head-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-head]');
  if (chip) setDesign({ head: chip.dataset.head });
});
$('#design-reset').addEventListener('click', () => { closeWheel(); setDesign({ color: DEFAULT_COLOR, head: 'filled' }); });

function renderCompanyStatus() {
  const missing = companyMissing().length;
  const status = $('#company-status');
  status.textContent = missing ? (missing === 1 ? '1 Angabe fehlt oder ist ungültig' : `${missing} Angaben fehlen oder sind ungültig`) : 'Vollständig';
  status.classList.toggle('is-ok', !missing);
}
function openSettings(focusField) {
  fillSettings();
  if (focusField) touched.add(focusField); // Fehler am Zielfeld sofort zeigen (z. B. ungültige IBAN)
  renderFieldErrors();
  openDrawer($('#settings'));
  if (focusField) {
    const input = $(`[data-setting="${focusField}"]`, settingsForm);
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  }
}
$('#open-settings').addEventListener('click', () => openSettings());

settingsForm.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.dataset.setting) return;
  setPath(settings(), t.dataset.setting, t.type === 'checkbox' ? t.checked : t.value);
  if (t.dataset.setting === 'kleinunternehmer') renderItems();
  if (step === 3) renderBankSummary();
  update();
});

function renderLogo() {
  const logo = settings().company.logo;
  const box = $('#logo-preview');
  box.replaceChildren(logo ? el('img', { src: logo, alt: 'Aktuelles Logo' }) : icon('image'));
  $('#logo-remove').hidden = !logo;
  $('#logo-btn-text').textContent = logo ? 'Ändern' : 'Hochladen';
}
$('#logo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { toast('Bitte ein Bild im Format PNG, JPG, SVG oder WebP wählen.'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Das Bild ist größer als 5 MB.'); return; }
  try {
    settings().company.logo = await shrinkImage(file);
    renderLogo();
    update();
    toast('Logo übernommen');
  } catch {
    toast('Das Bild konnte nicht gelesen werden.');
  }
});
$('#logo-remove').addEventListener('click', () => { settings().company.logo = ''; renderLogo(); update(); });

/** Verkleinert Logos auf max. 600 × 240 px, damit sie in den lokalen Speicher passen. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      if (file.type === 'image/svg+xml') {
        if (file.size > 300 * 1024) { reject(new Error('SVG zu groß')); return; }
        resolve(reader.result);
        return;
      }
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 600 / img.width, 240 / img.height);
        const canvas = el('canvas', { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderCustomerList() {
  const list = $('#customer-list');
  list.replaceChildren(...(store.customers.length
    ? store.customers.map((c) => el('li', {},
      el('span', {}, el('strong', { textContent: c.name }), el('small', { textContent: [c.zip, c.city].filter(Boolean).join(' ') || c.email })),
      el('button', {
        type: 'button', className: 'icon-btn danger', title: 'Kunde entfernen', ariaLabel: `${c.name} entfernen`,
        onclick: () => {
          store.customers = store.customers.filter((x) => x.id !== c.id);
          renderCustomerList(); renderCustomerSelect(); save();
        },
      }, icon('trash'))))
    : [el('li', { className: 'empty', textContent: 'Noch keine Kunden gespeichert.' })]));
}

function replaceStore(next, message) {
  const before = structuredClone(store);
  store = normalize(next);
  fillSettings();
  resetEditorState();
  toast(message, { label: 'Rückgängig', run: () => { store = before; fillSettings(); resetEditorState(); } });
}
$('#load-demo').addEventListener('click', () => replaceStore(demo(), 'Beispieldaten geladen'));
$('#reset-all').addEventListener('click', () => replaceStore(seed(), 'Alle Daten gelöscht'));

// ---------- Hinweis: eigene Firmendaten eintragen ----------
function renderOnboarding() {
  const missing = companyMissing().length > 0;
  $('#onboarding').hidden = !missing;
  $('#open-settings').classList.toggle('needs-setup', missing);
}
$('#onboarding-btn').addEventListener('click', () => openSettings(companyMissing()[0]?.field ?? 'company.name'));
$('#export-xml-bar').addEventListener('click', exportXml);

// ---------- Design ----------
const themeBtn = $('#theme-btn');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  themeBtn.setAttribute('aria-label', theme === 'dark' ? 'Helles Design einschalten' : 'Dunkles Design einschalten');
  themeBtn.title = theme === 'dark' ? 'Helles Design' : 'Dunkles Design';
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#0C0D0F' : '#FFFFFF';
}
applyTheme(document.documentElement.dataset.theme);
themeBtn.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, nextTheme); } catch { /* ignorieren */ }
  applyTheme(nextTheme);
});

// ---------- Toast ----------
let toastTimer;
function toast(message, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { textContent: message }));
  t.style.pointerEvents = action ? 'auto' : 'none';
  if (action) t.append(el('button', { type: 'button', className: 'toast-action', textContent: action.label, onclick: () => { action.run(); t.classList.remove('show'); } }));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 3000);
}

// ---------- Start ----------
fillForm();
setStep(1);
update();
