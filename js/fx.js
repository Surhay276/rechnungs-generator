/**
 * Wechselkurse: EZB-Referenzkurse über die Frankfurter-API (frei, ohne Schlüssel).
 * Gesendet werden nur Währung und Datum, keine Rechnungsdaten.
 *
 * Maßgeblich ist der Kurs zum Rechnungsdatum. An Wochenenden und Feiertagen liefert die EZB keinen Kurs,
 * die API gibt dann den letzten Bankarbeitstag davor zurück (dessen Datum wird mitgespeichert).
 */
const API = 'https://api.frankfurter.dev/v1';
const cache = new Map();

/** Kurs „1 <Währung> = x EUR“ als deutscher Dezimaltext (z. B. „1,0925“) samt Kursdatum. */
export async function fetchRate(currency, date, { today = new Date().toISOString().slice(0, 10), signal } = {}) {
  const day = !date || date > today ? 'latest' : date;
  const key = `${currency}:${day}`;
  if (!cache.has(key)) {
    const request = fetch(`${API}/${day}?base=${encodeURIComponent(currency)}&symbols=EUR`, { signal, referrerPolicy: 'no-referrer' })
      .then((r) => {
        if (!r.ok) throw new Error(`Kurs nicht verfügbar (${r.status})`);
        return r.json();
      })
      .then((data) => {
        const rate = Number(data?.rates?.EUR);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('Kurs nicht verfügbar');
        return { rate: String(rate).replace('.', ','), date: data.date, source: 'EZB' };
      });
    cache.set(key, request.catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
