/** Kleine DOM-Helfer, Hinweis-Toast und Bestätigungsdialog: von allen Oberflächen-Modulen genutzt. */

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

// ---------- Info-Sprechblase ----------
// Am PC (Maus): beim Überfahren. Am Handy/Tablet: einmal tippen, verschwindet nach 8 s oder beim nächsten Tippen.
// Mit Tastatur: beim Fokussieren, Esc schließt. Der Text steht im Attribut data-tip des Knopfs.
const TIP_DURATION = 8000;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
let tip = null;
let tipOwner = null;
let tipTimer;

function tipElement() {
  if (!tip) {
    tip = el('div', { className: 'tooltip', id: 'tooltip', role: 'tooltip' }, el('span', { className: 'tooltip-text' }));
    if (supportsPopover) tip.popover = 'manual'; // oberste Ebene: liegt auch über geöffneten Dialogen
  }
  return tip;
}

function placeTip(btn) {
  const r = btn.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const gap = 10;
  const above = r.top - h - gap >= 8;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${above ? r.top - h - gap : r.bottom + gap}px`;
  tip.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
  tip.dataset.side = above ? 'top' : 'bottom';
}

export function showTip(btn, { autoHide = false } = {}) {
  const t = tipElement();
  t.firstElementChild.textContent = btn.dataset.tip;
  // In einem geöffneten Dialog muss die Blase im Dialog hängen, sonst ist sie dort nicht sichtbar
  const host = btn.closest('dialog[open]') ?? document.body;
  if (t.parentElement !== host) {
    if (supportsPopover && t.matches(':popover-open')) t.hidePopover();
    host.append(t);
  }
  if (supportsPopover && !t.matches(':popover-open')) t.showPopover();
  t.hidden = false;
  tipOwner?.removeAttribute('aria-describedby');
  tipOwner = btn;
  btn.setAttribute('aria-describedby', 'tooltip');
  placeTip(btn);
  clearTimeout(tipTimer);
  if (autoHide) tipTimer = setTimeout(hideTip, TIP_DURATION);
}

export function hideTip() {
  clearTimeout(tipTimer);
  if (!tip || !tipOwner) return;
  tipOwner.removeAttribute('aria-describedby');
  tipOwner = null;
  if (supportsPopover && tip.matches(':popover-open')) tip.hidePopover();
  tip.hidden = true;
}

const infoBtn = (target) => target?.closest?.('.info-btn[data-tip]');
document.addEventListener('pointerover', (e) => {
  const btn = infoBtn(e.target);
  if (btn && e.pointerType === 'mouse') showTip(btn);
});
document.addEventListener('pointerout', (e) => {
  const btn = infoBtn(e.target);
  if (btn && e.pointerType === 'mouse' && !btn.contains(e.relatedTarget) && !btn.matches(':focus-visible')) hideTip();
});
// Antippen (Touch/Stift): öffnen bzw. wieder schließen; Tippen irgendwo anders schließt ebenfalls
document.addEventListener('pointerdown', (e) => {
  if (!tipOwner || e.pointerType === 'mouse') return;
  if (infoBtn(e.target) !== tipOwner) hideTip();
}, true);
document.addEventListener('click', (e) => {
  const btn = infoBtn(e.target);
  if (!btn) return;
  e.preventDefault();
  if (e.pointerType === 'mouse') { showTip(btn); return; } // Maus: Klick lässt die Blase offen
  if (tipOwner === btn) hideTip();
  else showTip(btn, { autoHide: true });
});
document.addEventListener('focusin', (e) => {
  const btn = infoBtn(e.target);
  if (btn && btn.matches(':focus-visible')) showTip(btn);
});
document.addEventListener('focusout', (e) => { if (infoBtn(e.target) === tipOwner) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipOwner) hideTip(); });
window.addEventListener('scroll', () => { if (tipOwner) hideTip(); }, { capture: true, passive: true });
window.addEventListener('resize', () => { if (tipOwner) hideTip(); });
document.addEventListener('close', hideTip, true); // Dialog geschlossen
