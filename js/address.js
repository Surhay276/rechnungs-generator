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

/** Straßenvorschläge (nur Deutschland), Hausnummer aus der Eingabe wird übernommen, falls die Karte sie nicht kennt. */
export async function searchStreets(query, signal) {
  const params = new URLSearchParams({ q: query, lang: 'de', limit: '10', lat: '51.16', lon: '10.45' });
  params.append('layer', 'house');
  params.append('layer', 'street');
  const data = await getJson(`${PHOTON}?${params}`, signal);
  const typedNumber = /\s(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/.exec(query)?.[1]?.replace(/\s+/g, '');
  const seen = new Set();
  const results = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    if (p.countrycode !== 'DE' || !p.postcode || !(p.city || p.locality)) continue;
    const streetName = p.type === 'house' ? p.street : p.name;
    if (!streetName) continue;
    const number = p.housenumber || typedNumber || '';
    const street = `${streetName}${number ? ` ${number}` : ''}`;
    const city = p.city || p.locality;
    const key = `${street}|${p.postcode}|${city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ street, zip: p.postcode, city, district: p.district && p.district !== city ? p.district : '' });
    if (results.length === 6) break;
  }
  return results;
}

/** Orte zu einer PLZ (meist genau einer). */
export async function citiesForZip(zip, signal) {
  const data = await getJson(`${OPENPLZ}?postalCode=${encodeURIComponent(zip)}`, signal);
  return [...new Set((Array.isArray(data) ? data : []).map((l) => l.name).filter(Boolean))];
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/[^a-z]/g, '');
/** „Berlin-Neukölln“ passt zu „Berlin“, „Frankfurt am Main“ zu „Frankfurt a. Main“ nur grob – lieber großzügig. */
const cityMatches = (city, names) => names.some((n) => norm(city).startsWith(norm(n)) || norm(n).startsWith(norm(city)));

/** Kleines Auswahlmenü unter einem Eingabefeld (ARIA-Combobox). */
function createMenu(input, { attribution = false } = {}) {
  const id = `ac-${++uid}`;
  const pop = document.createElement('div');
  pop.className = 'ac-pop';
  pop.hidden = true;
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  pop.append(list);
  if (attribution) {
    const note = document.createElement('p');
    note.className = 'ac-note';
    note.innerHTML = 'Vorschläge: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';
    pop.append(note);
  }
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
 */
export function attachAddressLookup({ street, zip, city, enabled = () => true }) {
  const streetMenu = createMenu(street, { attribution: true });
  const zipMenu = createMenu(zip);
  let timer;
  let controller;
  const usable = (input) => enabled() && !input.disabled && navigator.onLine !== false;

  const abortable = () => { controller?.abort(); controller = new AbortController(); return controller.signal; };

  street.addEventListener('input', (e) => {
    clearTimeout(timer);
    if (!e.isTrusted) return; // selbst gesetzte Werte lösen keine Suche aus
    const q = street.value.trim();
    if (!usable(street) || (q.match(/\p{L}/gu) ?? []).length < 3) { streetMenu.close(); return; }
    timer = setTimeout(async () => {
      try {
        const results = await searchStreets(q, abortable());
        if (document.activeElement !== street || street.value.trim() !== q) return;
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
  });

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
