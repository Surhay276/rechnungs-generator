# 🧾 Rechnungsgenerator

[![CI](https://github.com/Surhay276/rechnungs-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/Surhay276/rechnungs-generator/actions/workflows/ci.yml)
![Vanilla JS](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)
![Keine Abhängigkeiten](https://img.shields.io/badge/dependencies-0-brightgreen)

Rechnungen direkt im Browser erstellen – mit Live-Vorschau im A4-Format, korrekter Umsatzsteuer-Berechnung und PDF-Export. Alle Daten bleiben lokal, es gibt keinen Server.

**▶ Live-Demo: [surhay276.github.io/rechnungs-generator](https://surhay276.github.io/rechnungs-generator/)**

## Funktionen

- **Pflichtangaben-Check** mit Fortschrittsanzeige – zeigt sofort, was für eine gültige Rechnung noch fehlt
- **Mobil optimiert**: Umschalter Bearbeiten/Vorschau, Summenleiste mit Live-Betrag und PDF-Button, Positionen als gestapelte Karten, A4-Blatt skaliert automatisch
- **Live-Vorschau** der Rechnung im A4-Layout (inkl. Anschriftenfeld und Fußzeile)
- **Umsatzsteuer** mit 19 %, 7 % und 0 % – auch gemischt in einer Rechnung, getrennt ausgewiesen
- **Kleinunternehmerregelung** (§ 19 UStG) per Schalter, inkl. Pflichthinweis
- **Pflichtangaben-Prüfung** (vereinfacht nach § 14 Abs. 4 UStG) mit verständlichen Hinweisen
- **IBAN-Validierung** per ISO-13616-Prüfsumme (Modulo 97)
- **Fortlaufende Rechnungsnummern** (`RE-2026-0001`), Zähler beginnt jedes Jahr neu
- **Zahlungsziel** → Fälligkeitsdatum wird automatisch berechnet
- **PDF-Export** über die Druckfunktion des Browsers (eigenes Print-Stylesheet, Dateiname = Rechnungsnummer)
- Eingaben im deutschen Zahlenformat (`1.234,56`), automatische Speicherung im `localStorage`

## Technische Umsetzung

| Bereich | Umsetzung |
|---|---|
| Geldbeträge | Intern als **Ganzzahl in Cent** – keine Gleitkomma-Fehler (`0.1 + 0.2 ≠ 0.3`) |
| Steuerberechnung | Steuer wird **je Steuersatz auf die Nettosumme** berechnet, nicht je Zeile → keine Rundungsdifferenzen |
| Architektur | Rechenlogik (`js/invoice.js`) ist vom DOM getrennt und vollständig unit-getestet |
| Sicherheit | Vorschau wird ausschließlich mit `textContent` aufgebaut (kein `innerHTML` mit Nutzerdaten) |
| Tests | 12 Unit-Tests mit `node:test` (Zahlenformate, Rundung, Steuersätze, IBAN, Datumsgrenzen) |
| Design | Tokens angelehnt an **Untitled UI** (Teal), SVG-Icons, Schriften **lokal gehostet** (DSGVO – kein Google-Fonts-Abruf) |
| Responsive | Breakpoints bei 1100 px und 640 px, `safe-area-insets`, 16-px-Eingaben gegen iOS-Auto-Zoom |
| CI/CD | GitHub Actions führt die Tests bei jedem Push aus; Deployment über GitHub Pages |

```
rechnungs-generator/
├── index.html            # Formular, Vorlage für Positionen
├── css/style.css         # Layout, A4-Vorschau, Print-Stylesheet
├── js/invoice.js         # Rechenlogik: Cent-Arithmetik, USt, IBAN, Validierung
├── js/app.js             # Formular-Bindung, Live-Vorschau, Persistenz
└── tests/invoice.test.js # Unit-Tests
```

## Lokal starten

```bash
git clone https://github.com/Surhay276/rechnungs-generator.git
cd rechnungs-generator
npm start      # statischer Server
npm test       # Unit-Tests (Node ≥ 20)
```

> Hinweis: Das Projekt ist ein Portfolio-Projekt und ersetzt keine Buchhaltungssoftware oder steuerliche Beratung. Die Beispieldaten sind fiktiv.

## Mögliche Erweiterungen

- E-Rechnung (XRechnung / ZUGFeRD) als XML-Export
- Kundenstamm und Rechnungsarchiv (z. B. mit Spring Boot + PostgreSQL)
- Mehrsprachige Rechnungen und weitere Währungen

---

Entwickelt von **Surhay Yilmaz** · Lizenz: MIT
