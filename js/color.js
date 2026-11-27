// Farblogik für das Rechnungsdesign: ohne DOM, damit sie mit node --test prüfbar ist.

export const DEFAULT_COLOR = '#1D2939';

/** Vorgaben: gedeckte Töne, die gedruckt und auf weißem Papier gut aussehen. */
export const PRESET_COLORS = [
  { hex: '#1D2939', name: 'Anthrazit' },
  { hex: '#1849A9', name: 'Königsblau' },
  { hex: '#107569', name: 'Petrol' },
  { hex: '#087443', name: 'Tannengrün' },
  { hex: '#5925DC', name: 'Violett' },
  { hex: '#C11574', name: 'Beere' },
  { hex: '#B42318', name: 'Weinrot' },
  { hex: '#B54708', name: 'Bernstein' },
];

/** Normalisiert Eingaben wie „0e9384“, „#0E9“ oder „#0e9384“ zu „#0E9384“; ungültig → null. */
export function normalizeHex(value) {
  let v = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null;
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Relative Leuchtdichte nach WCAG 2.x. */
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis zweier Farben (1 bis 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mischt `hex` mit `other`; amount = Anteil von `other` (0-1). */
export function mix(hex, other, amount) {
  const a = toRgb(hex);
  const b = toRgb(other);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

/** Dunkelt eine Farbe schrittweise ab, bis sie auf Weiß den Mindestkontrast erreicht. */
export function readableOnWhite(hex, min = 4.5) {
  let color = hex;
  for (let step = 0; step < 20 && contrast(color, '#FFFFFF') < min; step++) color = mix(color, '#101828', 0.12);
  return color;
}

/**
 * Leitet aus einer gewählten Farbe alle Töne für das Blatt ab:
 * - accent: Fläche (Tabellenkopf bei „gefüllt“)
 * - onAccent: Schrift auf der Fläche (weiß oder dunkel: je nachdem, was lesbarer ist)
 * - text: Farbe für Titel und Überschriften auf Weiß (mind. 4,5 : 1)
 * - soft: helle Tönung (Gesamtbetrag, Tabellenkopf bei „hell“)
 * - line: zarte Linie in der Farbe
 */
export function invoiceTheme(value) {
  const accent = normalizeHex(value) ?? DEFAULT_COLOR;
  const onAccent = contrast(accent, '#FFFFFF') >= contrast(accent, '#101828') ? '#FFFFFF' : '#101828';
  const text = readableOnWhite(accent);
  return { accent, onAccent, text, soft: mix(accent, '#FFFFFF', 0.9), line: mix(accent, '#FFFFFF', 0.75) };
}

/** HSV (Farbton 0-360°, Sättigung 0-1, Helligkeit 0-1) → Hex. Grundlage für das Farbrad. */
export function hsvToHex(h, s, v) {
  const hue = ((h % 360) + 360) % 360;
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex([f(5), f(3), f(1)].map((c) => c * 255));
}

/** Hex → HSV, damit das Farbrad mit der aktuell gewählten Farbe startet. */
export function hexToHsv(value) {
  const hex = normalizeHex(value) ?? DEFAULT_COLOR;
  const [r, g, b] = toRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
