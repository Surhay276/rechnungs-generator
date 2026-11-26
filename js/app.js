import {
  calculateTotals, lineNet, formatEUR, nextInvoiceNumber, addDays,
  formatIBAN, validateInvoice, KLEINUNTERNEHMER_HINWEIS,
} from './invoice.js';

const STORAGE_KEY = 'rechnungs-generator:v1';
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
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
    note: 'Vielen Dank für Ihren Auftrag!',
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
  if (e.target.dataset.action !== 'remove') return;
  invoice.items.splice(Number(e.target.closest('.item-row').dataset.index), 1);
  renderItems();
  update();
});

$('#add-item-btn').addEventListener('click', () => {
  invoice.items.push(emptyItem());
  renderItems();
  itemsBox.lastElementChild.querySelector('input').focus();
  update();
});

$('#sample-btn').addEventListener('click', () => {
  invoice = sampleInvoice();
  fillForm();
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
  fillForm();
  update();
});

$('#print-btn').addEventListener('click', () => {
  const errors = validateInvoice(invoice);
  if (errors.length && !confirmPrint(errors)) return;
  const previousTitle = document.title;
  document.title = `${invoice.number || 'Rechnung'} ${invoice.recipient.name || ''}`.trim(); // Dateiname im PDF-Dialog
  window.print();
  document.title = previousTitle;
});

function confirmPrint(errors) {
  $('#errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
  return window.confirm(`Die Rechnung ist unvollständig (${errors.length} Hinweis${errors.length > 1 ? 'e' : ''}). Trotzdem exportieren?`);
}

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

  preview.replaceChildren(
    el('header', { className: 'inv-head' },
      el('div', { className: 'inv-sender' },
        el('strong', { textContent: sender.name || 'Ihr Name / Firma' }),
        el('p', {}, ...multiline(sender.address)),
        sender.email && el('p', { textContent: sender.email })),
      el('div', { className: 'inv-title' },
        el('h2', { textContent: 'Rechnung' }),
        el('dl', {},
          el('dt', { textContent: 'Nr.' }), el('dd', { textContent: invoice.number || '—' }),
          el('dt', { textContent: 'Datum' }), el('dd', { textContent: formatDate(invoice.date) || '—' }),
          invoice.serviceDate && el('dt', { textContent: 'Leistung' }),
          invoice.serviceDate && el('dd', { textContent: invoice.serviceDate })))),
    el('p', { className: 'inv-return', textContent: [sender.name, String(sender.address ?? '').replace(/\n/g, ', ')].filter(Boolean).join(' · ') }),
    el('div', { className: 'inv-recipient' },
      el('strong', { textContent: recipient.name || 'Empfänger' }),
      el('p', {}, ...multiline(recipient.address))),
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
  );
}

function renderErrors(errors) {
  $('#errors').replaceChildren(...errors.map((msg) => el('li', { textContent: msg })));
}

function update() {
  let totals = null;
  try { totals = calculateTotals(invoice.items, { kleinunternehmer: invoice.kleinunternehmer }); } catch { /* ungültige Eingabe */ }
  renderPreview(totals);
  renderErrors(validateInvoice(invoice));
  save();
}

fillForm();
update();
