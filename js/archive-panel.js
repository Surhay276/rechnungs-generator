/**
 * Seitenfenster „Rechnungen“: Liste aller Rechnungen mit Status, Download der Originale,
 * Duplizieren, Stornieren und Löschen von Entwürfen.
 */
import { isLocked, copyAsDraft, createStorno, formatMoney, formatDate, kindOf, todayIso } from './invoice.js?v=28';
import { $, el, icon, toast } from './ui.js?v=28';
import { state, newInvoice, nextNumber, newId, totalsOf } from './store.js?v=28';

/** @param app  { openInvoice(id), resetEditor(), openDrawer(dialog), downloadPdf(inv), downloadXml(inv) } */
export function initArchivePanel(app) {
  const list = $('#invoice-list');

  function render() {
    const sorted = [...state.store.invoices].sort((a, b) => b.updatedAt - a.updatedAt);
    list.replaceChildren(...sorted.map((inv) => {
      const totals = totalsOf(inv);
      const kind = kindOf(inv);
      const sign = kind.key === 'storno' ? -1 : 1;
      const locked = isLocked(inv);
      const stornos = state.store.invoices.filter((o) => o.kind === 'storno' && o.reference?.number === inv.number);
      const stornoed = stornos.some(isLocked); // erst die abgeschlossene Stornorechnung storniert wirklich
      return el('li', { className: `invoice-row${inv.id === state.store.currentId ? ' is-current' : ''}` },
        el('button', { type: 'button', className: 'invoice-open', onclick: () => open(inv.id) },
          el('span', { className: 'invoice-number mono', textContent: inv.number || 'Ohne Nummer' }),
          el('span', { className: 'invoice-customer', textContent: [kind.key !== 'invoice' && kind.title, inv.customer.name || 'Kein Kunde'].filter(Boolean).join(' · ') }),
          el('span', { className: 'invoice-date', textContent: formatDate(inv.date) })),
        el('span', { className: 'invoice-amount mono', textContent: totals ? formatMoney(sign * totals.total, inv.currency || 'EUR') : '-' }),
        el('span', { className: `badge badge-${stornoed ? 'storno' : inv.status}` }, locked ? icon('lock') : '', stornoed ? 'Storniert' : locked ? 'Abgeschlossen' : 'Entwurf'),
        el('div', { className: 'invoice-actions' },
          locked && el('button', { type: 'button', className: 'icon-btn', title: 'PDF herunterladen', ariaLabel: `${inv.number} als PDF herunterladen`, onclick: () => app.downloadPdf(inv) }, icon('download')),
          locked && el('button', { type: 'button', className: 'icon-btn', title: 'E-Rechnung (XML) herunterladen', ariaLabel: `${inv.number} als E-Rechnung herunterladen`, onclick: () => app.downloadXml(inv) }, icon('code')),
          locked && kind.key !== 'storno' && !stornos.length && el('button', { type: 'button', className: 'icon-btn', title: 'Stornieren', ariaLabel: `${inv.number} stornieren`, onclick: () => storno(inv.id) }, icon('undo')),
          el('button', { type: 'button', className: 'icon-btn', title: 'Duplizieren', ariaLabel: `${inv.number} duplizieren`, onclick: () => duplicate(inv.id) }, icon('copy')),
          el('button', {
            type: 'button', className: 'icon-btn danger', disabled: locked,
            title: locked ? 'Abgeschlossene Rechnungen bleiben erhalten (Aufbewahrungspflicht)' : 'Löschen',
            ariaLabel: locked ? `${inv.number} ist abgeschlossen und kann nicht gelöscht werden` : `${inv.number} löschen`,
            onclick: () => remove(inv.id),
          }, icon('trash'))));
    }));
  }

  function open(id) {
    state.store.currentId = id;
    app.resetEditor();
    $('#archive').close();
  }
  function add(inv, message) {
    state.store.invoices.push(inv);
    open(inv.id);
    toast(message);
  }
  function duplicate(id) {
    const source = state.store.invoices.find((i) => i.id === id);
    const copy = copyAsDraft(source, { id: newId(), number: nextNumber(), date: todayIso() });
    add(copy, `Kopie als ${copy.number} angelegt`);
  }
  function storno(id) {
    const source = state.store.invoices.find((i) => i.id === id);
    const draft = createStorno(source, { id: newId(), number: nextNumber(), date: todayIso() });
    add(draft, `Stornorechnung ${draft.number} zu ${source.number} angelegt. Bitte prüfen und abschließen`);
  }
  function remove(id) {
    if (isLocked(state.store.invoices.find((i) => i.id === id))) return; // Aufbewahrungspflicht
    const before = structuredClone(state.store);
    state.store.invoices = state.store.invoices.filter((i) => i.id !== id);
    if (!state.store.invoices.length) state.store.invoices.push(newInvoice());
    if (!state.store.invoices.some((i) => i.id === state.store.currentId)) state.store.currentId = state.store.invoices[0].id;
    app.resetEditor();
    render();
    toast('Rechnung gelöscht', { label: 'Rückgängig', run: () => { state.store = before; app.resetEditor(); render(); } });
  }

  $('#open-archive').addEventListener('click', () => { render(); app.openDrawer($('#archive')); });
  $('#new-invoice').addEventListener('click', () => {
    const inv = newInvoice();
    add(inv, `${inv.number} angelegt`);
    $('[data-field="customer.name"]').focus();
  });

  return { render, open, duplicate, storno };
}
