/**
 * Kleiner PDF-Schreiber ohne Abhängigkeiten – genau so viel PDF, wie eine Rechnung braucht:
 * Text in eingebetteten TrueType-Schriften (Unicode, also auch ğ, ş, ı, ő …), Linien, Flächen und Bilder.
 * Läuft im Browser und in Node (für die Tests).
 *
 * Koordinaten: Punkt (1/72 Zoll), Ursprung **oben links** – umgerechnet wird erst beim Schreiben.
 *
 * Optional als PDF/A-3b (ISO 19005-3) zur Langzeitarchivierung – mit XMP-Metadaten, sRGB-Farbprofil
 * und eingebetteten Dateien (z. B. die XML einer ZUGFeRD-/Factur-X-Rechnung).
 */

export const MM = 72 / 25.4;
const enc = new TextEncoder();
const num = (n) => (Math.round(n * 1000) / 1000).toString();

// ---------- TrueType lesen (nur was für Breiten und Einbettung nötig ist) ----------
export function parseFont(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = {};
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(o, o + 4));
    tables[tag] = { offset: view.getUint32(o + 8), length: view.getUint32(o + 12) };
  }
  const need = (tag) => {
    if (!tables[tag]) throw new Error(`Schrift unvollständig: Tabelle ${tag} fehlt`);
    return tables[tag].offset;
  };
  const head = need('head');
  const unitsPerEm = view.getUint16(head + 18);
  const bbox = [0, 2, 4, 6].map((d) => view.getInt16(head + 36 + d));
  const hhea = need('hhea');
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const numHMetrics = view.getUint16(hhea + 34);
  const numGlyphs = view.getUint16(need('maxp') + 4);
  const hmtx = need('hmtx');
  const advances = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) advances[g] = view.getUint16(hmtx + 4 * Math.min(g, numHMetrics - 1));
  let capHeight = ascent;
  if (tables['OS/2'] && view.getUint16(tables['OS/2'].offset) >= 2) capHeight = view.getInt16(tables['OS/2'].offset + 88);

  // cmap: Unicode-Tabelle im Format 4 (BMP) oder 12
  const cmap = new Map();
  const cmapOff = need('cmap');
  const subtables = view.getUint16(cmapOff + 2);
  let best = null;
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmapOff + 4 + i * 8);
    const encoding = view.getUint16(cmapOff + 6 + i * 8);
    const offset = cmapOff + view.getUint32(cmapOff + 8 + i * 8);
    const format = view.getUint16(offset);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      if (format === 12 || (format === 4 && !best)) best = { offset, format };
    }
  }
  if (!best) throw new Error('Schrift ohne Unicode-Zuordnung');
  if (best.format === 4) {
    const o = best.offset;
    const segX2 = view.getUint16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = view.getUint16(ends + s * 2);
      const start = view.getUint16(starts + s * 2);
      const delta = view.getInt16(deltas + s * 2);
      const rangeOffset = view.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (rangeOffset === 0) g = (c + delta) & 0xffff;
        else {
          g = view.getUint16(ranges + s * 2 + rangeOffset + (c - start) * 2);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) cmap.set(c, g);
      }
    }
  } else {
    const o = best.offset;
    const groups = view.getUint32(o + 12);
    for (let i = 0; i < groups; i++) {
      const start = view.getUint32(o + 16 + i * 12);
      const end = view.getUint32(o + 20 + i * 12);
      const gid = view.getUint32(o + 24 + i * 12);
      for (let c = start; c <= end; c++) cmap.set(c, gid + c - start);
    }
  }
  return { bytes, unitsPerEm, bbox, ascent, descent, capHeight, advances, cmap };
}

/** Ersatz für Zeichen, die die Schrift nicht kennt (z. B. Emoji) – lieber ein Fragezeichen als ein leeres Kästchen. */
const FALLBACKS = { ' ': ' ', ' ': ' ', ' ': ' ', '\t': ' ', '‑': '-', '−': '-' };

export class Font {
  constructor(name, buffer) {
    Object.assign(this, parseFont(buffer));
    this.name = name;
    this.used = new Map(); // gid → Unicode-Text (für die Suche/Kopieren im PDF)
  }

  gid(ch) {
    const code = ch.codePointAt(0);
    if (this.cmap.has(code)) return this.cmap.get(code);
    const alt = FALLBACKS[ch] ?? ch.normalize('NFD')[0]; // „ǎ“ → „a“
    return this.cmap.get(alt.codePointAt(0)) ?? this.cmap.get(63) ?? 0;
  }

  /** Breite eines Texts in Punkt bei gegebener Schriftgröße. */
  width(text, size) {
    let w = 0;
    for (const ch of String(text)) w += this.advances[this.gid(ch)] ?? 0;
    return (w * size) / this.unitsPerEm;
  }

  /** Text als Folge von Glyphen-IDs (Hex) für den Inhaltsstrom; merkt sich die verwendeten Zeichen. */
  encode(text) {
    let hex = '';
    for (const ch of String(text)) {
      const g = this.gid(ch);
      if (!this.used.has(g)) this.used.set(g, ch);
      hex += g.toString(16).padStart(4, '0');
    }
    return hex;
  }
}

// ---------- Kompression (zlib = FlateDecode), wo verfügbar ----------
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Text für PDF-Strings im Info-Verzeichnis: UTF-16BE mit BOM als Hex. */
function textString(s) {
  let hex = 'FEFF';
  for (const unit of String(s)) {
    const code = unit.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += code.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

/** PDF-String in Klammern (nur ASCII, Sonderzeichen maskiert). */
const literal = (s) => `(${String(s).replace(/[^\x20-\x7e]/g, '_').replace(/([()\\])/g, '\\$1')})`;

const pad2 = (n) => String(n).padStart(2, '0');
/** Datum als PDF-Datum in UTC: D:20261127120000+00'00' */
function pdfDateString(d) {
  return `D:${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}+00'00'`;
}
/** Dasselbe Datum für XMP: 2026-11-27T12:00:00+00:00 – muss zum Info-Verzeichnis passen (PDF/A). */
const xmpDate = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+00:00`;

/** Dokument-ID (16 Byte als Hex) – deterministisch aus Inhaltsmerkmalen (FNV-1a, viermal versetzt). */
function documentId(seed) {
  let out = '';
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round;
    for (const ch of `${round}:${seed}`) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** XMP-Metadaten für PDF/A-3b; die Angaben spiegeln das Info-Verzeichnis. */
function xmpPacket(info, date, extra) {
  const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(v)}</rdf:li></rdf:Alt>`;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format>${info.Title ? `<dc:title>${alt(info.Title)}</dc:title>` : ''}${info.Author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEsc(info.Author)}</rdf:li></rdf:Seq></dc:creator>` : ''}${info.Subject ? `<dc:description>${alt(info.Subject)}</dc:description>` : ''}</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">${info.Creator ? `<xmp:CreatorTool>${xmlEsc(info.Creator)}</xmp:CreatorTool>` : ''}<xmp:CreateDate>${xmpDate(date)}</xmp:CreateDate><xmp:ModifyDate>${xmpDate(date)}</xmp:ModifyDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${xmlEsc(info.Producer)}</pdf:Producer></rdf:Description>
${extra.join('\n')}
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};

// ---------- Dokument ----------
export class PdfDocument {
  constructor({ width = 210 * MM, height = 297 * MM } = {}) {
    this.width = width;
    this.height = height;
    this.pages = [];
    this.fonts = [];
    this.images = [];
    this.info = {};
    this.attachments = [];
    this.pdfa = null; // { iccProfile: Uint8Array, xmp: [zusätzliche rdf:Description-Blöcke] }
  }

  /**
   * Hängt eine Datei an (PDF/A-3: „Associated File“ mit Beziehung zum Dokument).
   * @param relationship Alternative | Data | Source | Supplement
   */
  attach({ name, data, mime = 'application/octet-stream', description = '', relationship = 'Data', modified = new Date() }) {
    this.attachments.push({ name, data: typeof data === 'string' ? enc.encode(data) : data, mime, description, relationship, modified });
  }

  addFont(name, buffer) {
    const font = new Font(name, buffer);
    font.key = `F${this.fonts.length + 1}`;
    this.fonts.push(font);
    return font;
  }

  /** Bild aus Rohdaten: RGB (3 Byte je Pixel) und optional Alpha (1 Byte je Pixel). */
  addImage({ width, height, rgb, alpha = null }) {
    const image = { key: `Im${this.images.length + 1}`, width, height, rgb, alpha };
    this.images.push(image);
    return image;
  }

  addPage() {
    const page = { ops: [] };
    this.pages.push(page);
    this.page = page;
    return page;
  }

  #y(y) { return this.height - y; }
  #op(s) { this.page.ops.push(s); }

  /** Text mit Grundlinie bei y (von oben gemessen). */
  text(str, x, y, { font, size, color = '#000000' }) {
    if (str === '' || str == null) return;
    const [r, g, b] = hexToRgb(color);
    this.#op(`BT /${font.key} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ${num(x)} ${num(this.#y(y))} Td <${font.encode(str)}> Tj ET`);
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.75, radius = 0 }) {
    const parts = ['q'];
    if (fill) parts.push(`${hexToRgb(fill).map(num).join(' ')} rg`);
    if (stroke) parts.push(`${hexToRgb(stroke).map(num).join(' ')} RG ${num(lineWidth)} w`);
    if (radius > 0) {
      // abgerundetes Rechteck aus vier Bézier-Ecken (k = Kreisnäherung)
      const k = 0.5523 * radius;
      const [x0, x1, yt, yb] = [x, x + w, this.#y(y), this.#y(y + h)];
      parts.push(`${num(x0 + radius)} ${num(yt)} m ${num(x1 - radius)} ${num(yt)} l`
        + ` ${num(x1 - radius + k)} ${num(yt)} ${num(x1)} ${num(yt - radius + k)} ${num(x1)} ${num(yt - radius)} c`
        + ` ${num(x1)} ${num(yb + radius)} l ${num(x1)} ${num(yb + radius - k)} ${num(x1 - radius + k)} ${num(yb)} ${num(x1 - radius)} ${num(yb)} c`
        + ` ${num(x0 + radius)} ${num(yb)} l ${num(x0 + radius - k)} ${num(yb)} ${num(x0)} ${num(yb + radius - k)} ${num(x0)} ${num(yb + radius)} c`
        + ` ${num(x0)} ${num(yt - radius)} l ${num(x0)} ${num(yt - radius + k)} ${num(x0 + radius - k)} ${num(yt)} ${num(x0 + radius)} ${num(yt)} c h`);
    } else {
      parts.push(`${num(x)} ${num(this.#y(y + h))} ${num(w)} ${num(h)} re`);
    }
    parts.push(fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this.#op(parts.join(' '));
  }

  line(x1, y1, x2, y2, { color = '#000000', width = 0.75 } = {}) {
    this.#op(`q ${hexToRgb(color).map(num).join(' ')} RG ${num(width)} w ${num(x1)} ${num(this.#y(y1))} m ${num(x2)} ${num(this.#y(y2))} l S Q`);
  }

  /** Viele gleichfarbige Rechtecke in einem Rutsch (z. B. die Module eines QR-Codes). */
  rects(list, color = '#000000') {
    if (!list.length) return;
    const body = list.map(([x, y, w, h]) => `${num(x)} ${num(this.#y(y + h))} ${num(w)} ${num(h)} re`).join(' ');
    this.#op(`q ${hexToRgb(color).map(num).join(' ')} rg ${body} f Q`);
  }

  image(img, x, y, w, h) {
    this.#op(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.#y(y + h))} cm /${img.key} Do Q`);
  }

  /** Erzeugt die PDF-Datei als Bytes. */
  async save() {
    const objects = []; // Index + 1 = Objektnummer
    const reserve = () => { objects.push(null); return objects.length; };
    const set = (id, value) => { objects[id - 1] = value; };
    const stream = async (dict, data, { compress = true } = {}) => {
      const raw = typeof data === 'string' ? enc.encode(data) : data;
      const packed = compress ? await deflate(raw) : null;
      const bytes = packed ?? raw;
      return { dict: `<< ${dict}${packed ? ' /Filter /FlateDecode' : ''} /Length ${bytes.length} >>`, bytes };
    };

    const catalogId = reserve();
    const pagesId = reserve();

    // Schriften: Type0 + CIDFontType2 (Identity-H) + eingebettete TrueType-Datei + ToUnicode für Suche/Kopieren
    const fontRefs = [];
    for (const font of this.fonts) {
      if (!font.used.size) continue;
      const scale = 1000 / font.unitsPerEm;
      const gids = [...font.used.keys()].sort((a, b) => a - b);
      const widths = gids.map((g) => `${g} [${Math.round(font.advances[g] * scale)}]`).join(' ');
      const baseFont = `RGINV${String.fromCharCode(64 + Number(font.key.slice(1)))}+${font.name}`; // Teilmengen-Kennung: 6 Großbuchstaben

      const fileId = reserve();
      set(fileId, await stream(`/Length1 ${font.bytes.length}`, font.bytes));
      const descId = reserve();
      set(descId, `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 32 /FontBBox [${font.bbox.map((v) => Math.round(v * scale)).join(' ')}]`
        + ` /ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)}`
        + ` /CapHeight ${Math.round(font.capHeight * scale)} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
      const cidId = reserve();
      set(cidId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>`
        + ` /FontDescriptor ${descId} 0 R /CIDToGIDMap /Identity /DW 500 /W [${widths}] >>`);

      const toHex = (s) => [...s].map((ch) => {
        const c = ch.codePointAt(0);
        if (c <= 0xffff) return c.toString(16).padStart(4, '0');
        const v = c - 0x10000;
        return (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16);
      }).join('');
      const map = gids.map((g) => `<${g.toString(16).padStart(4, '0')}> <${toHex(font.used.get(g))}>`);
      const chunks = [];
      for (let i = 0; i < map.length; i += 100) chunks.push(`${Math.min(100, map.length - i)} beginbfchar\n${map.slice(i, i + 100).join('\n')}\nendbfchar`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n`
        + `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\n`
        + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const toUnicodeId = reserve();
      set(toUnicodeId, await stream('', cmap));
      const fontId = reserve();
      set(fontId, `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`);
      fontRefs.push(`/${font.key} ${fontId} 0 R`);
    }

    // Bilder: RGB, Transparenz als eigene Graustufen-Maske (SMask)
    const imageRefs = [];
    for (const img of this.images) {
      let smask = '';
      if (img.alpha) {
        const maskId = reserve();
        set(maskId, await stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha));
        smask = ` /SMask ${maskId} 0 R`;
      }
      const id = reserve();
      set(id, await stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, img.rgb));
      imageRefs.push(`/${img.key} ${id} 0 R`);
    }

    const resources = `<< /Font << ${fontRefs.join(' ')} >>${imageRefs.length ? ` /XObject << ${imageRefs.join(' ')} >>` : ''} /ProcSet [/PDF /Text /ImageB /ImageC] >>`;
    const pageIds = [];
    for (const page of this.pages) {
      const contentId = reserve();
      set(contentId, await stream('', page.ops.join('\n')));
      const pageId = reserve();
      set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);

    const date = this.info.date ?? new Date();
    const pdfDate = pdfDateString(date);

    // Angehängte Dateien (Embedded Files + Associated Files nach PDF/A-3)
    const fileSpecs = [];
    for (const file of this.attachments) {
      const efId = reserve();
      const ef = await stream(`/Type /EmbeddedFile /Subtype /${file.mime.replace('/', '#2F')} /Params << /ModDate (${pdfDateString(file.modified)}) /Size ${file.data.length} >>`, file.data);
      set(efId, ef);
      const fsId = reserve();
      set(fsId, `<< /Type /Filespec /F ${literal(file.name)} /UF ${textString(file.name)} /Desc ${textString(file.description)} /AFRelationship /${file.relationship} /EF << /F ${efId} 0 R /UF ${efId} 0 R >> >>`);
      fileSpecs.push({ name: file.name, id: fsId });
    }

    const info = {
      Title: this.info.title, Author: this.info.author, Subject: this.info.subject, Creator: this.info.creator, Producer: 'Rechnungsgenerator',
    };
    const catalog = [`/Type /Catalog /Pages ${pagesId} 0 R /Lang (de-DE) /ViewerPreferences << /DisplayDocTitle true >>`];
    if (fileSpecs.length) {
      const names = [...fileSpecs].sort((a, b) => (a.name < b.name ? -1 : 1)).map((f) => `${literal(f.name)} ${f.id} 0 R`).join(' ');
      catalog.push(`/Names << /EmbeddedFiles << /Names [${names}] >> >> /AF [${fileSpecs.map((f) => `${f.id} 0 R`).join(' ')}]`);
    }
    if (this.pdfa) {
      const metaId = reserve();
      set(metaId, await stream('/Type /Metadata /Subtype /XML', xmpPacket(info, date, this.pdfa.xmp ?? []), { compress: false }));
      const iccId = reserve();
      set(iccId, await stream('/N 3', this.pdfa.iccProfile));
      const intentId = reserve();
      set(intentId, `<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${iccId} 0 R >>`);
      catalog.push(`/Metadata ${metaId} 0 R /OutputIntents [${intentId} 0 R] /MarkInfo << /Marked false >>`);
    }
    set(catalogId, `<< ${catalog.join(' ')} >>`);

    const infoId = reserve();
    const infoEntries = Object.entries(info).filter(([, v]) => v).map(([k, v]) => `/${k} ${textString(v)}`);
    set(infoId, `<< ${infoEntries.join(' ')} /CreationDate (${pdfDate}) /ModDate (${pdfDate}) >>`);

    // Zusammensetzen mit Querverweistabelle (Byte-Positionen jedes Objekts)
    const chunks = [enc.encode('%PDF-1.7\n%âãÏÓ\n')];
    let length = chunks[0].length;
    const push = (part) => { const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); length += b.length; };
    const offsets = [];
    objects.forEach((obj, i) => {
      offsets.push(length);
      push(`${i + 1} 0 obj\n`);
      if (typeof obj === 'string') push(obj);
      else { push(`${obj.dict}\nstream\n`); push(obj.bytes); push('\nendstream'); }
      push('\nendobj\n');
    });
    const xref = length;
    const fileId = documentId(`${this.info.title}|${pdfDate}|${length}`);
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<${fileId}> <${fileId}>] >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }
}

/** Bricht Text auf eine Breite um (Wörter zuerst, überlange Wörter zeichenweise). Zeilenumbrüche bleiben erhalten. */
export function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/ +/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.width(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = '';
      // Wort passt alleine nicht → zeichenweise teilen
      let rest = word;
      while (font.width(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.width(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}
