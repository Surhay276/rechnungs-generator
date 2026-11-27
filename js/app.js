import {
  UNITS, unitLabel, toCents, calculateTotals, lineNet, formatEUR, nextInvoiceNumber, addDays, dueDate,
  skontoInfo, isValidIBAN, formatIBAN, epcPayload, grossFromNet, netFromGross, formatAddress,
  validateInvoiceFields, validateXRechnungFields, toXRechnung, KLEINUNTERNEHMER_HINWEIS,
} from './invoice.js?v=11';
import { qrcode } from './vendor/qrcode.mjs';
import { stringToBytes as utf8Bytes } from './vendor/qrcode_UTF8.mjs';
import { sampleSettings, sampleInvoice } from '../scripts/samples.mjs?v=11';

qrcode.stringToBytes = utf8Bytes; // GiroCode verlangt UTF-8 (Umlaute im Namen)

const STORAGE_KEY = 'rechnungen:v2';
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
const formatDate = (iso) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '');
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

function seed() {
  const t = today();
  const invoice = { ...sampleInvoice(t), id: newId(), number: `RE-${t.slice(0, 4)}-0001`, serviceFrom: `${t.slice(0, 8)}01`, serviceTo: t, updatedAt: Date.now() };
  return { settings: sampleSettings(), customers: [{ ...invoice.customer }], invoices: [invoice], currentId: invoice.id };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.settings && Array.isArray(saved.invoices) && saved.invoices.length) return saved;
  } catch { /* ignorieren */ }
  return seed();
}

let store = load();
if (!store.invoices.some((i) => i.id === store.currentId)) store.currentId = store.invoices[0].id;
const invoice = () => store.invoices.find((i) => i.id === store.currentId);
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
  $('#prev-step').hidden = step === 1;
  const last = step === 3;
  for (const btn of [$('#next-step'), $('#sumbar-action')]) {
    btn.replaceChildren(last ? icon('download') : '', last ? 'PDF speichern' : 'Weiter', last ? '' : icon('right'));
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
  renderCustomerSelect();
  renderPaymentChips();
  renderItems();
  $('#skonto-fields').hidden = !inv.skonto?.enabled;
}

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
  const ku = settings().kleinunternehmer;
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
  const c = settings().company;
  const ok = isValidIBAN(c.iban);
  $('#bank-summary').replaceChildren(
    el('div', {},
      el('span', { className: 'field-label', textContent: 'Bankverbindung' }),
      el('p', { className: 'mono', textContent: ok ? formatIBAN(c.iban) : 'Keine gültige IBAN hinterlegt' }),
      c.bank && el('p', { className: 'field-hint', textContent: c.bank })),
    el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: 'Ändern', onclick: () => openSettings('company.iban') }),
  );
  const giro = $('[data-field="giroCode"]');
  giro.disabled = !ok;
  giro.closest('.switch').classList.toggle('is-disabled', !ok);
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
const currentErrors = () => (exportMode === 'xml' ? validateXRechnungFields : validateInvoiceFields)(invoice(), settings());

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
  const errors = currentErrors();
  if (!errors.length) return true;
  showAllErrors = true;
  renderFieldErrors(errors);
  goToField(errors[0].field);
  toast(errors.length === 1 ? 'Eine Angabe fehlt noch – sie ist rot markiert.' : `${errors.length} Angaben fehlen noch – sie sind rot markiert.`);
  return false;
}

function markCreated() {
  invoice().status = 'erstellt';
  save();
  renderTitle();
}

function exportPdf() {
  if (!checkBeforeExport('pdf')) return;
  markCreated();
  const previousTitle = document.title;
  document.title = `${invoice().number} ${invoice().customer.name}`.trim(); // Dateiname im PDF-Dialog
  window.print();
  document.title = previousTitle;
}

function exportXml() {
  if (!checkBeforeExport('xml')) return;
  const xml = toXRechnung(invoice(), settings());
  const a = el('a', { href: URL.createObjectURL(new Blob([xml], { type: 'application/xml' })), download: `${invoice().number}.xml` });
  a.click();
  URL.revokeObjectURL(a.href);
  markCreated();
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

function giroCodeSvg(payload) {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
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

function renderPreview(totals) {
  const inv = invoice();
  const s = settings();
  const c = s.company;
  const k = inv.customer;
  const ku = s.kleinunternehmer;
  const due = dueDate(inv);
  const skonto = totals ? skontoInfo(totals.gross, inv.date, inv.skonto) : null;

  const metaRows = [
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
    const discountText = line?.discount
      ? `abzgl. ${item.discount.type === 'percent' ? `${String(item.discount.value).replace('.', ',')} % ` : ''}Rabatt (−${formatEUR(line.discount)})`
      : '';
    return el('tr', {},
      el('td', { className: 'pos', textContent: String(i + 1) }),
      el('td', {},
        el('strong', { textContent: item.description || '—' }),
        item.details && el('span', { className: 'inv-details', textContent: item.details }),
        discountText && el('span', { className: 'inv-details', textContent: discountText })),
      el('td', { className: 'num', textContent: `${item.quantity} ${unitLabel(item.unit)}`.trim() }),
      el('td', { className: 'num', textContent: price }),
      ku ? null : el('td', { className: 'num', textContent: `${item.taxRate} %` }),
      el('td', { className: 'num', textContent: line ? formatEUR(line.net) : '–' }));
  });

  const sumRow = (label, value, cls = '') => el('tr', { className: cls }, el('td', { textContent: label }), el('td', { className: 'num', textContent: value }));
  const sums = totals
    ? [
      totals.discount > 0 && sumRow('Zwischensumme', formatEUR(totals.subtotal)),
      totals.discount > 0 && sumRow(`Rabatt${inv.discount?.type === 'percent' ? ` (${String(inv.discount.value).replace('.', ',')} %)` : ''}`, `−${formatEUR(totals.discount)}`),
      sumRow('Nettobetrag', formatEUR(totals.net)),
      ...totals.taxes.map((t) => sumRow(`USt ${t.rate} % auf ${formatEUR(t.base)}`, formatEUR(t.amount))),
      sumRow('Rechnungsbetrag', formatEUR(totals.gross), 'grand'),
    ]
    : [el('tr', {}, el('td', { colSpan: 2, textContent: 'Bitte gültige Beträge eingeben.' }))];

  let payText = '';
  if (totals && totals.gross > 0) {
    payText = !due || due === inv.date
      ? `Bitte überweisen Sie den Betrag von ${formatEUR(totals.gross)} sofort unter Angabe der Rechnungsnummer ${inv.number}.`
      : `Bitte überweisen Sie den Betrag von ${formatEUR(totals.gross)} bis zum ${formatDate(due)} unter Angabe der Rechnungsnummer ${inv.number}.`;
  }
  const skontoText = skonto?.until
    ? `Bei Zahlung bis zum ${formatDate(skonto.until)} gewähren wir ${String(skonto.percent).replace('.', ',')} % Skonto (${formatEUR(skonto.amount)}) – zu zahlen sind dann ${formatEUR(skonto.payable)}.`
    : '';

  let qr = null;
  if (inv.giroCode && totals?.gross > 0 && isValidIBAN(c.iban) && c.name) {
    try { qr = giroCodeSvg(epcPayload({ name: c.name, iban: c.iban, bic: c.bic, amountCents: totals.gross, reference: inv.number })); } catch { qr = null; }
  }

  const sender = [c.name, c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

  preview.replaceChildren(...[
    el('header', { className: 'inv-head' },
      el('h2', { className: 'inv-title', textContent: 'Rechnung' }),
      c.logo
        ? el('img', { className: 'inv-logo', src: c.logo, alt: c.name || 'Logo' })
        : el('div', { className: 'inv-brand', textContent: c.name || 'Dein Unternehmen' })),
    el('p', { className: 'inv-return', textContent: sender }),
    el('div', { className: 'inv-address-row' },
      el('div', { className: 'inv-recipient' },
        el('strong', { textContent: k.name || 'Kunde' }),
        el('p', {}, ...multiline(formatAddress(k)))),
      el('dl', { className: 'inv-meta' }, ...metaRows.flatMap(([dt, dd]) => [el('dt', { textContent: dt }), el('dd', { textContent: dd })]))),
    inv.intro && el('p', { className: 'inv-intro', textContent: inv.intro }),
    el('table', { className: 'inv-items' },
      el('thead', {}, el('tr', {},
        el('th', { className: 'pos', textContent: 'Pos.' }), el('th', { textContent: 'Beschreibung' }),
        el('th', { className: 'num', textContent: 'Menge' }), el('th', { className: 'num', textContent: 'Einzelpreis' }),
        ku ? null : el('th', { className: 'num', textContent: 'USt' }),
        el('th', { className: 'num', textContent: 'Betrag' }))),
      el('tbody', {}, ...rows)),
    el('table', { className: 'inv-sum' }, el('tbody', {}, ...sums.filter(Boolean))),
    ku && el('p', { className: 'inv-note', textContent: KLEINUNTERNEHMER_HINWEIS }),
    (payText || qr) && el('div', { className: 'inv-pay' },
      el('div', {}, payText && el('p', { textContent: payText }), skontoText && el('p', { textContent: skontoText })),
      qr && el('figure', { className: 'inv-qr' }, qr, el('figcaption', { textContent: 'Mit Banking-App scannen' }))),
    inv.note && el('p', { className: 'inv-note', textContent: inv.note }),
    el('footer', { className: 'inv-foot' },
      el('div', {}, el('strong', { textContent: c.name || '' }), el('br'), ...multiline(formatAddress(c))),
      el('div', {},
        c.phone && `Tel. ${c.phone}`, c.phone && el('br'),
        c.email, c.email && el('br'),
        c.taxId && `Steuernr. ${c.taxId}`, c.taxId && el('br'),
        c.vatId && `USt-IdNr. ${c.vatId}`),
      el('div', {},
        c.bank, c.bank && el('br'),
        c.iban && `IBAN ${formatIBAN(c.iban)}`, c.iban && el('br'),
        c.bic && `BIC ${c.bic}`)),
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
  const status = inv.status === 'erstellt' ? 'Erstellt' : 'Entwurf';
  $('#save-state').textContent = justSaved ? `${status} · gespeichert um ${timeFmt.format(new Date())}` : `${status} · wird automatisch gespeichert`;
}

function update() {
  let totals = null;
  try { totals = calculateTotals(invoice().items, { kleinunternehmer: settings().kleinunternehmer, discount: invoice().discount }); } catch { /* ungültige Eingabe */ }
  renderPreview(totals);
  renderFieldErrors();
  renderTitle();
  $('#sumbar-total').textContent = totals ? formatEUR(totals.gross) : '–';
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
  $('#zoom-fit').textContent = `${Math.round((zoom / fit) * 100)} %`; // „Ganze Seite“ = 100 %
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
    try { gross = formatEUR(calculateTotals(inv.items, { kleinunternehmer: settings().kleinunternehmer, discount: inv.discount }).gross); } catch { /* ungültig */ }
    const isCurrent = inv.id === store.currentId;
    return el('li', { className: `invoice-row${isCurrent ? ' is-current' : ''}` },
      el('button', { type: 'button', className: 'invoice-open', onclick: () => openInvoice(inv.id) },
        el('span', { className: 'invoice-number mono', textContent: inv.number || 'Ohne Nummer' }),
        el('span', { className: 'invoice-customer', textContent: inv.customer.name || 'Kein Kunde' }),
        el('span', { className: 'invoice-date', textContent: formatDate(inv.date) })),
      el('span', { className: 'invoice-amount mono', textContent: gross }),
      el('span', { className: `badge badge-${inv.status}`, textContent: inv.status === 'erstellt' ? 'Erstellt' : 'Entwurf' }),
      el('div', { className: 'invoice-actions' },
        el('button', { type: 'button', className: 'icon-btn', title: 'Duplizieren', ariaLabel: `${inv.number} duplizieren`, onclick: () => duplicateInvoice(inv.id) }, icon('copy')),
        el('button', { type: 'button', className: 'icon-btn danger', title: 'Löschen', ariaLabel: `${inv.number} löschen`, onclick: () => deleteInvoice(inv.id) }, icon('trash'))));
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
  const copy = { ...structuredClone(source), id: newId(), number: newInvoice().number, status: 'entwurf', date: today(), dueDate: '', updatedAt: Date.now() };
  store.invoices.push(copy);
  openInvoice(copy.id);
  toast(`Kopie als ${copy.number} angelegt`);
}
function deleteInvoice(id) {
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
  renderCustomerList();
}
function openSettings(focusField) {
  fillSettings();
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

$('#reset-demo').addEventListener('click', () => {
  const before = structuredClone(store);
  store = seed();
  fillSettings();
  resetEditorState();
  toast('Demo-Daten geladen', { label: 'Rückgängig', run: () => { store = before; fillSettings(); resetEditorState(); } });
});

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
