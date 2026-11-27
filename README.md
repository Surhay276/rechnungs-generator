# 🧾 Rechnungsgenerator

[![CI](https://github.com/Surhay276/rechnungs-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/Surhay276/rechnungs-generator/actions/workflows/ci.yml)
![Vanilla JS](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=black)
![Abhängigkeiten](https://img.shields.io/badge/dependencies-0-brightgreen)
![XRechnung](https://img.shields.io/badge/E--Rechnung-XRechnung%203.0-0E9384)

Rechnungen direkt im Browser erstellen – Schritt für Schritt, mit Live-Vorschau, GiroCode und E-Rechnung. Alle Daten bleiben lokal, es gibt keinen Server.

**▶ Live-Demo: [surhay276.github.io/rechnungs-generator](https://surhay276.github.io/rechnungs-generator/)**

![Rechnungsgenerator am Desktop: Formular links, A4-Vorschau rechts](docs/screenshot-desktop.png)

<p>
  <img src="docs/screenshot-mobil.png" alt="Mobile Ansicht mit Vorschau und Summenleiste" width="260">
  <img src="docs/screenshot-dark.png" alt="Dunkles Design, Schritt Zahlung und Texte" width="560">
</p>

## Funktionen

**Rechnung erstellen**
- Geführter Ablauf in **drei Schritten** (Rechnungsdetails → Leistungen → Zahlung & Texte), Aufbau angelehnt an Qonto
- **Kundenliste**: Kunden speichern und mit einem Klick übernehmen
- **Zahlungsfrist** per Auswahl (sofort, 14/30/45/60 Tage oder eigenes Datum), **Leistungszeitraum** von–bis
- Leistungen mit Einheit, **Netto- oder Bruttopreis** (wird automatisch umgerechnet) und **Rabatt** je Position
- **Rabatt auf den Gesamtbetrag** in Euro oder Prozent
- **Skonto** bei schneller Zahlung, **Kleinunternehmerregelung** (§ 19 UStG)
- Kopfzeile und Anmerkungen als Vorlage für neue Rechnungen speichern

**Prüfen & Exportieren**
- **Pflichtfeld-Prüfung** nach § 14 UStG: fehlende Angaben werden direkt am Feld markiert, der Export springt dorthin
- **GiroCode** (EPC-QR) auf der Rechnung – Kunden zahlen per Banking-App ohne Abtippen
- **PDF** über die Druckfunktion des Browsers (eigenes A4-Druck-Layout)
- **E-Rechnung im Format XRechnung 3.0** (XML nach EN 16931, Syntax UBL)

**Verwalten**
- **Rechnungsarchiv** mit Status (Entwurf/Erstellt), Duplizieren und Löschen mit Rückgängig
- **Einstellungen** für Firmendaten, Bankverbindung und **Logo-Upload**
- Vorschau am Desktop als **ganze Seite** mit Zoom (+/−, Strg/⌘ + Mausrad, Touchpad)
- **Heller Standard-Modus und Dark Mode**, mobil optimiert bis 280 px Breite

## Entscheidungen

**Warum ohne Framework?** Die App ist klein genug, um sie mit reinem JavaScript sauber zu strukturieren. Kein Build-Schritt, keine Abhängigkeiten, die veralten – und jede Zeile ist nachvollziehbar. Die Trennung von Logik und Oberfläche übernimmt die Rolle, die sonst ein Framework spielt.

**Warum Geldbeträge in Cent?** In JavaScript ist `0.1 + 0.2 !== 0.3`. Rechnungen müssen auf den Cent stimmen, deshalb rechnet die App intern nur mit ganzen Cent-Beträgen und formatiert erst bei der Ausgabe.

**Warum Steuer je Steuersatz statt je Zeile?** Wird die Umsatzsteuer je Position gerundet, weicht die Summe schnell um Cents ab. Die App berechnet sie auf die Summe je Steuersatz – so, wie es auch die Rechenregeln der E-Rechnung (EN 16931) vorsehen.

**Wie wird ein Gesamtrabatt bei mehreren Steuersätzen verteilt?** Anteilig nach dem Verfahren der größten Reste. So mindert der Rabatt jede Steuerbasis korrekt und die Summe stimmt trotzdem auf den Cent.

**Warum strukturierte Adressen?** Für die E-Rechnung müssen Straße, PLZ und Ort einzeln vorliegen. Freitext-Adressen hätten zu ungültigen Dateien geführt.

**Warum keine Daten auf einem Server?** Rechnungsdaten sind sensibel. Alles bleibt im `localStorage` des Browsers, Schriften und die QR-Bibliothek werden lokal ausgeliefert – es gehen keine Daten an Dritte.

## Technische Umsetzung

| Bereich | Umsetzung |
|---|---|
| Architektur | Rechenlogik (`js/invoice.js`) ohne DOM, vollständig getestet; Oberfläche in `js/app.js` |
| E-Rechnung | XML nach XRechnung 3.0 (UBL 2.1); Beispiel-Dateien gegen das offizielle UBL-Schema und die EN-16931-Rechenregeln geprüft |
| GiroCode | Inhalt nach EPC069-12 (Version 002, UTF-8); QR-Code über [qrcode-generator](js/vendor/README.md) (MIT), lokal eingebunden |
| Sicherheit | Ausgabe nur über `textContent`, XML-Werte werden escaped; keine externen Anfragen |
| Tests | 16 Unit-Tests mit `node:test` – Rundung, Rabattverteilung, Skonto, IBAN, GiroCode, Pflichtangaben, XML-Summen |
| Barrierefreiheit | Beschriftete Felder, Fehler per `aria-invalid`/`aria-describedby`, sichtbarer Fokus, `prefers-reduced-motion` |
| CI/CD | GitHub Actions testet jeden Push, Deployment über GitHub Pages |

```
rechnungs-generator/
├── index.html                     # Aufbau: Schritte, Vorschau, Seitenfenster
├── css/style.css                  # Tokens (hell/dunkel), Layout, Druck-Layout
├── js/invoice.js                  # Logik: Cent-Arithmetik, USt, Rabatte, Skonto, GiroCode, XRechnung
├── js/app.js                      # Oberfläche, Speicherung, Vorschau, Export
├── js/vendor/                     # QR-Bibliothek (MIT)
├── scripts/samples.mjs            # Beispieldaten für Demo und Tests
├── scripts/xrechnung-samples.mjs  # erzeugt Beispiel-E-Rechnungen
└── tests/invoice.test.js          # Unit-Tests
```

## Lokal starten

```bash
git clone https://github.com/Surhay276/rechnungs-generator.git
cd rechnungs-generator
npm start                                   # statischer Server
npm test                                    # Unit-Tests (Node ≥ 20)
node scripts/xrechnung-samples.mjs out/     # Beispiel-E-Rechnungen erzeugen
```

> Portfolio-Projekt – ersetzt keine Buchhaltungssoftware oder steuerliche Beratung. Beispieldaten und die Muster-IBAN sind fiktiv. Vor dem produktiven Einsatz von E-Rechnungen sollten die Dateien mit dem offiziellen [KoSIT-Validator](https://github.com/itplr-kosit/validator) geprüft werden.

---

Entwickelt von **Hüseyin Surhay Yilmaz** · Lizenz: MIT
