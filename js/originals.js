/**
 * Originale ausgestellter Rechnungen (IndexedDB).
 *
 * Beim Abschließen werden PDF und E-Rechnung genau einmal erzeugt und hier abgelegt – mit SHA-256-Prüfsumme.
 * Spätere Downloads liefern dieses Original, nicht eine Neuberechnung: Auch nach einem Programm-Update
 * bekommt man byte-genau das Dokument, das verschickt wurde.
 */
const DB_NAME = 'rechnungen-originale';
const STORE = 'originale';

let dbPromise = null;
function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB nicht verfügbar'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function tx(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** SHA-256 als Hex-Text. */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Original speichern oder ergänzen (z. B. die XML nachträglich).
 * record: { id, pdf?: Uint8Array, pdfName?, xml?: string, xmlName?, createdAt }
 */
export async function saveOriginal(record) {
  const existing = await getOriginal(record.id).catch(() => null);
  const merged = { ...existing, ...record, createdAt: existing?.createdAt ?? record.createdAt ?? Date.now() };
  if (record.pdf) merged.pdfHash = await sha256(record.pdf);
  if (record.xml) merged.xmlHash = await sha256(record.xml);
  // Bereits abgelegte Dateien werden nie überschrieben
  if (existing?.pdf) Object.assign(merged, { pdf: existing.pdf, pdfName: existing.pdfName, pdfHash: existing.pdfHash });
  if (existing?.xml) Object.assign(merged, { xml: existing.xml, xmlName: existing.xmlName, xmlHash: existing.xmlHash });
  await tx('readwrite', (s) => s.put(merged));
  return merged;
}

export const getOriginal = (id) => tx('readonly', (s) => s.get(id));
export const allOriginals = () => tx('readonly', (s) => s.getAll());

/** Prüft, ob ein Original noch unverändert ist (Prüfsumme). */
export async function verifyOriginal(record) {
  if (!record) return false;
  const pdfOk = !record.pdf || (await sha256(record.pdf)) === record.pdfHash;
  const xmlOk = !record.xml || (await sha256(record.xml)) === record.xmlHash;
  return pdfOk && xmlOk;
}
