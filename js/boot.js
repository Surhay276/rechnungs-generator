// Läuft vor dem Rendern (klassisches Skript im <head>, kein Modul): als eigene Datei,
// damit die Content-Security-Policy keine Inline-Skripte erlauben muss.

// Standard: hell. Dunkel nur, wenn der Nutzer es eingeschaltet hat (→ kein Aufblitzen).
document.documentElement.dataset.theme = 'light';
try { if (localStorage.getItem('rechnungen:theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch { /* ignorieren */ }

// Immer die aktuelle Version zeigen: GitHub Pages erlaubt keine eigenen Cache-Regeln, und manche
// Browser (z. B. In-App-Browser) halten alte Seiten lange vor. Daher: aktuelle Versionsnummer am
// Cache vorbei abfragen und bei Abweichung die Seite einmal frisch laden.
(() => {
  const current = document.querySelector('meta[name="app-version"]')?.content;
  const key = `fresh:${location.pathname}`;
  fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const latest = data && String(data.version);
      if (!latest || latest === current) { try { sessionStorage.removeItem(key); } catch { /* egal */ } return undefined; }
      try { if (sessionStorage.getItem(key) === latest) return undefined; sessionStorage.setItem(key, latest); } catch { return undefined; }
      // Seite im Browser-Cache durch die neue ersetzen, dann neu laden
      return fetch(location.href, { cache: 'reload' }).finally(() => location.reload());
    })
    .catch(() => { /* offline → einfach die vorhandene Version zeigen */ });
})();
