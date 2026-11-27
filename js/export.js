/**
 * Dokumente erzeugen und ausliefern: PDF/A-3 mit eingebetteter E-Rechnung (ZUGFeRD), XRechnung, Sicherung.
 */
import { toCII, toXRechnung } from './invoice.js?v=27';
import { buildInvoiceView } from './view.js?v=27';
import { el, toast, downloadBlob } from './ui.js?v=27';
import { saveOriginal, getOriginal, allOriginals, verifyOriginal } from './originals.js?v=27';
import { state, invSettings, totalsOf, design, validationContext, normalize } from './store.js?v=27';


// ---------- Ressourcen fürs PDF ----------
let assets = null;
/** Schriften (Inter, ca. 24 KB je Schnitt) und sRGB-Farbprofil einmalig laden. */
function loadAssets() {
  const get = (url) => fetch(`${url}?v=27`).then((r) => {
    if (!r.ok) throw new Error(`${url} nicht gefunden`);
    return r.arrayBuffer();
  });
  assets ??= Promise.all([get('fonts/inter-pdf-400.ttf'), get('fonts/inter-pdf-600.ttf'), get('fonts/inter-pdf-700.ttf'), get('assets/sRGB.icc')])
    .then(([regular, semibold, bold, icc]) => ({ fonts: { regular, semibold, bold }, icc: new Uint8Array(icc) }))
    .catch((e) => { assets = null; throw e; });
  return assets;
}

/** Logo als Rohpixel (RGB + Transparenz): Seitenverhältnis bleibt exakt erhalten, nichts wird beschnitten. */
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

/** Darstellungsmodell einer Rechnung (für Vorschau und PDF). */
export function viewOf(inv) {
  const s = invSettings(inv);
  return buildInvoiceView(inv, s, totalsOf(inv), design(s));
}

/**
 * Erzeugt PDF (PDF/A-3, mit ZUGFeRD-XML wenn möglich) und: wenn die Angaben reichen: die XRechnung.
 * @returns { pdf, pdfName, xml, xmlName, zugferd: boolean }
 */
export async function buildDocuments(inv, s = invSettings(inv)) {
  const { createInvoicePdf } = await import('./invoice-pdf.js?v=27');
  const view = buildInvoiceView(inv, s, totalsOf(inv), design(s));
  const context = validationContext();
  let embedded = null;
  if (state.store.settings.zugferd !== false) {
    try { embedded = toCII(inv, s, { profile: 'en16931', context }); } catch { embedded = null; }
  }
  const [{ fonts, icc }, logo] = await Promise.all([loadAssets(), rasterizeLogo(view.logo)]);
  const pdf = await createInvoicePdf(view, { fonts, logo, iccProfile: icc, einvoice: embedded && { xml: embedded, conformance: 'EN 16931' } });
  let xml = null;
  try { xml = toXRechnung(inv, s, context); } catch { xml = null; }
  return { pdf, pdfName: `${view.fileName}.pdf`, xml, xmlName: `${inv.number}.xml`, zugferd: Boolean(embedded) };
}

/** Originale ablegen (nach dem Abschließen). Liefert false, wenn der Browser keinen Speicher dafür hat. */
export async function storeOriginal(id, docs) {
  try {
    await saveOriginal({ id, ...docs, createdAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Original einer abgeschlossenen Rechnung: oder null (ältere Rechnung, Browser ohne IndexedDB). */
export async function originalOf(inv) {
  try {
    const record = await getOriginal(inv.id);
    if (record && !(await verifyOriginal(record))) toast('Achtung: Das gespeicherte Original stimmt nicht mehr mit seiner Prüfsumme überein.');
    return record ?? null;
  } catch {
    return null;
  }
}

// ---------- Ausliefern ----------
/**
 * Handy/Tablet: Pop-up-Tabs mit blob-Adressen gehen dort nicht (Android zeigt eine leere schwarze Seite,
 * In-App-Browser wie WhatsApp erst recht). Dort wird nur heruntergeladen; „Öffnen“ läuft über das Teilen-Menü.
 */
export const isMobileDevice = () => navigator.userAgentData?.mobile
  || /Android|iPhone|iPad|iPod|Mobi|Silk|Kindle/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS meldet sich als Mac

/** Desktop: Tab sofort öffnen, solange der Klick noch „frisch“ ist: sonst blockt der Browser das Pop-up. */
export function openPendingTab() {
  if (isMobileDevice()) return null;
  const tab = window.open('', '_blank');
  tab?.document.write('<title>PDF wird erstellt …</title><p style="font:16px system-ui;padding:24px;color:#475467">PDF wird erstellt …</p>');
  return tab;
}

/** PDF speichern und öffnen (Desktop) bzw. Öffnen/Teilen anbieten (Handy). */
export function deliverPdf(bytes, name, tab = null, note = '') {
  const file = new File([bytes], name, { type: 'application/pdf' });
  const url = downloadBlob(file, name);
  const message = `${name} gespeichert${note}`;
  if (tab && !tab.closed) {
    tab.location.href = url;
    toast(message);
  } else if (!isMobileDevice()) {
    toast(message, { label: 'Öffnen', run: () => window.open(url, '_blank') }); // Pop-up war blockiert
  } else if (navigator.canShare?.({ files: [file] })) {
    toast(message, { label: 'Öffnen', run: () => navigator.share({ files: [file], title: name }).catch(() => {}) });
  } else {
    toast(`${message}. Du findest es in deinen Downloads.`);
  }
}

export function deliverXml(xml, name) {
  downloadBlob(new Blob([xml], { type: 'application/xml' }), name);
  toast('E-Rechnung (XRechnung 3.0) heruntergeladen');
}

// ---------- Sicherung ----------
const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Komplette Sicherung als JSON-Datei: inklusive der Originale abgeschlossener Rechnungen. */
export async function exportBackup() {
  let originals = [];
  try { originals = await allOriginals(); } catch { /* ohne IndexedDB nur die Daten */ }
  const data = {
    app: 'rechnungs-generator',
    format: 1,
    exportedAt: new Date().toISOString(),
    store: state.store,
    originals: originals.map((o) => ({ ...o, pdf: o.pdf ? toBase64(o.pdf) : null })),
  };
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `rechnungen-sicherung-${date}.json`);
  return { invoices: state.store.invoices.length, originals: originals.length };
}

/**
 * Liest eine Sicherung ein. Abgeschlossene Rechnungen, die es nur hier gibt, bleiben erhalten:
 * eine Sicherung kann also nichts Ausgestelltes überschreiben oder löschen.
 */
export async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Die Datei ist keine gültige Sicherung.'); }
  if (data?.app !== 'rechnungs-generator' || !data.store?.settings || !Array.isArray(data.store.invoices)) throw new Error('Die Datei ist keine Sicherung des Rechnungsgenerators.');
  const incoming = normalize(structuredClone(data.store));
  const incomingIds = new Set(incoming.invoices.map((i) => i.id));
  const keep = state.store.invoices.filter((i) => i.status === 'erstellt' && !incomingIds.has(i.id));
  // Abgeschlossene Rechnungen gewinnen gegen Entwürfe mit derselben ID
  incoming.invoices = incoming.invoices.map((inv) => {
    const local = state.store.invoices.find((i) => i.id === inv.id);
    return local?.status === 'erstellt' ? local : inv;
  });
  incoming.invoices.push(...keep);
  for (const o of data.originals ?? []) {
    try { await saveOriginal({ ...o, pdf: o.pdf ? fromBase64(o.pdf) : undefined }); } catch { /* ohne IndexedDB */ }
  }
  return { store: incoming, kept: keep.length };
}
