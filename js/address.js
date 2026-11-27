/**
 * Adressvorschläge beim Tippen – für die Kundenanschrift und die eigene Firmenanschrift.
 *
 * - Straße: Vorschläge mit Hausnummer, PLZ und Ort über Photon (OpenStreetMap-Daten, komoot).
 *   Ein Klick füllt Straße, PLZ und Ort auf einmal.
 * - PLZ: Der Ort wird über die OpenPLZ API (amtliche Daten) ergänzt; passt ein eingetragener Ort nicht
 *   zur PLZ, erscheint ein Hinweis mit „Übernehmen“.
 *
 * Gesendet wird nur der getippte Adresstext – keine anderen Rechnungsdaten. Ohne Netz gibt es einfach
 * keine Vorschläge; die Eingabe funktioniert weiter wie gewohnt.
 */

const PHOTON = 'https://photon.komoot.io/api/';
const OPENPLZ = 'https://openplzapi.org/de/Localities';
const DEBOUNCE = 250;
let uid = 0;

const cache = new Map();
async function getJson(url, signal) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache.set(url, data);
  return data;
}

// Deutschland als Suchgebiet (minLon, minLat, maxLon, maxLat) – keine Treffer aus dem Ausland
const BBOX_DE = '5.86,47.27,15.05,55.06';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss')
  .replace(/str\.(?=\s|$)/g, 'strasse').replace(/[^a-z0-9]+/g, ' ').trim();

/** Zerlegt „Sonnenallee 18a“ in Straßenteil und Hausnummer. */
export function splitStreet(input) {
  const m = /^(.*?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/.exec(String(input).trim());
  return m ? { name: m[1].trim(), number: m[2].replace(/\s+/g, '') } : { name: String(input).trim(), number: '' };
}

/**
 * Wie gut passt ein Straßenname zur Eingabe? Jedes getippte Wort muss der Anfang eines Wortes im Namen sein
 * („sonn“ → „Sonnenallee“, „karl marx“ → „Karl-Marx-Allee“, „hauptstr“ → „Hauptstraße“). Sonst kein Treffer.
 */
export function matchScore(typed, streetName) {
  const want = norm(typed).split(' ').filter(Boolean);
  if (!want.length) return 0;
  const name = norm(streetName);
  const words = name.split(' ');
  const joined = name.replace(/ /g, '');
  for (const w of want) {
    if (!words.some((x) => x.startsWith(w)) && !(want.length === 1 && joined.startsWith(w))) return 0;
  }
  if (name === want.join(' ')) return 3; // exakt
  return name.startsWith(want[0]) ? 2 : 1; // beginnt mit der Eingabe > Wort mittendrin
}

const distanceKm = (a, b) => {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
};

/**
 * Straßenvorschläge (nur Deutschland).
 * @param query   getippter Text, z. B. „Sonnenallee 1“
 * @param bias    { lat, lon, near } – Bezugspunkt für die Sortierung (Standort mit Einwilligung oder eigener Firmensitz)
 * @param zip     bereits eingetragene PLZ – Treffer dort zuerst
 */
export async function searchStreets(query, { bias = null, zip = '', signal } = {}) {
  const { name: typedName, number: typedNumber } = splitStreet(query);
  const params = new URLSearchParams({ q: query, lang: 'de', limit: '25', bbox: BBOX_DE });
  params.append('layer', 'house');
  params.append('layer', 'street');
  if (bias) {
    params.set('lat', bias.lat.toFixed(2));
    params.set('lon', bias.lon.toFixed(2));
    params.set('zoom', bias.near ? '13' : '11'); // Umkreis, in dem Nähe zählt
    params.set('location_bias_scale', '0.1'); // Nähe wichtiger als Bekanntheit
  }
  const data = await getJson(`${PHOTON}?${params}`, signal);

  const candidates = [];
  (data.features ?? []).forEach((f, order) => {
    const p = f.properties ?? {};
    const city = p.city || p.locality || p.county;
    if (p.countrycode !== 'DE' || !p.postcode || !city) return;
    const streetName = p.type === 'house' ? p.street : p.name;
    if (!streetName) return;
    const score = matchScore(typedName, streetName);
    if (!score) return; // unscharfe Treffer („Sonn“ → „Johannisstraße“) fliegen raus
    const [lon, lat] = f.geometry?.coordinates ?? [];
    // Ohne getippte Hausnummer: eine Zeile je Straße statt je Haus. Mit Nummer: passende Häuser zuerst.
    const number = typedNumber ? (p.type === 'house' ? p.housenumber : typedNumber) : '';
    if (typedNumber && p.type === 'house' && norm(p.housenumber) !== norm(typedNumber) && !norm(p.housenumber).startsWith(norm(typedNumber))) return;
    candidates.push({
      street: `${streetName}${number ? ` ${number}` : ''}`,
      zip: p.postcode,
      city,
      district: p.district && p.district !== city ? p.district : '',
      exactHouse: Boolean(typedNumber && p.type === 'house' && norm(p.housenumber) === norm(typedNumber)),
      score,
      order,
      km: bias && Number.isFinite(lat) ? distanceKm(bias, { lat, lon }) : null,
    });
  });

  const rank = (c) => [
    zip && c.zip === zip ? 0 : 1, // gleiche PLZ wie schon eingetragen
    c.exactHouse ? 0 : 1,
    -c.score,
    c.km === null ? 0 : Math.round(c.km / 5), // in 5-km-Stufen: nahe Treffer vor fernen
    c.order, // sonst Reihenfolge von Photon
  ];
  candidates.sort((a, b) => {
    const ra = rank(a); const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${norm(c.street)}|${c.zip}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

/** Ungefähre Koordinaten eines Orts (für die Sortierung nach Nähe zum eigenen Firmensitz). */
export async function locatePlace(zip, city, signal) {
  const params = new URLSearchParams({ q: `${zip} ${city}`.trim(), lang: 'de', limit: '1', bbox: BBOX_DE });
  const data = await getJson(`${PHOTON}?${params}`, signal);
  const [lon, lat] = data.features?.[0]?.geometry?.coordinates ?? [];
  return Number.isFinite(lat) ? { lat, lon } : null;
}

/** Orte zu einer PLZ (meist genau einer). */
export async function citiesForZip(zip, signal) {
  const data = await getJson(`${OPENPLZ}?postalCode=${encodeURIComponent(zip)}`, signal);
  return [...new Set((Array.isArray(data) ? data : []).map((l) => l.name).filter(Boolean))];
}

/** „Berlin-Neukölln“ passt zu „Berlin“, „Frankfurt am Main“ zu „Frankfurt a. Main“ nur grob – lieber großzügig. */
const cityKey = (s) => norm(s).replace(/ /g, '');
const cityMatches = (city, names) => names.some((n) => cityKey(city).startsWith(cityKey(n)) || cityKey(n).startsWith(cityKey(city)));

/** Kleines Auswahlmenü unter einem Eingabefeld (ARIA-Combobox). */
function createMenu(input, { footer = null } = {}) {
  const id = `ac-${++uid}`;
  const pop = document.createElement('div');
  pop.className = 'ac-pop';
  pop.hidden = true;
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  pop.append(list);
  if (footer) pop.append(footer);
  // Klicks im Menü sollen das Eingabefeld nicht verlassen (sonst schließt „blur“ das Menü vorher)
  pop.addEventListener('pointerdown', (e) => { if (!e.target.closest('a')) e.preventDefault(); });
  const container = input.closest('.field') ?? input.parentElement;
  container.classList.add('ac-field');
  container.append(pop);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);

  let items = [];
  let active = -1;
  let onPick = () => {};

  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-${i}`);
      list.children[i].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    highlight(-1);
  };
  const open = (entries, pick) => {
    items = entries;
    onPick = pick;
    list.replaceChildren(...entries.map((e, i) => {
      const li = document.createElement('li');
      li.id = `${id}-${i}`;
      li.className = 'ac-option';
      li.setAttribute('role', 'option');
      const main = document.createElement('strong');
      main.textContent = e.label;
      li.append(main);
      if (e.sub) {
        const sub = document.createElement('span');
        sub.textContent = e.sub;
        li.append(sub);
      }
      return li;
    }));
    if (!entries.length) { close(); return; }
    pop.style.top = `${input.offsetTop + input.offsetHeight + 4}px`; // auch wenn darunter eine Fehlermeldung steht
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };
  const choose = (i) => { const item = items[i]; close(); if (item) onPick(item); };

  // pointerdown statt click: das Feld behält den Fokus, die Liste schließt nicht vorher durch „blur“
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.ac-option');
    if (!li) return;
    e.preventDefault();
    choose([...list.children].indexOf(li));
  });
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { open, close };
}

/** Hinweis (gelb) unter einem Feld – blockiert nichts, bietet aber eine Korrektur an. */
function setNotice(input, text, action) {
  const container = input.closest('.field') ?? input.parentElement;
  container.querySelector('.field-warn')?.remove();
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'field-warn';
  p.setAttribute('role', 'status');
  p.append(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn field-warn-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.run(); p.remove(); });
    p.append(btn);
  }
  container.append(p);
}

/** Wert setzen wie eine Eingabe des Nutzers – damit Speichern, Vorschau und Prüfung mitlaufen. */
function fill(input, value) {
  if (input.value === value) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Hängt die Vorschläge an drei Felder.
 * @param enabled  () => boolean – aus, wenn der Nutzer es abgeschaltet hat oder die Felder gesperrt sind
 * @param getBias  async () => { lat, lon, near } | null – Bezugspunkt für „Treffer in der Nähe zuerst“
 * @param nearby   { offer: () => boolean, request: () => Promise<boolean> } – Standort per Einwilligung anbieten
 */
export function attachAddressLookup({ street, zip, city, enabled = () => true, getBias = async () => null, nearby = null }) {
  const footer = document.createElement('div');
  footer.className = 'ac-foot';
  const note = document.createElement('p');
  note.className = 'ac-note';
  note.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';
  const near = document.createElement('button');
  near.type = 'button';
  near.className = 'ac-near';
  near.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg>Treffer in meiner Nähe zuerst';
  near.addEventListener('click', async () => {
    streetMenu.close();
    if (await nearby.request()) { street.focus(); search(); }
  });
  footer.append(note, near);
  const streetMenu = createMenu(street, { footer });
  const zipMenu = createMenu(zip);
  let timer;
  let controller;
  const usable = (input) => enabled() && !input.disabled && navigator.onLine !== false;

  const abortable = () => { controller?.abort(); controller = new AbortController(); return controller.signal; };

  function search() {
    clearTimeout(timer);
    const q = street.value.trim();
    if (!usable(street) || (q.match(/\p{L}/gu) ?? []).length < 3) { streetMenu.close(); return; }
    timer = setTimeout(async () => {
      try {
        const signal = abortable();
        const bias = await getBias(signal).catch(() => null);
        const results = await searchStreets(q, { bias, zip: /^\d{5}$/.test(zip.value.trim()) ? zip.value.trim() : '', signal });
        if (document.activeElement !== street || street.value.trim() !== q) return;
        near.hidden = !(nearby?.offer() && !bias?.near);
        streetMenu.open(results.map((r) => ({ ...r, label: r.street, sub: `${r.zip} ${r.city}${r.district ? ` · ${r.district}` : ''}` })), (r) => {
          fill(street, r.street);
          fill(zip, r.zip);
          fill(city, r.city);
          setNotice(zip, '');
          setNotice(city, '');
          // Fehlt die Hausnummer noch, gleich dorthin
          if (!/\d/.test(r.street)) { street.focus(); street.setSelectionRange(street.value.length, street.value.length); }
        });
      } catch { streetMenu.close(); /* offline oder abgebrochen */ }
    }, DEBOUNCE);
  }
  street.addEventListener('input', (e) => { if (e.isTrusted) search(); }); // selbst gesetzte Werte lösen keine Suche aus

  async function checkZip({ fromTyping = false } = {}) {
    const value = zip.value.trim();
    setNotice(zip, '');
    if (!/^\d{5}$/.test(value) || !usable(zip)) { zipMenu.close(); return; }
    let names;
    try { names = await citiesForZip(value, abortable()); } catch { return; }
    if (zip.value.trim() !== value) return;
    if (!names.length) {
      setNotice(zip, 'Diese Postleitzahl ist nicht bekannt – bitte prüfen.');
      return;
    }
    const current = city.value.trim();
    if (!current) {
      if (names.length === 1) fill(city, names[0]);
      else if (fromTyping) zipMenu.open(names.map((n) => ({ label: `${value} ${n}`, name: n })), (item) => fill(city, item.name));
      return;
    }
    checkCity(names);
  }

  async function checkCity(known) {
    setNotice(city, '');
    const value = zip.value.trim();
    const current = city.value.trim();
    if (!/^\d{5}$/.test(value) || !current || !usable(city)) return;
    let names = known;
    try { names ??= await citiesForZip(value, abortable()); } catch { return; }
    if (!names.length || cityMatches(current, names)) return;
    setNotice(city, `Zur PLZ ${value} gehört ${names.join(' oder ')}. `, names.length === 1 ? { label: 'Übernehmen', run: () => fill(city, names[0]) } : null);
  }

  zip.addEventListener('input', (e) => { if (e.isTrusted) checkZip({ fromTyping: true }); });
  city.addEventListener('change', () => checkCity());
  city.addEventListener('input', (e) => { if (e.isTrusted) setNotice(city, ''); });

  return {
    /** Nach dem Laden einer anderen Rechnung: alte Hinweise weg. */
    reset() { streetMenu.close(); zipMenu.close(); setNotice(zip, ''); setNotice(city, ''); },
  };
}
