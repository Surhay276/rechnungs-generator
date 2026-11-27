/**
 * Fiktive Beispieldaten – für die Demo, die Unit-Tests und die E-Rechnungs-Prüfung in der CI.
 * Die IBAN ist die offizielle Muster-IBAN aus der Bankendokumentation, kein echtes Konto.
 */
export const sampleSettings = () => ({
  company: {
    name: 'Max Mustermann Webdesign',
    contact: 'Max Mustermann',
    street: 'Musterstraße 12',
    zip: '10115',
    city: 'Berlin',
    country: 'DE',
    taxId: '12/345/67890',
    vatId: '',
    email: 'kontakt@mustermann-web.de',
    phone: '030 1234567',
    iban: 'DE89 3704 0044 0532 0130 00', // pragma: allowlist secret
    bic: '',
    bank: 'Musterbank Berlin',
    logo: '',
    legalForm: 'einzel',
    registerCourt: '',
    registerNumber: '',
    officers: '',
  },
  kleinunternehmer: false,
  numberFormat: { pattern: 'RE-{JJJJ}-{NR}', digits: 4 },
  defaults: {
    intro: 'Sehr geehrte Damen und Herren,\nvielen Dank für Ihren Auftrag. Für die erbrachten Leistungen stelle ich Ihnen Folgendes in Rechnung:',
    note: 'Ich freue mich auf die weitere Zusammenarbeit.\n\nMit freundlichen Grüßen\nMax Mustermann',
    paymentDays: 14,
  },
});

export const sampleInvoice = (date = '2026-11-27') => ({
  id: 'beispiel',
  number: 'RE-2026-0001',
  kind: 'invoice',
  status: 'entwurf',
  date,
  paymentDays: 14,
  dueDate: '',
  serviceMode: 'period',
  serviceFrom: '2026-11-01',
  serviceTo: '2026-11-20',
  currency: 'EUR',
  pricesGross: false,
  customer: {
    id: 'k-baeckerei',
    name: 'Beispiel Bäckerei GmbH',
    street: 'Hauptstraße 5',
    zip: '12043',
    city: 'Berlin',
    country: 'DE',
    email: 'buchhaltung@beispiel-baeckerei.de',
    vatId: '',
    reference: '',
    isPublic: false,
  },
  items: [
    { description: 'Konzeption & Design OnePager', details: 'Startseite, Leistungen, Kontakt', quantity: '1', unit: 'LS', unitPrice: '850,00', taxType: 'S19', discount: null },
    { description: 'Umsetzung & Responsive-Optimierung', details: '', quantity: '6,5', unit: 'HUR', unitPrice: '65,00', taxType: 'S19', discount: { type: 'percent', value: '10' } },
    { description: 'Fachbuch „Webdesign Basics“', details: '', quantity: '1', unit: 'H87', unitPrice: '29,90', taxType: 'S7', discount: null },
  ],
  discount: { type: 'amount', value: '' },
  exemptionReason: '',
  retentionNotice: false,
  skonto: { enabled: true, percent: '2', days: 7 },
  giroCode: true,
  intro: sampleSettings().defaults.intro,
  note: sampleSettings().defaults.note,
});
