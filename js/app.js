/**
 * Hauptansicht: Formular in drei Schritten, Leistungen, Prüfmeldungen, Vorschau und Export.
 * Fachlogik liegt in invoice.js (ohne DOM), Datenhaltung in store.js, Seitenfenster in *-panel.js.
 */
import {
  UNITS, TAX_TYPES, TAX_TYPE_GROUPS, CURRENCIES, countryOptions, kindOf, isLocked, finalizeInvoice, checkInvoice, isError,
  validateXRechnungFields, validateInvoiceFields, toXRechnung, toPriceUnits, priceToInput, convertPrice, toCents, centsToInput,
  lineNet, formatMoney, formatDate, dueDate, addDays, isValidIBAN, formatIBAN, taxKeyOf, parseScaled, todayIso,
} from './invoice.js?v=27';
import { $, $$, el, icon, getPath, setPath, fillSelect, toast, ask, prefersReducedMotion } from './ui.js?v=27';
import {
  state, settings, invoice, invSettings, validationContext, totalsOf, design, emptyCustomer, emptyItem, newId, save, persist, requestPersistentStorage,
} from './store.js?v=27';
import { renderPreview, setupZoom } from './preview.js?v=27';
import { viewOf, buildDocuments, storeOriginal, originalOf, openPendingTab, deliverPdf, deliverXml } from './export.js?v=27';
import { saveOriginal } from './originals.js?v=27';
import { initSettingsPanel } from './settings-panel.js?v=27';
import { initArchivePanel } from './archive-panel.js?v=27';
import { attachAddressLookup, locatePlace } from './address.js?v=27';
import { fetchRate } from './fx.js?v=27';

const form = $('#invoice-form');
const itemsBox = $('#items');
const layout = $('.layout');
const paper = $('#preview');
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

// ---------- Auswahllisten ----------
fillSelect($('#customer-country'), countryOptions().map((g) => ({ label: g.label, options: g.options.map((c) => ({ value: c.code, text: c.name })) })));
fillSelect($('#currency-select'), CURRENCIES.map((c) => ({ value: c, text: c === 'EUR' ? 'Euro (EUR)' : c })));
const taxOptions = TAX_TYPE_GROUPS.map((g) => ({ label: g.label, options: g.keys.map((k) => ({ value: k, text: TAX_TYPES[k].label })) }));

// ---------- Schritte ----------
let step = 1;
const STEP_FIELDS = {
  1: (f) => f.startsWith('customer.') || f.startsWith('reference.') || ['number', 'date', 'dueDate', 'serviceFrom', 'serviceTo', 'kind', 'currency', 'fxRate'].includes(f),
  2: (f) => f.startsWith('items') || f.startsWith('discount') || f === 'exemptionReason',
};
const stepOf = (field) => (field.startsWith('company.') ? 'settings' : STEP_FIELDS[1](field) ? 1 : STEP_FIELDS[2](field) ? 2 : 3);

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
  if (last) renderBankSummary();
  $('#scroller').scrollTo?.({ top: 0 });
  $('.editor').scrollTo?.({ top: 0 });
}

function next() {
  if (step === 3) { exportDocument('pdf'); return; }
  const errors = currentIssues().filter((e) => isError(e) && stepOf(e.field) === step);
  if (errors.length) {
    errors.forEach((e) => touched.add(e.field));
    renderFieldErrors();
    goToField(errors[0].field);
    toast(errors.length === 1 ? 'Bitte das rot markierte Feld prüfen.' : `Bitte die ${errors.length} rot markierten Felder prüfen.`);
    return;
  }
  setStep(step + 1);
}
$$('.step').forEach((b) => b.addEventListener('click', () => setStep(Number(b.dataset.step))));
$('#next-step').addEventListener('click', next);
$('#sumbar-action').addEventListener('click', next);
$('#prev-step').addEventListener('click', () => setStep(step - 1));

// ---------- Formular füllen ----------
function fillForm() {
  const inv = invoice();
  for (const input of $$('[data-field]', form)) {
    const value = getPath(inv, input.dataset.field);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? (input.tagName === 'SELECT' ? input.options[0]?.value ?? '' : '');
  }
  customerLookup.reset();
  renderCustomerSelect();
  renderKind();
  renderPaymentChips();
  renderServiceChips();
  renderCurrency();
  if ((inv.currency || 'EUR') !== 'EUR' && !inv.fxRate && !isLocked(inv)) refreshRate();
  renderPriceMode();
  renderItems();
  renderPrepayments();
  $('#skonto-fields').hidden = !inv.skonto?.enabled;
  renderBankSummary();
  applyLock();
}

/**
 * Abgeschlossene Rechnung: alle Eingaben gesperrt, Hinweis oben, Korrektur über Storno oder Kopie.
 * Steuerelemente mit [data-keep] (Export, Kopie anlegen) bleiben bedienbar.
 */
function applyLock() {
  const inv = invoice();
  const locked = isLocked(inv);
  $('.editor').classList.toggle('is-locked', locked);
  $('#locked-note').hidden = !locked;
  $('#locked-storno').hidden = kindOf(inv).key === 'storno';
  $('#save-draft').hidden = locked;
  const controls = $$('.step-panel input, .step-panel select, .step-panel textarea, .step-panel button, .price-mode button').filter((c) => !c.closest('[data-keep]') && !('keep' in c.dataset));
  if (locked) {
    for (const c of controls) if (!c.disabled) { c.disabled = true; c.dataset.locked = ''; }
  } else if (controls.some((c) => 'locked' in c.dataset)) {
    for (const c of controls) if ('locked' in c.dataset) { c.disabled = false; delete c.dataset.locked; }
    renderBankSummary(); // GiroCode-Schalter wieder nach IBAN richten
    renderItems();
  }
  renderCustomerLock();
}
$('#locked-copy').addEventListener('click', () => archive.duplicate(invoice().id));

/** Gespeicherte Kunden werden nur in den Einstellungen bearbeitet – in der Rechnung sind ihre Felder gesperrt. */
const isSavedCustomer = (k) => Boolean(k?.id) && state.store.customers.some((c) => c.id === k.id);
function renderCustomerLock() {
  const inv = invoice();
  const saved = isSavedCustomer(inv.customer);
  const locked = isLocked(inv);
  for (const input of $$('[data-field^="customer."]', form)) {
    if ('locked' in input.dataset) continue; // abgeschlossene Rechnung: applyLock entscheidet
    input.disabled = saved;
  }
  $('#save-customer-switch').hidden = saved;
  $('#saved-customer').hidden = !saved || locked;
}
$('#edit-customer').addEventListener('click', () => settingsPanel.openCustomer(invoice().customer.id));
$('#locked-storno').addEventListener('click', () => archive.storno(invoice().id));

form.addEventListener('input', (e) => {
  const t = e.target;
  const key = t.dataset.field;
  if (!key) return;
  const inv = invoice();
  const value = t.type === 'checkbox' ? t.checked : key === 'skonto.days' ? Number(t.value) : t.value;
  setPath(inv, key, value);
  if (key === 'skonto.enabled') $('#skonto-fields').hidden = !t.checked;
  if (key === 'date' || key === 'dueDate') renderPaymentChips();
  if (key === 'kind') onKindChange();
  if (key === 'currency') Object.assign(inv, { fxRate: '', fxDate: '' }); // Kurs gehört zur Währung: nie den alten weiterverwenden
  if (key === 'currency' || key === 'date') { inv.fxManual = false; refreshRate(); }
  if (key === 'fxRate') { inv.fxManual = true; inv.fxDate = ''; renderCurrency(); }
  if (key === 'customer.isPublic' && t.checked) touched.add('customer.reference');
  update();
});

// ---------- Dokumentart ----------
function renderKind() {
  const inv = invoice();
  const kind = kindOf(inv);
  $('#reference-fields').hidden = kind.key !== 'storno';
  $('#payment-terms').hidden = kind.key === 'storno';
  $('#prepayments-section').hidden = kind.key !== 'final';
  for (const sel of ['[data-field="skonto.enabled"]', '[data-field="giroCode"]']) $(sel).closest('.switch').hidden = kind.key === 'storno';
  $('#skonto-fields').hidden = kind.key === 'storno' || !inv.skonto?.enabled;
}
function onKindChange() {
  const inv = invoice();
  inv.reference ??= { number: '', date: '' };
  inv.prepayments ??= [];
  if (inv.kind === 'storno') Object.assign(inv, { paymentDays: 0, giroCode: false, skonto: { ...inv.skonto, enabled: false } });
  renderKind();
  renderPrepayments();
}

// ---------- Kunden ----------
function renderCustomerSelect() {
  const inv = invoice();
  const select = $('#customer-select');
  select.replaceChildren(
    el('option', { value: '', textContent: '＋ Neuer Kunde' }),
    ...state.store.customers.map((c) => el('option', { value: c.id, textContent: [c.name, c.city].filter(Boolean).join(' · ') })),
  );
  select.value = state.store.customers.some((c) => c.id === inv.customer.id) ? inv.customer.id : '';
  $('#save-customer').checked = state.store.customers.some((c) => c.id === inv.customer.id);
}
$('#customer-select').addEventListener('change', (e) => {
  const chosen = state.store.customers.find((c) => c.id === e.target.value);
  invoice().customer = chosen ? { ...emptyCustomer(), ...chosen } : emptyCustomer();
  fillForm();
  update();
  if (!chosen) $('[data-field="customer.name"]').focus();
});
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
    if (!state.store.customers.some((c) => c.id === k.id)) state.store.customers.push({ ...k });
    toast(`„${k.name}“ in der Kundenliste gespeichert`);
  } else {
    state.store.customers = state.store.customers.filter((c) => c.id !== k.id);
    toast('Aus der Kundenliste entfernt');
  }
  renderCustomerSelect();
  renderCustomerLock();
  settingsPanel.renderCustomerList();
  save(renderSaveState);
});

// ---------- Zahlungsfrist & Leistungsdatum ----------
function setChips(box, isActive) {
  for (const chip of $$('.chip', box)) {
    const active = isActive(chip);
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-checked', String(active));
  }
}
function renderPaymentChips() {
  const inv = invoice();
  setChips($('#payment-chips'), (chip) => String(inv.paymentDays) === chip.dataset.days);
  $('#due-custom').hidden = inv.paymentDays !== 'custom';
  let due = null;
  try { due = dueDate(inv); } catch { /* ungültiges Datum */ }
  $('#due-hint').textContent = due ? (due === inv.date ? 'Fällig sofort.' : `Fällig am ${formatDate(due)}.`) : '';
}
$('#payment-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const inv = invoice();
  inv.paymentDays = chip.dataset.days === 'custom' ? 'custom' : Number(chip.dataset.days);
  if (inv.paymentDays === 'custom' && !inv.dueDate && inv.date) { try { inv.dueDate = addDays(inv.date, 21); } catch { /* egal */ } }
  $('[data-field="dueDate"]').value = inv.dueDate;
  renderPaymentChips();
  update();
});

function renderServiceChips() {
  const mode = invoice().serviceMode ?? 'same';
  setChips($('#service-chips'), (chip) => chip.dataset.service === mode);
  $('#service-fields').hidden = mode === 'same';
  $('#service-to').hidden = mode !== 'period';
  $('#service-from-label').textContent = mode === 'period' ? 'Anfang' : 'Leistungsdatum';
}
$('#service-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const inv = invoice();
  inv.serviceMode = chip.dataset.service;
  if (inv.serviceMode === 'same') Object.assign(inv, { serviceFrom: '', serviceTo: '' });
  if (inv.serviceMode === 'date') inv.serviceTo = '';
  for (const k of ['serviceFrom', 'serviceTo']) $(`[data-field="${k}"]`).value = inv[k] ?? '';
  renderServiceChips();
  update();
  if (inv.serviceMode !== 'same') $('[data-field="serviceFrom"]').focus();
});

// ---------- Währung: EZB-Kurs automatisch zum Rechnungsdatum ----------
let rateRequest = 0;
function validRate(value) {
  try { return parseScaled(value, 6, 'Kurs') > 0n; } catch { return false; }
}
function renderCurrency(status) {
  const inv = invoice();
  const cur = inv.currency || 'EUR';
  const foreign = cur !== 'EUR';
  $('#fx-field').hidden = !foreign;
  $('#fx-row').hidden = !foreign;
  $('#fx-label').textContent = `Kurs: 1 ${cur} = … EUR`;
  const input = $('[data-field="fxRate"]');
  if (document.activeElement !== input) input.value = inv.fxRate ?? '';
  input.readOnly = !inv.fxManual; // automatisch geladene Kurse nicht versehentlich überschreiben
  $('#fx-status').textContent = status
    ?? (inv.fxManual ? 'Kurs manuell eingetragen.' : inv.fxDate ? `EZB-Referenzkurs vom ${formatDate(inv.fxDate)}.` : '');
  $('#fx-reload').hidden = !foreign || isLocked(inv);
  if (foreign) $('#currency-more').open = true;
  renderBankSummary();
}
/** Kurs für Währung und Rechnungsdatum laden (nur Entwürfe; abgeschlossene Rechnungen behalten ihren Kurs). */
async function refreshRate() {
  const inv = invoice();
  const cur = inv.currency || 'EUR';
  if (isLocked(inv) || cur === 'EUR') { renderCurrency(); return; }
  const token = ++rateRequest;
  renderCurrency('Kurs wird geladen …');
  try {
    const { rate, date } = await fetchRate(cur, inv.date, { today: todayIso() });
    if (token !== rateRequest || invoice() !== inv) return;
    Object.assign(inv, { fxRate: rate, fxDate: date, fxManual: false });
    renderCurrency();
    update();
  } catch {
    if (token !== rateRequest || invoice() !== inv) return;
    Object.assign(inv, { fxManual: true, fxDate: '' });
    renderCurrency('Kurs konnte nicht geladen werden. Bitte manuell eintragen.');
    update();
  }
}
$('#fx-reload').addEventListener('click', () => { invoice().fxManual = false; refreshRate(); });

// ---------- Adressvorschläge (Straße → PLZ + Ort, PLZ → Ort): abschaltbar in den Einstellungen ----------
const lookupEnabled = () => settings().addressLookup !== false;
// Standort nur mit Einwilligung (DSGVO Art. 6 Abs. 1 lit. a): erst eigener Hinweis, dann die Abfrage des Browsers.
// Genutzt wird ein auf ca. 1 km gerundeter Punkt, nur im Arbeitsspeicher: er wird nie gespeichert.
const geoSupported = 'geolocation' in navigator && window.isSecureContext;
let geoPosition = null; // { lat, lon, at }
let geoDenied = false;
const GEO_MAX_AGE = 15 * 60 * 1000;

/**
 * Standort lesen. Der Browser-Timeout zählt erst, nachdem der Nutzer die Abfrage beantwortet hat – bleibt die
 * Nachfrage einfach offen, käme sonst nie ein Ergebnis. Daher eine eigene Obergrenze.
 */
function readPosition(limit = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('Zeitüberschreitung'), { code: 3 })), limit);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100, at: Date.now() }); },
      (err) => { clearTimeout(timer); reject(err); },
      { enableHighAccuracy: false, maximumAge: GEO_MAX_AGE, timeout: 10000 },
    );
  });
}
/** Entzieht der Nutzer die Freigabe im Browser, wird die Einstellung sofort mit ausgeschaltet. */
function watchGeoPermission() {
  navigator.permissions?.query({ name: 'geolocation' }).then((status) => {
    const apply = () => {
      if (status.state === 'denied' && settings().geoBias) {
        settings().geoBias = false;
        geoPosition = null;
        geoDenied = true;
        save(renderSaveState);
      }
      settingsPanel.syncGeoSwitch();
    };
    status.addEventListener('change', apply);
    apply();
  }).catch(() => {});
}
/** Holt den Standort: nur wenn eingewilligt und der Browser ihn ohne neue Nachfrage hergibt. */
async function quietPosition() {
  if (!geoSupported || !settings().geoBias || geoDenied) return null;
  if (geoPosition && Date.now() - geoPosition.at < GEO_MAX_AGE) return geoPosition;
  const status = await navigator.permissions?.query({ name: 'geolocation' }).then((r) => r.state).catch(() => 'prompt');
  if (status !== 'granted') return null; // nicht beim Tippen plötzlich nachfragen
  geoPosition = await readPosition().catch(() => null);
  return geoPosition;
}
/** Einwilligung einholen (Dialog), dann Browser-Freigabe. */
async function requestGeo({ askFirst = true } = {}) {
  if (!geoSupported) { toast('Dein Browser stellt keinen Standort bereit.'); return false; }
  if (askFirst && !settings().geoBias && (await ask($('#geo-consent'))) !== 'confirm') return false;
  try {
    geoPosition = await readPosition();
    geoDenied = false;
    settings().geoBias = true;
    toast('Straßen in deiner Nähe erscheinen jetzt zuerst');
    return true;
  } catch (err) {
    geoDenied = err?.code === 1;
    settings().geoBias = false;
    toast(geoDenied ? 'Standort im Browser nicht freigegeben. Die Vorschläge funktionieren trotzdem.' : err?.code === 3 ? 'Keine Standort-Freigabe erhalten. Der Schalter bleibt aus.' : 'Standort konnte nicht ermittelt werden.');
    return false;
  } finally {
    save(renderSaveState);
    settingsPanel.syncGeoSwitch();
  }
}
function revokeGeo() {
  settings().geoBias = false;
  geoPosition = null;
  save(renderSaveState);
  settingsPanel.syncGeoSwitch();
  toast('Standort wird nicht mehr genutzt');
}
/** Ohne Standort: der eigene Firmensitz als Bezugspunkt: Kunden kommen meist aus der Umgebung. */
const placeCache = new Map();
async function companyPlace(signal) {
  const { zip, city } = settings().company;
  if (!/^\d{5}$/.test(String(zip).trim()) || !String(city).trim()) return null;
  const key = `${zip} ${city}`;
  if (!placeCache.has(key)) placeCache.set(key, locatePlace(zip, city, signal).catch(() => { placeCache.delete(key); return null; }));
  return placeCache.get(key);
}
const nearby = { offer: () => geoSupported && !geoDenied, request: () => requestGeo({ askFirst: true }) };
const customerLookup = attachAddressLookup({
  street: $('[data-field="customer.street"]', form),
  zip: $('[data-field="customer.zip"]', form),
  city: $('[data-field="customer.city"]', form),
  // Vorschläge nur für deutsche Anschriften (die Dienste kennen nur deutsche PLZ)
  enabled: () => lookupEnabled() && !isLocked(invoice()) && (invoice().customer.country || 'DE') === 'DE',
  getBias: async (signal) => {
    const here = await quietPosition();
    if (here) return { ...here, near: true };
    const home = await companyPlace(signal);
    return home ? { ...home, near: false } : null;
  },
  nearby,
});
attachAddressLookup({
  street: $('[data-setting="company.street"]'),
  zip: $('[data-setting="company.zip"]'),
  city: $('[data-setting="company.city"]'),
  enabled: lookupEnabled,
  getBias: async () => { const here = await quietPosition(); return here ? { ...here, near: true } : null; },
  nearby,
});

// ---------- Leistungen ----------
const template = $('#item-template');
const collapsedItems = new Set();

function renderPriceMode() {
  const inv = invoice();
  const ku = invSettings(inv).kleinunternehmer;
  $('.price-mode').hidden = ku;
  setChips($('#price-chips'), (chip) => chip.dataset.gross === String(Boolean(inv.pricesGross)));
}
/** Netto ↔ Brutto umschalten: Preise und feste Positionsrabatte werden mit dem jeweiligen Steuersatz umgerechnet. */
$('#price-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  const inv = invoice();
  const toGross = chip?.dataset.gross === 'true';
  if (!chip || toGross === Boolean(inv.pricesGross)) return;
  for (const item of inv.items) {
    const rate = TAX_TYPES[taxKeyOf(item)]?.rate ?? 0;
    try { if (String(item.unitPrice).trim()) item.unitPrice = priceToInput(convertPrice(toPriceUnits(item.unitPrice), rate, toGross)); } catch { /* ungültig: unverändert */ }
    if (item.discount?.type === 'amount' && String(item.discount.value).trim()) {
      try { item.discount.value = centsToInput(Math.round(convertPrice(toCents(item.discount.value) * 100, rate, toGross) / 100)); } catch { /* unverändert */ }
    }
  }
  inv.pricesGross = toGross;
  renderPriceMode();
  renderItems();
  update();
  if (inv.discount?.type === 'amount' && String(inv.discount.value ?? '').trim()) toast(`Preise umgerechnet. Bitte den Gesamtrabatt prüfen, er gilt jetzt ${toGross ? 'brutto' : 'netto'}.`);
  else toast(`Preise in ${toGross ? 'Bruttopreise' : 'Nettopreise'} umgerechnet`);
});

function renderItems() {
  const inv = invoice();
  const ku = invSettings(inv).kleinunternehmer;
  const locked = isLocked(inv);
  itemsBox.replaceChildren(...inv.items.map((item, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.index = index;
    fillSelect(card.querySelector('[data-key="unit"]'), UNITS.map((u) => ({ value: u.code, text: u.label })));
    const tax = card.querySelector('[data-key="taxType"]');
    fillSelect(tax, ku ? [{ value: 'KU', text: 'keine USt (Kleinunternehmer)' }] : taxOptions);
    for (const input of $$('[data-key]', card)) input.value = input.dataset.key === 'taxType' ? (ku ? 'KU' : taxKeyOf(item)) : getPath(item, input.dataset.key) ?? '';
    tax.disabled = ku || locked;
    if (ku) tax.title = 'Als Kleinunternehmer wird keine Umsatzsteuer ausgewiesen';
    card.querySelector('.price-basis').textContent = ku ? '' : inv.pricesGross ? '(brutto)' : '(netto)';
    card.querySelector('.item-discount').hidden = !item.discount;
    card.querySelector('[data-action="add-discount"]').hidden = Boolean(item.discount);
    const collapsed = collapsedItems.has(item);
    card.classList.toggle('is-collapsed', collapsed);
    card.querySelector('.item-toggle').setAttribute('aria-expanded', String(!collapsed));
    card.querySelector('[data-action="remove"]').hidden = inv.items.length === 1;
    updateItemCard(card, item, index);
    return card;
  }));
  renderExemption();
  if (locked) for (const c of $$('input, select, textarea, button:not(.item-toggle)', itemsBox)) { c.disabled = true; c.dataset.locked = ''; }
}
function updateItemCard(card, item, index) {
  card.querySelector('.item-name').textContent = item.description.trim() || `Leistung ${index + 1}`;
  let total = '';
  try { total = formatMoney(lineNet(item), invoice().currency || 'EUR'); } catch { /* ungültige Eingabe */ }
  card.querySelector('.item-total').textContent = total;
}
function renderExemption() {
  const inv = invoice();
  $('#exemption-card').hidden = invSettings(inv).kleinunternehmer || !inv.items.some((i) => taxKeyOf(i) === 'E');
}

itemsBox.addEventListener('input', (e) => {
  const t = e.target;
  const card = t.closest('.item');
  if (!card || !t.dataset.key) return;
  const index = Number(card.dataset.index);
  const item = invoice().items[index];
  setPath(item, t.dataset.key, t.value);
  if (t.dataset.key === 'taxType') { delete item.taxRate; renderExemption(); }
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
  const last = inv.items.at(-1);
  inv.items.push({ ...emptyItem(), taxType: last ? taxKeyOf(last) : 'S19' }); // Steuerart der vorigen Leistung übernehmen
  renderItems();
  update();
  const card = itemsBox.lastElementChild;
  card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  card.querySelector('[data-key="description"]').focus({ preventScroll: true });
});

// ---------- Abschläge (Schlussrechnung) ----------
const prepaymentBox = $('#prepayments');
function renderPrepayments() {
  const inv = invoice();
  if (kindOf(inv).key !== 'final') return;
  inv.prepayments ??= [];
  const field = (i, key, label, attrs = {}) => {
    const input = el('input', { className: `input${key === 'date' ? '' : ' mono'}`, value: inv.prepayments[i][key] ?? '', ...attrs });
    input.dataset.pkey = key;
    return el('label', { className: 'field' }, el('span', { className: 'field-label', textContent: label }), input);
  };
  prepaymentBox.replaceChildren(...inv.prepayments.map((p, i) => {
    const row = el('div', { className: 'prepayment' },
      field(i, 'number', 'Abschlag Nr.'),
      field(i, 'date', 'vom', { type: 'date' }),
      field(i, 'gross', 'Betrag brutto', { inputMode: 'decimal' }),
      field(i, 'tax', 'darin USt', { inputMode: 'decimal' }),
      el('button', { type: 'button', className: 'icon-btn', ariaLabel: `Abschlag ${i + 1} entfernen`, title: 'Entfernen', onclick: () => { inv.prepayments.splice(i, 1); renderPrepayments(); update(); } }, icon('trash')));
    row.dataset.index = i;
    return row;
  }));
  // Abgeschlossene Abschlagsrechnungen desselben Kunden zur Übernahme anbieten
  const used = new Set(inv.prepayments.map((p) => p.number));
  const candidates = state.store.invoices.filter((o) => isLocked(o) && o.kind === 'partial' && !used.has(o.number)
    && (o.customer.name || '').trim().toLowerCase() === (inv.customer.name || '').trim().toLowerCase());
  const pick = $('#prepayment-pick');
  fillSelect(pick, [{ value: '', text: candidates.length ? 'Abschlagsrechnung übernehmen …' : 'Keine abgeschlossene Abschlagsrechnung für diesen Kunden' },
    ...candidates.map((o) => ({ value: o.id, text: `${o.number} vom ${formatDate(o.date)}` }))]);
  pick.disabled = !candidates.length || isLocked(inv);
}
prepaymentBox.addEventListener('input', (e) => {
  const row = e.target.closest('.prepayment');
  if (!row || !e.target.dataset.pkey) return;
  invoice().prepayments[Number(row.dataset.index)][e.target.dataset.pkey] = e.target.value;
  update();
});
$('#prepayment-pick').addEventListener('change', (e) => {
  const source = state.store.invoices.find((o) => o.id === e.target.value);
  if (!source) return;
  const t = totalsOf(source);
  invoice().prepayments.push({ number: source.number, date: source.date, gross: centsToInput(t?.total ?? 0), tax: centsToInput(t?.tax ?? 0) });
  renderPrepayments();
  update();
});
$('#add-prepayment').addEventListener('click', () => {
  invoice().prepayments.push({ number: '', date: '', gross: '', tax: '' });
  renderPrepayments();
  update();
  prepaymentBox.lastElementChild?.querySelector('input')?.focus();
});

// ---------- Zahlung & Texte ----------
function renderBankSummary() {
  const inv = invoice();
  const c = invSettings(inv).company;
  const ok = isValidIBAN(c.iban);
  const status = ok ? formatIBAN(c.iban) : c.iban ? `${formatIBAN(c.iban)} (IBAN ungültig, Prüfziffer stimmt nicht)` : 'Noch keine IBAN hinterlegt';
  const summary = $('#bank-summary');
  summary.classList.toggle('is-invalid', !ok);
  summary.replaceChildren(
    el('div', {},
      el('span', { className: 'field-label', textContent: 'Bankverbindung' }),
      el('p', { className: c.iban ? 'mono' : 'bank-missing', textContent: status }),
      c.bank && el('p', { className: 'field-hint', textContent: c.bank })),
    el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: ok ? 'Ändern' : c.iban ? 'Korrigieren' : 'Eintragen', onclick: () => settingsPanel.open('company.iban') }),
  );
  // GiroCode braucht eine gültige IBAN; bei Fremdwährung zusätzlich einen Kurs (der QR-Code enthält den Euro-Betrag).
  const euro = (inv.currency || 'EUR') === 'EUR';
  const rateOk = euro || validRate(inv.fxRate);
  const available = ok && rateOk;
  const giro = $('[data-field="giroCode"]');
  giro.disabled = !available || isLocked(inv);
  giro.checked = available && Boolean(inv.giroCode);
  giro.closest('.switch').classList.toggle('is-disabled', !available);
  $('#giro-desc').hidden = !available;
  $('#giro-desc').textContent = euro
    ? 'QR-Code, den dein Kunde mit der Banking-App scannt. Betrag, IBAN und Verwendungszweck sind dann ausgefüllt.'
    : 'QR-Code mit dem in Euro umgerechneten Betrag. Die Banking-App überweist dann in Euro.';
  const warning = $('#giro-warning');
  warning.hidden = available;
  warning.textContent = !ok ? (c.iban ? 'Nicht verfügbar: die IBAN ist ungültig.' : 'Nicht verfügbar: keine IBAN eingetragen.') : 'Nicht verfügbar: zuerst den Wechselkurs laden.';
}
$('#save-defaults').addEventListener('click', () => {
  const inv = invoice();
  Object.assign(settings().defaults, { intro: inv.intro, note: inv.note, pricesGross: Boolean(inv.pricesGross) });
  save(renderSaveState);
  toast('Kopfzeile, Anmerkungen und Preisart werden für neue Rechnungen übernommen');
});

// ---------- Prüfmeldungen: am Feld markieren & hinführen ----------
const touched = new Set();
let showAllErrors = false;
let exportMode = 'pdf';

/** Alle Meldungen der geöffneten Rechnung; beim E-Rechnungs-Export zusätzlich die XRechnung-Pflichtfelder. */
function currentIssues() {
  const inv = invoice();
  if (isLocked(inv)) return [];
  const s = invSettings(inv);
  const ctx = validationContext();
  const issues = checkInvoice(inv, s, ctx);
  if (exportMode === 'xml') {
    for (const e of validateXRechnungFields(inv, s, ctx)) if (!issues.some((x) => x.field === e.field && isError(x))) issues.push(e);
  }
  return issues;
}
const companyMissing = () => validateInvoiceFields(invoice(), settings(), validationContext()).filter((e) => e.field.startsWith('company.'));

function fieldKeyOf(input) {
  if (input.dataset.field) return input.dataset.field;
  if (input.dataset.setting) return input.dataset.setting;
  const card = input.closest('.item');
  if (card && input.dataset.key) return `items.${card.dataset.index}.${input.dataset.key}`;
  const row = input.closest('.prepayment');
  if (row && input.dataset.pkey) return `prepayments.${row.dataset.index}.${input.dataset.pkey}`;
  return null;
}
const errorInputs = () => $$('[data-field], [data-setting], .item [data-key], .prepayment [data-pkey]');
/** Meldungen ohne eigenes Eingabefeld erscheinen an einem Ankerelement. */
const ANCHORS = { items: '#add-item', prepayments: '#add-prepayment' };

function renderFieldErrors(issues = currentIssues()) {
  const byField = new Map();
  for (const issue of issues) if (!byField.has(issue.field) || isError(issue)) byField.set(issue.field, issue);
  const visible = (key) => showAllErrors || touched.has(key) || byField.get(key)?.level === 'warning';
  for (const input of errorInputs()) {
    const key = fieldKeyOf(input);
    if (!key) continue;
    const issue = visible(key) ? byField.get(key) : undefined;
    const container = input.closest('.field') ?? input.closest('.switch') ?? input.parentElement;
    const hintId = `err-${key.replace(/\./g, '-')}`;
    let hint = container.querySelector(`#${CSS.escape(hintId)}`);
    if (issue) {
      if (!hint) container.append(hint = el('p', { id: hintId }));
      hint.className = isError(issue) ? 'field-error' : 'field-warning';
      hint.textContent = key.startsWith('items.') || key.startsWith('prepayments.') ? issue.message.replace(/^(Leistung|Abschlag) \d+: /, '') : issue.message;
      if (isError(issue)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      input.classList.toggle('has-warning', !isError(issue));
      input.setAttribute('aria-describedby', hintId);
    } else {
      hint?.remove();
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      input.classList.remove('has-warning');
    }
  }
  for (const [field, selector] of Object.entries(ANCHORS)) {
    const anchor = $(selector);
    const issue = byField.get(field);
    const id = `err-${field}`;
    let hint = document.getElementById(id);
    if (issue && (showAllErrors || !isError(issue) || touched.has(field))) {
      if (!hint) anchor.after(hint = el('p', { id }));
      hint.className = isError(issue) ? 'field-error' : 'field-warning';
      hint.textContent = issue.message;
    } else hint?.remove();
  }
  $('#add-item').classList.toggle('is-invalid', Boolean(byField.get('items') && isError(byField.get('items')) && showAllErrors));
  // Schritte mit Fehlern kennzeichnen (nach dem ersten Exportversuch)
  const errors = issues.filter(isError);
  for (const b of $$('.step')) b.classList.toggle('has-error', showAllErrors && errors.some((e) => stepOf(e.field) === Number(b.dataset.step)));
  $('#open-settings').classList.toggle('has-error', showAllErrors && errors.some((e) => stepOf(e.field) === 'settings'));
}

function goToField(field) {
  const target = stepOf(field);
  if (target === 'settings') { settingsPanel.open(field); return; }
  if (field.startsWith('customer.') && isSavedCustomer(invoice().customer) && !isLocked(invoice())) { settingsPanel.openCustomer(invoice().customer.id); return; }
  if (layout.dataset.view !== 'edit') switchView('edit');
  if (step !== target) setStep(target);
  const m = /^items\.(\d+)\./.exec(field);
  if (m && collapsedItems.delete(invoice().items[Number(m[1])])) renderItems();
  renderFieldErrors();
  const input = ANCHORS[field] ? $(ANCHORS[field]) : errorInputs().find((i) => fieldKeyOf(i) === field)
    ?? (m ? $(`.item[data-index="${m[1]}"] [data-key="description"]`) : null);
  if (!input) return;
  input.closest('details')?.setAttribute('open', '');
  input.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
}
document.addEventListener('focusout', (e) => {
  if (!e.target.matches?.('[data-field], [data-setting], .item [data-key], .prepayment [data-pkey]')) return;
  const key = fieldKeyOf(e.target);
  if (key) { touched.add(key); renderFieldErrors(); }
});

// ---------- Export ----------
let busy = false;
function setBusy(on) {
  busy = on;
  document.documentElement.classList.toggle('pdf-busy', on);
}

/** Vor dem ersten Export fragen: danach ist die Rechnung nicht mehr änderbar. */
async function confirmFinalize(mode) {
  $('#finalize-number').textContent = invoice().number;
  $('#finalize-confirm-label').textContent = mode === 'xml' ? 'Abschließen & E-Rechnung laden' : 'Abschließen & PDF exportieren';
  return (await ask($('#finalize'), $('#finalize-confirm'))) === 'confirm';
}

/**
 * Erster Export: prüfen → bestätigen → PDF und E-Rechnung erzeugen → erst dann festschreiben und
 * die Originale ablegen. Schlägt die Erzeugung fehl, bleibt die Rechnung ein Entwurf.
 */
async function exportDocument(mode) {
  if (busy) return;
  const inv = invoice();
  if (isLocked(inv)) { (mode === 'pdf' ? downloadPdf : downloadXml)(inv); return; }
  exportMode = mode;
  const errors = currentIssues().filter(isError);
  if (errors.length) {
    showAllErrors = true;
    renderFieldErrors();
    goToField(errors[0].field);
    toast(errors.length === 1 ? `Eine Angabe fehlt oder ist ungültig: ${errors[0].message}` : `${errors.length} Angaben fehlen oder sind ungültig. Sie sind rot markiert.`);
    return;
  }
  if (!(await confirmFinalize(mode))) return;
  const tab = mode === 'pdf' ? openPendingTab() : null;
  setBusy(true);
  toast(mode === 'pdf' ? 'PDF wird erstellt …' : 'E-Rechnung wird erstellt …');
  try {
    const done = finalizeInvoice(inv, settings(), { design: design() });
    const docs = await buildDocuments(done);
    state.store.invoices[state.store.invoices.indexOf(inv)] = done;
    const stored = await storeOriginal(done.id, docs);
    persist();
    requestPersistentStorage();
    fillForm();
    update();
    const note = stored ? '' : '. Bitte die Datei aufbewahren, der Browser konnte kein Original ablegen';
    if (mode === 'pdf') deliverPdf(docs.pdf, docs.pdfName, tab, `${docs.zugferd ? ' (mit E-Rechnung)' : ''}${note}`);
    else deliverXml(docs.xml, docs.xmlName);
  } catch (err) {
    tab?.close();
    console.error(err);
    toast('Das Dokument konnte nicht erstellt werden. Die Rechnung bleibt ein Entwurf. Bitte erneut versuchen.');
  } finally {
    setBusy(false);
  }
}

/** PDF einer abgeschlossenen Rechnung: das abgelegte Original, sonst (ältere Rechnungen) einmalig erzeugen und ablegen. */
async function downloadPdf(inv) {
  if (busy) return;
  const tab = openPendingTab();
  setBusy(true);
  try {
    const original = await originalOf(inv);
    if (original?.pdf) { deliverPdf(original.pdf, original.pdfName, tab, ' (Original)'); return; }
    const docs = await buildDocuments(inv);
    await saveOriginal({ id: inv.id, ...docs }).catch(() => {});
    deliverPdf(docs.pdf, docs.pdfName, tab);
  } catch (err) {
    tab?.close();
    console.error(err);
    toast('Das PDF konnte nicht erstellt werden. Bitte die Seite neu laden und erneut versuchen.');
  } finally {
    setBusy(false);
  }
}

/** E-Rechnung einer abgeschlossenen Rechnung: Original oder: falls noch keine abgelegt ist: jetzt erzeugen und ablegen. */
async function downloadXml(inv) {
  const original = await originalOf(inv);
  if (original?.xml) { deliverXml(original.xml, original.xmlName); return; }
  let xml;
  try { xml = toXRechnung(inv, invSettings(inv), validationContext()); } catch (err) {
    toast(`E-Rechnung nicht möglich: ${err.message.split('.')[0]}.`);
    return;
  }
  await saveOriginal({ id: inv.id, xml, xmlName: `${inv.number}.xml` }).catch(() => {});
  deliverXml(xml, `${inv.number}.xml`);
}

$('#export-pdf').addEventListener('click', () => exportDocument('pdf'));
$('#export-xml').addEventListener('click', () => exportDocument('xml'));
$('#export-xml-bar').addEventListener('click', () => exportDocument('xml'));
$('#save-draft').addEventListener('click', () => {
  const ok = persist();
  renderSaveState(ok);
  toast(ok ? `${invoice().number} als Entwurf gespeichert` : 'Speichern nicht möglich, der Speicher ist voll.');
  archive.render();
  openDrawer($('#archive'));
});

// ---------- Vorschau, Titel, Speicherstand ----------
function renderTitle() {
  const inv = invoice();
  const kind = kindOf(inv);
  $('#doc-title').replaceChildren(...(inv.number ? [el('span', { className: 'title-prefix', textContent: `${kind.title} ` }), inv.number] : [`Neue ${kind.title}`]));
}
function renderSaveState(saved) {
  const inv = invoice();
  if (isLocked(inv)) {
    $('#save-state').textContent = `Abgeschlossen${inv.lockedAt ? ` am ${new Date(inv.lockedAt).toLocaleDateString('de-DE')}` : ''} · nicht mehr änderbar`;
    return;
  }
  if (saved === false) { $('#save-state').textContent = 'Speichern nicht möglich: Speicher voll (Logo zu groß?)'; return; }
  $('#save-state').textContent = saved ? `Entwurf · gespeichert um ${timeFmt.format(new Date())}` : 'Entwurf · wird automatisch gespeichert';
}

function update() {
  const inv = invoice();
  const totals = totalsOf(inv);
  renderPreview(paper, viewOf(inv), invSettings(inv), { onFixIban: () => settingsPanel.open('company.iban') });
  applyLock();
  renderFieldErrors();
  renderTitle();
  renderSaveState();
  $('#sumbar-total').textContent = totals ? formatMoney((kindOf(inv).key === 'storno' ? -1 : 1) * totals.payable, inv.currency || 'EUR') : '-';
  renderOnboarding();
  if ($('#settings').open) { settingsPanel.renderCompanyStatus(); settingsPanel.renderNumberPreview(); }
  save(renderSaveState);
}

// ---------- Ansicht (mobil: Bearbeiten / Vorschau) ----------
const applyZoom = setupZoom(paper, $('#paper-fit'));
function switchView(view) {
  layout.dataset.view = view;
  $$('.view-switch .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  applyZoom();
  $('#scroller').scrollTo({ top: 0 });
}
$$('.view-switch .tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
const topbar = $('.topbar');
new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${topbar.offsetHeight}px`)).observe(topbar);

// ---------- Seitenfenster ----------
function openDrawer(dialog) {
  dialog.showModal();
  document.documentElement.classList.add('scroll-locked');
}
for (const d of $$('dialog.drawer')) {
  d.addEventListener('close', () => document.documentElement.classList.remove('scroll-locked'));
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}

function resetEditor() {
  touched.clear();
  showAllErrors = false;
  exportMode = 'pdf';
  collapsedItems.clear();
  fillForm();
  setStep(1);
  update();
}

const settingsPanel = initSettingsPanel({
  update,
  renderItems: () => { renderPriceMode(); renderItems(); },
  renderBankSummary,
  renderFieldErrors: () => renderFieldErrors(),
  touch: (field) => touched.add(field),
  requestGeo: () => requestGeo({ askFirst: false }),
  revokeGeo,
  openDrawer,
  resetEditor,
  companyMissing,
  onCustomersChanged: () => {
    const inv = invoice();
    for (const input of $$('[data-field^="customer."]', form)) {
      const value = getPath(inv, input.dataset.field);
      if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? '';
    }
    renderCustomerSelect();
    renderCustomerLock();
    update();
  },
});
watchGeoPermission();
const archive = initArchivePanel({ resetEditor, openDrawer, downloadPdf, downloadXml });
$('#open-settings').addEventListener('click', () => settingsPanel.open());

// ---------- Hinweis: eigene Firmendaten eintragen ----------
function renderOnboarding() {
  const missing = companyMissing().length > 0;
  $('#onboarding').hidden = !missing;
  $('#open-settings').classList.toggle('needs-setup', missing);
}
$('#onboarding-btn').addEventListener('click', () => settingsPanel.open(companyMissing()[0]?.field ?? 'company.name'));

// ---------- Hell / Dunkel ----------
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
  try { localStorage.setItem('rechnungen:theme', nextTheme); } catch { /* ignorieren */ }
  applyTheme(nextTheme);
});

// ---------- Start ----------
fillForm();
setStep(1);
update();
