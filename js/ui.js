/** Kleine DOM-Helfer, Hinweis-Toast und Bestätigungsdialog – von allen Oberflächen-Modulen genutzt. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const present = (c) => c !== null && c !== undefined && c !== false && c !== '';

/** Element mit Eigenschaften und Kindern; leere Kinder (null, false, '') werden übersprungen. */
export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(present));
  return node;
};

/** Icon aus dem SVG-Sprite in index.html. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
export const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export const multiline = (text) => String(text ?? '').split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line]));
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}

/** Auswahlliste mit Gruppen füllen: [{ label, options: [{ value, text }] }] oder flach [{ value, text }]. */
export function fillSelect(select, entries) {
  const option = ({ value, text }) => el('option', { value, textContent: text });
  select.replaceChildren(...entries.map((e) => (e.options
    ? (e.label ? el('optgroup', { label: e.label }, ...e.options.map(option)) : e.options.map(option))
    : option(e))).flat());
}

// ---------- Toast ----------
let toastTimer;
/** Kurzer Hinweis unten; optional mit Aktion (z. B. „Rückgängig“). */
export function toast(message, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { textContent: message }));
  t.style.pointerEvents = action ? 'auto' : 'none';
  if (action) t.append(el('button', { type: 'button', className: 'toast-action', textContent: action.label, onclick: () => { action.run(); t.classList.remove('show'); } }));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3500);
}

// ---------- Dialoge ----------
/** Öffnet einen <dialog> und liefert dessen returnValue, sobald er geschlossen wird. */
export function ask(dialog, focus) {
  return new Promise((resolve) => {
    const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue); };
    dialog.returnValue = '';
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    focus?.focus();
  });
}

/** Allgemeine Rückfrage. Liefert true bei Bestätigung. */
export async function confirmDialog({ title, text, confirm = 'OK', cancel = 'Abbrechen', danger = false }) {
  const dialog = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').replaceChildren(...(Array.isArray(text) ? text : [text]).map((p) => el('p', { textContent: p })));
  const ok = $('#confirm-ok');
  ok.textContent = confirm;
  ok.classList.toggle('btn-danger', danger);
  $('#confirm-cancel').textContent = cancel;
  return (await ask(dialog, $('#confirm-cancel'))) === 'confirm';
}

/** Datei herunterladen lassen (Link muss im Dokument hängen, sonst ignorieren ihn manche Browser). */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  return url;
}
