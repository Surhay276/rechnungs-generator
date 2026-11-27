/**
 * Vorschau der Rechnung als A4-Blatt (HTML) und Zoom am Desktop.
 * Inhalt kommt aus demselben Modell wie das PDF (view.js).
 */
import { $, el, icon, svgEl, multiline } from './ui.js?v=28';
import { invoiceTheme } from './color.js?v=28';
import { design } from './store.js?v=28';

/** Überträgt die abgeleiteten Farbtöne als CSS-Variablen auf ein Element (Blatt oder Muster). */
export function applyDesign(target, source) {
  const { color, head } = design(source);
  const t = invoiceTheme(color);
  const vars = { '--ink': t.text, '--ink-fill': t.accent, '--ink-on': t.onAccent, '--ink-soft': t.soft, '--ink-line': t.line };
  for (const [k, v] of Object.entries(vars)) target.style.setProperty(k, v);
  target.classList.toggle('head-light', head === 'light');
}

/**
 * Logo in exakter Originalform: Breite und Höhe werden aus dem Seitenverhältnis berechnet
 * (passt in 55 × 24 mm, wie im PDF): kein Zuschneiden, kein Verzerren.
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
  const svg = svgEl('svg', { viewBox: `-2 -2 ${n + 4} ${n + 4}`, class: 'giro-qr', role: 'img', 'aria-label': 'GiroCode zum Bezahlen', 'shape-rendering': 'crispEdges' });
  svg.append(svgEl('rect', { x: -2, y: -2, width: n + 4, height: n + 4, fill: '#fff' }), svgEl('path', { d, fill: '#000' }));
  return svg;
}

/**
 * Zeichnet das Blatt.
 * @param onFixIban Klick auf den Hinweis „GiroCode fehlt“ (nur am Bildschirm, nie im PDF)
 */
export function renderPreview(paper, v, settingsSource, { onFixIban }) {
  applyDesign(paper, settingsSource);
  const rows = v.rows.map((r) => el('tr', {},
    el('td', { className: 'pos', textContent: r.pos }),
    el('td', {}, el('strong', { textContent: r.description }), ...r.details.map((d) => el('span', { className: 'inv-details', textContent: d }))),
    el('td', { className: 'num', textContent: r.quantity }),
    el('td', { className: 'num', textContent: r.price }),
    v.showTax ? el('td', { className: 'num', textContent: r.tax }) : null,
    el('td', { className: 'num', textContent: r.total })));

  const sums = v.sums
    ? v.sums.map((x) => el('tr', { className: x.grand ? 'grand' : '' }, el('td', { textContent: x.label }), el('td', { className: 'num', textContent: x.value })))
    : [el('tr', {}, el('td', { colSpan: 2, textContent: 'Bitte gültige Beträge eingeben.' }))];

  let qr = v.qr ? el('figure', { className: 'inv-qr' }, giroCodeSvg(v.qr), el('figcaption', { textContent: v.qrCaption })) : null;
  if (v.qrMissing) {
    qr = el('button', { type: 'button', className: 'inv-qr-missing', onclick: onFixIban },
      icon('alert'),
      el('strong', { textContent: 'GiroCode fehlt' }),
      el('span', { textContent: v.qrMissing.invalid ? 'IBAN ungültig, hier korrigieren' : 'IBAN eintragen, dann erscheint er hier' }));
  }

  paper.replaceChildren(...[
    el('header', { className: 'inv-head' },
      el('h2', { className: 'inv-title', textContent: v.title }),
      v.logo ? logoImage(v.logo, v.companyName) : el('div', { className: 'inv-brand', textContent: v.brand })),
    el('p', { className: 'inv-return', textContent: v.sender }),
    el('div', { className: 'inv-address-row' },
      el('div', { className: 'inv-recipient' }, el('strong', { textContent: v.recipient.name }), el('p', {}, ...multiline(v.recipient.address))),
      el('dl', { className: 'inv-meta' }, ...v.meta.flatMap(([dt, dd]) => [el('dt', { textContent: dt }), el('dd', { textContent: dd })]))),
    v.intro && el('p', { className: 'inv-intro', textContent: v.intro }),
    el('table', { className: 'inv-items' },
      el('thead', {}, el('tr', {},
        el('th', { className: 'pos', textContent: 'Pos.' }), el('th', { textContent: 'Beschreibung' }),
        el('th', { className: 'num col-qty', textContent: 'Menge' }), el('th', { className: 'num col-price', textContent: v.priceHead }),
        v.showTax ? el('th', { className: 'num col-tax', textContent: 'USt' }) : null,
        el('th', { className: 'num col-total', textContent: v.totalHead }))),
      el('tbody', {}, ...rows)),
    el('table', { className: 'inv-sum' }, el('tbody', {}, ...sums)),
    v.notes.length && el('div', { className: 'inv-note inv-tax-notes' }, ...v.notes.map((n) => el('p', { textContent: n }))),
    (v.payTexts.length || qr) && el('div', { className: 'inv-pay' }, el('div', {}, ...v.payTexts.map((t) => el('p', { textContent: t }))), qr),
    v.note && el('p', { className: 'inv-note', textContent: v.note }),
    el('div', { className: 'inv-body-end', ariaHidden: 'true' }),
    el('footer', { className: 'inv-foot' },
      ...v.footer.map((col) => el('div', {}, ...col.flatMap((line, i) => [i ? el('br') : null, line.bold ? el('strong', { textContent: line.text }) : line.text])))),
  ].filter((x) => x !== null && x !== undefined && x !== false && x !== '' && x !== 0));
}

// ---------- Zoom (Desktop) ----------
const PAPER_W = 794;
const PAPER_H = 1123;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

/** Zoom mit +/−, Strg/⌘ + Mausrad und Touchpad-Geste. Liefert applyZoom zum Neu-Einpassen. */
export function setupZoom(paper, paperFit) {
  const desktop = matchMedia('(min-width: 1101px)');
  let manualZoom = null;

  const fitScale = () => {
    const pad = 32;
    const w = paperFit.clientWidth - pad;
    const h = paperFit.clientHeight - pad;
    if (w <= 0) return 1;
    return desktop.matches ? Math.min(w / PAPER_W, h / PAPER_H) : Math.min(1, paperFit.clientWidth / PAPER_W);
  };
  const currentZoom = () => parseFloat(paper.style.getPropertyValue('--paper-zoom')) || fitScale();

  function applyZoom(anchor) {
    const fit = fitScale();
    const zoom = desktop.matches && manualZoom !== null ? manualZoom : fit;
    const prev = currentZoom();
    const ax = anchor ? anchor.x + paperFit.scrollLeft : 0;
    const ay = anchor ? anchor.y + paperFit.scrollTop : 0;
    paper.style.setProperty('--paper-zoom', zoom.toFixed(4));
    paperFit.classList.toggle('is-zoomed', desktop.matches && zoom > fit + 0.001);
    const pct = `${Math.round((zoom / fit) * 100)} %`; // „Ganze Seite“ = 100 %
    $('#zoom-fit').textContent = pct;
    $('#zoom-fit').setAttribute('aria-label', `${pct}, ganze Seite anzeigen`);
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
  new ResizeObserver(() => applyZoom()).observe(paperFit);
  desktop.addEventListener('change', () => { manualZoom = null; applyZoom(); });
  return applyZoom;
}
