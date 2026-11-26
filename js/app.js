import {
  calculateTotals, lineNet, formatEUR, nextInvoiceNumber, addDays,
  formatIBAN, validateInvoiceFields, KLEINUNTERNEHMER_HINWEIS,
} from './invoice.js?v=7';

const STORAGE_KEY = 'rechnungs-generator:v1';
const $ = (sel, root = document) => root.querySelector(sel);
const present = (c) => c !== null && c !== undefined && c !== false && c !== '';
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(present));
  return node;
};
const today = () => new Date().toISOString().slice(0, 10);
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '');

const emptyItem = () => ({ description: '', quantity: '1', unit: '', unitPrice: '', taxRate: 19 });

function sampleInvoice() {
  return {
    sender: {
      name: 'Max Mustermann Webdesign',
      address: 'Musterstraße 12\n10115 Berlin',
      taxId: '12/345/67890',
      email: 'kontakt@mustermann-web.de',
      iban: 'DE89 3704 0044 0532 0130 00',
      bank: 'Musterbank Berlin',
    },
    recipient: { name: 'Beispiel Bäckerei GmbH', address: 'Hauptstraße 5\n12043 Berlin' },
    number: nextInvoiceNumber(null),
    date: today(),
    serviceDate: new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()),
    paymentDays: 14,
    kleinunternehmer: false,
    intro: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Für die erbrachten Leistungen stelle ich Ihnen Folgendes in Rechnung:',
    note: 'Ich freue mich auf die weitere Zusammenarbeit.\n\nMit freundlichen Grüßen\nMax Mustermann',
    items: [
      { description: 'Konzeption & Design OnePager', quantity: '1', unit: 'Pausch.', unitPrice: '850,00', taxRate: 19 },
      { description: 'Umsetzung & Responsive-Optimierung', quantity: '6,5', unit: 'Std.', unitPrice: '65,00', taxRate: 19 },
      { description: 'Fachbuch „Webdesign Basics“', quantity: '1', unit: 'Stk.', unitPrice: '29,90', taxRate: 7 },
    ],
  };
}

// ---------- Zustand & Persistenz ----------
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.items) return saved;
  } catch { /* ignorieren */ }
  return sampleInvoice();
}
let invoice = load();
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(invoice)); } catch { /* ignorieren */ } };

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}

// ---------- Formular ----------
const form = $('#invoice-form');
const itemsBox = $('#items');
const template = $('#item-template');

function fillForm() {
  for (const input of form.querySelectorAll('[data-field]')) {
    const value = getPath(invoice, input.dataset.field);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  }
  renderItems();
}

function renderItems() {
  itemsBox.replaceChildren(...invoice.items.map((item, index) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.index = index;
    for (const input of row.querySelectorAll('[data-key]')) input.value = item[input.dataset.key] ?? '';
    row.querySelector('[data-key="taxRate"]').disabled = invoice.kleinunternehmer;
    return row;
  }));
}

form.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.field) {
    const value = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    setPath(invoice, t.dataset.field, value);
    if (t.dataset.field === 'kleinunternehmer') renderItems();
  } else if (t.dataset.key) {
    const index = Number(t.closest('.item-row').dataset.index);
    invoice.items[index][t.dataset.key] = t.dataset.key === 'taxRate' ? Number(t.value) : t.value;
  }
  update();
});

itemsBox.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action="remove"]'); // Klick kann auf dem Icon landen
  if (!button) return;
  invoice.items.splice(Number(button.closest('.item-row').dataset.index), 1);
  renderItems();
  update();
});

$('#add-item-btn').addEventListener('click', () => {
  invoice.items.push(emptyItem());
  renderItems();
  itemsBox.lastElementChild.querySelector('input').focus();
  update();
});

$('#new-btn').addEventListener('click', () => {
  invoice = {
    ...invoice, // Absenderdaten bleiben erhalten
    recipient: { name: '', address: '' },
    number: nextInvoiceNumber(invoice.number),
    date: today(),
    serviceDate: '',
    items: [emptyItem()],
  };
  touched.clear();
  showAllErrors = false;
  fillForm();
  update();
  $('[data-field="recipient.name"]').focus();
});

function exportPdf() {
  const errors = validateInvoiceFields(invoice);
  if (errors.length) {
    showAllErrors = true;
    renderFieldErrors(errors);
    goToField(errors[0].field);
    toast(errors.length === 1 ? 'Ein Pflichtfeld fehlt noch – es ist rot markiert.' : `${errors.length} Pflichtfelder fehlen noch – sie sind rot markiert.`);
    return;
  }
  const previousTitle = document.title;
  document.title = `${invoice.number || 'Rechnung'} ${invoice.recipient.name || ''}`.trim(); // Dateiname im PDF-Dialog
  window.print();
  document.title = previousTitle;
}
$('#print-btn').addEventListener('click', exportPdf);
$('#print-btn-mobile').addEventListener('click', exportPdf);


// ---------- Vorschau ----------
const preview = $('#preview');

function multiline(text) {
  return String(text ?? '').split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line]));
}

function renderPreview(totals) {
  const { sender, recipient } = invoice;
  const dueDate = invoice.date ? addDays(invoice.date, Number(invoice.paymentDays) || 0) : '';

  const rows = invoice.items.map((item, i) => {
    let net = '–';
    try { net = formatEUR(lineNet(item)); } catch { /* ungültige Eingabe */ }
    let price = '–';
    try { price = formatEUR(lineNet({ quantity: 1, unitPrice: item.unitPrice })); } catch { /* ungültig */ }
    return el('tr', {},
      el('td', { textContent: String(i + 1) }),
      el('td', { textContent: item.description || '—' }),
      el('td', { className: 'num', textContent: `${item.quantity} ${item.unit ?? ''}`.trim() }),
      el('td', { className: 'num', textContent: price }),
      invoice.kleinunternehmer ? null : el('td', { className: 'num', textContent: `${item.taxRate} %` }),
      el('td', { className: 'num', textContent: net }),
    );
  });

  const sumRows = totals
    ? [
      el('tr', {}, el('td', { textContent: 'Summe netto' }), el('td', { className: 'num', textContent: formatEUR(totals.net) })),
      ...totals.taxes.map((t) => el('tr', {},
        el('td', { textContent: `zzgl. ${t.rate} % USt auf ${formatEUR(t.base)}` }),
        el('td', { className: 'num', textContent: formatEUR(t.amount) }))),
      el('tr', { className: 'grand' }, el('td', { textContent: 'Rechnungsbetrag' }), el('td', { className: 'num', textContent: formatEUR(totals.gross) })),
    ]
    : [el('tr', {}, el('td', { colSpan: 2, textContent: 'Bitte gültige Beträge eingeben.' }))];

  preview.replaceChildren(...[
    el('header', { className: 'inv-head' },
      el('div', { className: 'inv-sender' },
        el('strong', { textContent: sender.name || 'Ihr Name / Firma' }),
        el('p', {}, ...multiline(sender.address)),
        sender.email && el('p', { textContent: sender.email })),
      el('div', { className: 'inv-title' },
        el('h2', { textContent: 'Rechnung' }),
        el('dl', {},
          el('dt', { textContent: 'Nr.' }), el('dd', { className: 'mono', textContent: invoice.number || '—' }),
          el('dt', { textContent: 'Datum' }), el('dd', { textContent: formatDate(invoice.date) || '—' }),
          invoice.serviceDate && el('dt', { textContent: 'Leistung' }),
          invoice.serviceDate && el('dd', { textContent: invoice.serviceDate })))),
    el('p', { className: 'inv-return', textContent: [sender.name, String(sender.address ?? '').replace(/\n/g, ', ')].filter(Boolean).join(' · ') }),
    el('div', { className: 'inv-recipient' },
      el('strong', { textContent: recipient.name || 'Empfänger' }),
      el('p', {}, ...multiline(recipient.address))),
    el('h3', { className: 'inv-subject', textContent: `Rechnung ${invoice.number || ''}`.trim() }),
    invoice.intro && el('p', { className: 'inv-intro', textContent: invoice.intro }),
    el('table', { className: 'inv-items' },
      el('thead', {}, el('tr', {},
        el('th', { textContent: 'Pos.' }), el('th', { textContent: 'Beschreibung' }),
        el('th', { className: 'num', textContent: 'Menge' }), el('th', { className: 'num', textContent: 'Einzelpreis' }),
        invoice.kleinunternehmer ? null : el('th', { className: 'num', textContent: 'USt' }),
        el('th', { className: 'num', textContent: 'Gesamt' }))),
      el('tbody', {}, ...rows)),
    el('table', { className: 'inv-sum' }, el('tbody', {}, ...sumRows)),
    invoice.kleinunternehmer && el('p', { className: 'inv-note', textContent: KLEINUNTERNEHMER_HINWEIS }),
    el('p', { className: 'inv-pay', textContent: totals && dueDate
      ? `Bitte überweisen Sie den Betrag von ${formatEUR(totals.gross)} bis zum ${formatDate(dueDate)} unter Angabe der Rechnungsnummer.`
      : '' }),
    invoice.note && el('p', { className: 'inv-note', textContent: invoice.note }),
    el('footer', { className: 'inv-foot' },
      el('div', {}, el('strong', { textContent: sender.name || '' }), el('br'), ...multiline(sender.address)),
      el('div', {}, sender.taxId ? `Steuernr./USt-IdNr.: ${sender.taxId}` : '', el('br'), sender.email || ''),
      el('div', {}, sender.bank || '', el('br'), sender.iban ? `IBAN: ${formatIBAN(sender.iban)}` : '')),
  ].filter(present));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// ---------- Pflichtfelder: rot markieren & hinführen ----------
const touched = new Set();      // Felder, die der Nutzer schon verlassen hat
let showAllErrors = false;      // nach Klick auf „PDF speichern“ alle Fehler zeigen

const fieldKey = (input) => input.dataset.field
  ?? `items.${input.closest('.item-row').dataset.index}.${input.dataset.key}`;
const allInputs = () => form.querySelectorAll('[data-field], [data-key]');

function renderFieldErrors(errors = validateInvoiceFields(invoice)) {
  const byField = new Map(errors.map((e) => [e.field, e.message]));
  for (const input of allInputs()) {
    const key = fieldKey(input);
    const message = (showAllErrors || touched.has(key)) ? byField.get(key) : undefined;
    const container = input.closest('.field, label');
    let hint = container.querySelector(':scope > .field-error');
    if (message) {
      if (!hint) {
        hint = el('p', { className: 'field-error', id: `err-${key.replace(/\./g, '-')}` });
        container.append(hint);
      }
      // In der Positionskarte ist die Nummer schon sichtbar → Präfix weglassen
      hint.textContent = key.startsWith('items.') ? message.replace(/^Position \d+: /, '') : message;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', hint.id);
    } else {
      hint?.remove();
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }
  const noItems = byField.get('items');
  $('#add-item-btn').classList.toggle('is-invalid', Boolean(noItems && showAllErrors));
}

function goToField(field) {
  // mobil zuerst in die Bearbeiten-Ansicht wechseln
  if (layout.dataset.view !== 'edit') $('.view-switch [data-view="edit"]').click();
  const target = field === 'items'
    ? $('#add-item-btn')
    : [...allInputs()].find((i) => fieldKey(i) === field);
  if (!target) return;
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
}

form.addEventListener('focusout', (e) => {
  if (!e.target.matches('[data-field], [data-key]')) return;
  touched.add(fieldKey(e.target));
  renderFieldErrors();
});

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---------- Ansicht (mobil: Bearbeiten / Vorschau) ----------
const layout = $('.layout');
document.querySelectorAll('.view-switch .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    layout.dataset.view = tab.dataset.view;
    document.querySelectorAll('.view-switch .tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    fitPaper();
    // mobil scrollt nur der Inhaltsbereich, am Desktop die Seite
    $('#scroller').scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  });
});

// ---------- Vorschau-Zoom ----------
// Desktop: Standard ist „ganze Seite“ (Breite UND Höhe passen hinein); +/−, Strg/⌘ + Mausrad und
// Touchpad-Pinch zoomen. Mobil/Tablet: Blatt füllt die Breite, kein Zoom (Pinch des Browsers bleibt).
const PAPER_W = 794;   // 210 mm bei 96 dpi
const PAPER_H = 1123;  // 297 mm bei 96 dpi
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const desktop = matchMedia('(min-width: 1101px)');
const paperFit = $('#paper-fit');
let manualZoom = null; // null = „ganze Seite“

function fitScale() {
  const pad = 32; // Luft für den Schatten
  const w = paperFit.clientWidth - pad;
  const h = paperFit.clientHeight - pad;
  if (w <= 0) return 1;
  return desktop.matches ? Math.min(w / PAPER_W, h / PAPER_H) : Math.min(1, (paperFit.clientWidth) / PAPER_W);
}

function applyZoom(anchor) {
  const fit = fitScale();
  const zoom = desktop.matches && manualZoom !== null ? manualZoom : fit;
  // Punkt unter dem Mauszeiger beim Zoomen festhalten
  const prev = parseFloat(preview.style.getPropertyValue('--paper-zoom')) || zoom;
  const ax = anchor ? anchor.x + paperFit.scrollLeft : 0;
  const ay = anchor ? anchor.y + paperFit.scrollTop : 0;
  preview.style.setProperty('--paper-zoom', zoom.toFixed(4));
  paperFit.classList.toggle('is-zoomed', desktop.matches && zoom > fit + 0.001);
  $('#zoom-fit').textContent = `${Math.round(zoom * 100)} %`;
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
  // nah an „ganze Seite“ → wieder einrasten
  manualZoom = Math.abs(clamped - fitScale()) < 0.02 ? null : clamped;
  applyZoom(anchor);
}
const currentZoom = () => parseFloat(preview.style.getPropertyValue('--paper-zoom')) || fitScale();

$('#zoom-in').addEventListener('click', () => setZoom(currentZoom() * 1.2));
$('#zoom-out').addEventListener('click', () => setZoom(currentZoom() / 1.2));
$('#zoom-fit').addEventListener('click', () => { manualZoom = null; applyZoom(); paperFit.scrollTo({ top: 0, left: 0 }); });

// Strg/⌘ + Mausrad und Touchpad-Pinch (Chrome, Edge, Firefox melden Pinch als Wheel mit ctrlKey)
paperFit.addEventListener('wheel', (e) => {
  if (!desktop.matches || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const rect = paperFit.getBoundingClientRect();
  setZoom(currentZoom() * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top });
}, { passive: false });

// Safari: Pinch-Gesten auf dem Trackpad
let gestureStart = 1;
paperFit.addEventListener('gesturestart', (e) => { if (!desktop.matches) return; e.preventDefault(); gestureStart = currentZoom(); });
paperFit.addEventListener('gesturechange', (e) => { if (!desktop.matches) return; e.preventDefault(); setZoom(gestureStart * e.scale); });

// Höhe der Kopfzeile für die Vorschau-Höhe (CSS-Variable)
const header = $('.app-header');
new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);

const fitPaper = () => applyZoom();
new ResizeObserver(fitPaper).observe(paperFit);
desktop.addEventListener('change', () => { manualZoom = null; applyZoom(); });

function update() {
  let totals = null;
  try { totals = calculateTotals(invoice.items, { kleinunternehmer: invoice.kleinunternehmer }); } catch { /* ungültige Eingabe */ }
  renderPreview(totals);
  renderFieldErrors();
  $('#sumbar-total').textContent = totals ? formatEUR(totals.gross) : '–';
  save();
}

fillForm();
update();
