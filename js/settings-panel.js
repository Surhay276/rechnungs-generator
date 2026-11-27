/**
 * Seitenfenster „Einstellungen“: Firmendaten, Rechtsform, Steuer, Bank, Design, Nummernformat, Kunden, Daten.
 */
import {
  LEGAL_FORMS, guessLegalForm, numberPatternError, isLocked, countryOptions, nameError, streetError, checkZip, cityError, isValidEmail, vatIdError, leitwegIdError,
} from './invoice.js?v=28';
import { DEFAULT_COLOR, PRESET_COLORS, normalizeHex, hsvToHex, hexToHsv } from './color.js?v=28';
import { $, $$, el, icon, getPath, setPath, fillSelect, toast, confirmDialog } from './ui.js?v=28';
import { state, settings, design, nextNumber, seed, demo, normalize, persist, save, newInvoice } from './store.js?v=28';
import { applyDesign } from './preview.js?v=28';
import { exportBackup, importBackup } from './export.js?v=28';

/**
 * @param app  Rückrufe in die Hauptansicht: update, renderItems, renderBankSummary, renderFieldErrors, touch,
 *             requestGeo, revokeGeo, openDrawer, resetEditor, companyMissing
 */
export function initSettingsPanel(app) {
  const form = $('#settings-form');

  // ---------- Rechtsform ----------
  fillSelect($('#legal-form'), [{ value: '', text: 'Bitte wählen …' }, ...Object.entries(LEGAL_FORMS).map(([value, f]) => ({ value, text: f.label }))]);
  function renderLegal() {
    const c = settings().company;
    const form = LEGAL_FORMS[c.legalForm];
    for (const f of $$('[data-legal="register"]')) f.hidden = !form?.register;
    $('[data-legal="officers"]').hidden = !form?.officers;
    $('#officers-label').textContent = form?.officersLabel ?? 'Geschäftsführer';
    // Rechtsform im Namen, aber noch nicht gewählt → Bereich aufklappen
    if (!c.legalForm && guessLegalForm(c.name)) $('#legal-more').open = true;
  }

  // ---------- Nummernformat ----------
  function renderNumberPreview() {
    const problem = numberPatternError(settings().numberFormat?.pattern);
    $('#number-preview').textContent = problem ? '-' : nextNumber();
    const input = $('[data-setting="numberFormat.pattern"]');
    input.setAttribute('aria-invalid', String(Boolean(problem)));
    input.title = problem ?? '';
  }

  // ---------- Design: Farbfelder, Farbrad, Hex-Feld, Tabellenkopf ----------
  const swatchBox = $('#swatches');
  const customSwatch = $('#swatch-custom');
  swatchBox.prepend(...PRESET_COLORS.map(({ hex, name }) => {
    const b = el('button', { type: 'button', className: 'swatch', title: name });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.dataset.color = hex;
    b.style.setProperty('--swatch', hex);
    return b;
  }));

  function renderDesign() {
    const { color, head } = design();
    const preset = PRESET_COLORS.some((p) => p.hex === color);
    for (const b of $$('.swatch[data-color]', swatchBox)) {
      const on = b.dataset.color === color;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (!preset && b === swatchBox.firstElementChild) ? 0 : -1;
    }
    customSwatch.classList.toggle('is-active', !preset);
    customSwatch.style.setProperty('--swatch', preset ? 'transparent' : color);
    const hexInput = $('#hex-input');
    if (document.activeElement !== hexInput) { hexInput.value = color; hexInput.classList.remove('is-invalid'); }
    $('#hex-dot').style.background = color;
    for (const chip of $$('#head-chips .chip')) {
      const on = chip.dataset.head === head;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-checked', String(on));
    }
    $('#design-reset').hidden = color === DEFAULT_COLOR && head === 'filled';
    applyDesign($('#design-sample'), settings());
  }
  function setDesign(patch) {
    settings().design = { ...design(), ...patch };
    renderDesign();
    app.update();
  }
  swatchBox.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch[data-color]');
    if (b) { closeWheel(); setDesign({ color: b.dataset.color }); }
  });
  swatchBox.addEventListener('keydown', (e) => {
    const list = $$('.swatch[data-color]', swatchBox);
    const i = list.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const next = list[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    next.focus();
    setDesign({ color: next.dataset.color });
  });

  // Eigenes Farbrad statt des Browser-Farbwählers (der sieht z. B. auf Android völlig anders aus).
  // Farbton = Winkel, Sättigung = Abstand zur Mitte, Helligkeit = Regler daneben.
  const wheelPanel = $('#wheel-panel');
  const wheel = $('#wheel');
  const wheelHandle = $('#wheel-handle');
  let wheelState = null; // { h, s, v, before }
  function renderWheel() {
    const { h, s, v } = wheelState;
    const hex = hsvToHex(h, s, v);
    const rad = (h * Math.PI) / 180;
    wheelHandle.style.left = `${50 + Math.cos(rad) * s * 50}%`;
    wheelHandle.style.top = `${50 + Math.sin(rad) * s * 50}%`;
    wheelHandle.style.background = hex;
    wheelHandle.setAttribute('aria-valuetext', hex);
    const range = $('#wheel-value');
    range.value = String(Math.round(v * 100));
    range.style.setProperty('--range-to', hsvToHex(h, s, 1));
    $('#wheel-swatch').style.background = hex;
    $('#wheel-hex').textContent = hex;
  }
  function setWheel(patch) {
    Object.assign(wheelState, patch);
    renderWheel();
    setDesign({ color: hsvToHex(wheelState.h, wheelState.s, wheelState.v) });
  }
  function openWheel() {
    const { color } = design();
    wheelState = { ...hexToHsv(color), before: color };
    wheelPanel.hidden = false;
    customSwatch.setAttribute('aria-expanded', 'true');
    renderWheel();
    wheelPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function closeWheel(restore = false) {
    if (!wheelState) return;
    if (restore) setDesign({ color: wheelState.before });
    wheelState = null;
    wheelPanel.hidden = true;
    customSwatch.setAttribute('aria-expanded', 'false');
  }
  customSwatch.addEventListener('click', () => (wheelState ? closeWheel() : openWheel()));
  $('#wheel-apply').addEventListener('click', () => { closeWheel(); customSwatch.focus(); });
  $('#wheel-cancel').addEventListener('click', () => { closeWheel(true); customSwatch.focus(); });
  $('#wheel-value').addEventListener('input', (e) => setWheel({ v: Number(e.target.value) / 100 }));
  function pickFromWheel(e) {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    // Wer bei sehr dunkler Helligkeit ins Rad tippt, will die angetippte Farbe sehen → kräftiger Wert
    setWheel(wheelState.v < 0.4 ? { h, s, v: 0.75 } : { h, s });
  }
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wheel.setPointerCapture(e.pointerId);
    wheelHandle.focus({ preventScroll: true });
    pickFromWheel(e);
  });
  wheel.addEventListener('pointermove', (e) => { if (wheel.hasPointerCapture(e.pointerId)) pickFromWheel(e); });
  wheelHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 4;
    const moves = {
      ArrowRight: { h: wheelState.h + step }, ArrowLeft: { h: wheelState.h - step },
      ArrowUp: { s: Math.min(1, wheelState.s + step / 100) }, ArrowDown: { s: Math.max(0, wheelState.s - step / 100) },
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    const next = { ...moves[e.key] };
    if ('h' in next) next.h = (next.h + 360) % 360;
    setWheel(next);
  });
  $('#hex-input').addEventListener('input', (e) => {
    const hex = normalizeHex(e.target.value);
    e.target.classList.toggle('is-invalid', !hex && e.target.value.trim().length >= 4);
    if (!hex) return;
    setDesign({ color: hex });
    if (wheelState) { Object.assign(wheelState, hexToHsv(hex)); renderWheel(); }
  });
  $('#hex-input').addEventListener('blur', () => renderDesign());
  $('#head-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-head]');
    if (chip) setDesign({ head: chip.dataset.head });
  });
  $('#design-reset').addEventListener('click', () => { closeWheel(); setDesign({ color: DEFAULT_COLOR, head: 'filled' }); });

  // ---------- Logo ----------
  function renderLogo() {
    const logo = settings().company.logo;
    $('#logo-preview').replaceChildren(logo ? el('img', { src: logo, alt: 'Aktuelles Logo' }) : icon('image'));
    $('#logo-remove').hidden = !logo;
    $('#logo-btn-text').textContent = logo ? 'Ändern' : 'Hochladen';
  }
  $('#logo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { toast('Bitte ein Bild im Format PNG, JPG, SVG oder WebP wählen.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Das Bild ist größer als 5 MB.'); return; }
    try {
      settings().company.logo = await shrinkImage(file);
      renderLogo();
      app.update();
      toast('Logo übernommen');
    } catch {
      toast('Das Bild konnte nicht gelesen werden.');
    }
  });
  $('#logo-remove').addEventListener('click', () => { settings().company.logo = ''; renderLogo(); app.update(); });

  // ---------- Gespeicherte Kunden: nur hier bearbeitbar ----------
  let editingCustomer = null;
  const countries = countryOptions();
  const CUSTOMER_FIELDS = [
    { key: 'name', label: 'Name / Firma', check: (v) => (v.trim() ? nameError(v) : 'Bitte den Namen angeben.') },
    { key: 'street', label: 'Straße und Hausnummer', check: (v) => (v.trim() ? streetError(v) : 'Bitte Straße und Hausnummer angeben.') },
    { key: 'zip', label: 'PLZ', half: true, check: (v, c) => checkZip(v, c.country) },
    { key: 'city', label: 'Ort', half: true, check: (v) => (v.trim() ? cityError(v) : 'Bitte den Ort angeben.') },
    { key: 'country', label: 'Land', select: true },
    { key: 'email', label: 'E-Mail', type: 'email', check: (v) => (v.trim() && !isValidEmail(v) ? 'Diese E-Mail-Adresse ist ungültig.' : null) },
    { key: 'vatId', label: 'USt-IdNr.', mono: true, check: (v) => (v.trim() ? vatIdError(v) : null) },
    { key: 'reference', label: 'Käuferreferenz / Leitweg-ID', mono: true, check: (v, c) => ((c.isPublic || /^\d{2,12}-/.test(v.trim())) && v.trim() ? leitwegIdError(v) : null) },
  ];

  /** Kunde ändern und in alle offenen Entwürfe dieses Kunden übernehmen (abgeschlossene Rechnungen bleiben, wie sie sind). */
  function updateCustomer(customer, key, value) {
    customer[key] = value;
    for (const inv of state.store.invoices) {
      if (!isLocked(inv) && inv.customer?.id === customer.id) inv.customer = { ...inv.customer, ...customer };
    }
    app.onCustomersChanged();
  }

  function customerEditor(c) {
    const box = el('div', { className: 'customer-edit form-grid' });
    for (const f of CUSTOMER_FIELDS) {
      const input = f.select
        ? el('select', { className: 'input' })
        : el('input', { className: `input${f.mono ? ' mono' : ''}`, type: f.type ?? 'text', value: c[f.key] ?? '' });
      if (f.select) {
        fillSelect(input, countries.map((g) => ({ label: g.label, options: g.options.map((o) => ({ value: o.code, text: o.name })) })));
        input.value = c.country || 'DE';
      }
      const error = el('p', { className: 'field-error', hidden: true });
      const check = () => {
        const problem = f.check?.(input.value, c);
        error.textContent = problem ?? '';
        error.hidden = !problem;
        input.toggleAttribute('aria-invalid', Boolean(problem));
      };
      input.addEventListener('input', () => { updateCustomer(c, f.key, input.value); if (!error.hidden) check(); });
      input.addEventListener('change', check);
      input.addEventListener('blur', check);
      box.append(el('label', { className: `field ${f.half ? 'col-half' : 'col-full'}` }, el('span', { className: 'field-label', textContent: f.label }), input, error));
      if (c[f.key]) check();
    }
    const pub = el('input', { type: 'checkbox', checked: Boolean(c.isPublic) });
    pub.setAttribute('role', 'switch');
    pub.addEventListener('change', () => updateCustomer(c, 'isPublic', pub.checked));
    box.append(el('label', { className: 'switch col-full' }, pub, el('span', { className: 'switch-track', ariaHidden: 'true' }),
      el('span', {}, el('strong', { textContent: 'Öffentlicher Auftraggeber' }), el('small', { textContent: 'Leitweg-ID ist Pflicht.' }))));
    return box;
  }

  function renderCustomerList() {
    const list = $('#customer-list');
    if (!state.store.customers.length) {
      list.replaceChildren(el('li', { className: 'empty', textContent: 'Noch keine Kunden gespeichert. Speichere einen Kunden direkt in der Rechnung.' }));
      return;
    }
    list.replaceChildren(...state.store.customers.map((c) => {
      const editing = editingCustomer === c.id;
      const li = el('li', { className: editing ? 'is-editing' : '' },
        el('div', { className: 'customer-row' },
          el('span', {}, el('strong', { textContent: c.name || 'Ohne Namen' }), el('small', { textContent: [c.zip, c.city].filter(Boolean).join(' ') || c.email })),
          el('div', { className: 'row-actions' },
            el('button', {
              type: 'button', className: 'icon-btn', title: editing ? 'Fertig' : 'Bearbeiten', ariaLabel: editing ? `${c.name} fertig bearbeitet` : `${c.name} bearbeiten`, ariaExpanded: String(editing),
              onclick: () => { editingCustomer = editing ? null : c.id; renderCustomerList(); },
            }, icon(editing ? 'check' : 'edit')),
            el('button', {
              type: 'button', className: 'icon-btn danger', title: 'Kunde entfernen', ariaLabel: `${c.name} entfernen`,
              onclick: () => {
                const before = structuredClone(state.store.customers);
                state.store.customers = state.store.customers.filter((x) => x.id !== c.id);
                renderCustomerList();
                app.onCustomersChanged();
                toast(`„${c.name}“ entfernt`, { label: 'Rückgängig', run: () => { state.store.customers = before; renderCustomerList(); app.onCustomersChanged(); } });
              },
            }, icon('trash')))),
        editing && customerEditor(c));
      li.dataset.customer = c.id;
      return li;
    }));
  }

  /** Einstellungen öffnen und direkt einen Kunden bearbeiten. */
  function openCustomer(id) {
    editingCustomer = id;
    open();
    const row = $(`#customer-list li[data-customer="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'start' });
    row?.querySelector('.customer-edit input')?.focus();
  }

  // ---------- Daten: Sicherung, Beispieldaten, Löschen ----------
  function replaceStore(next, message) {
    const before = structuredClone(state.store);
    state.store = normalize(next);
    fill();
    app.resetEditor();
    toast(message, { label: 'Rückgängig', run: () => { state.store = before; fill(); app.resetEditor(); } });
  }
  $('#load-demo').addEventListener('click', async () => {
    const locked = state.store.invoices.filter(isLocked).length;
    if (locked && !(await confirmDialog({
      title: 'Beispieldaten laden?',
      text: `Deine ${locked} abgeschlossenen Rechnungen bleiben erhalten; Entwürfe, Kunden und Einstellungen werden durch das Beispiel ersetzt.`,
      confirm: 'Beispiel laden',
    }))) return;
    const next = demo();
    next.invoices.push(...state.store.invoices.filter(isLocked));
    replaceStore(next, 'Beispieldaten geladen');
  });
  $('#reset-all').addEventListener('click', async () => {
    const locked = state.store.invoices.filter(isLocked);
    if (!locked.length) {
      if (await confirmDialog({ title: 'Alle Daten löschen?', text: 'Entwürfe, Kunden und Einstellungen werden aus diesem Browser gelöscht.', confirm: 'Alles löschen', danger: true })) {
        replaceStore(seed(), 'Alle Daten gelöscht');
      }
      return;
    }
    // Ausgestellte Rechnungen unterliegen der Aufbewahrungspflicht (§ 147 AO, § 14b UStG): sie werden nie mitgelöscht.
    const ok = await confirmDialog({
      title: 'Entwürfe und Kunden löschen?',
      text: [
        `${locked.length} abgeschlossene ${locked.length === 1 ? 'Rechnung bleibt' : 'Rechnungen bleiben'} erhalten. Ausgestellte Rechnungen müssen 8 Jahre aufbewahrt werden.`,
        'Gelöscht werden alle Entwürfe und die Kundenliste. Firmendaten und Einstellungen bleiben, weil die abgeschlossenen Rechnungen darauf verweisen.',
      ],
      confirm: 'Entwürfe löschen',
      danger: true,
    });
    if (!ok) return;
    const next = { ...structuredClone(state.store), customers: [], invoices: structuredClone(locked) };
    const fresh = newInvoice(next);
    next.invoices.push(fresh);
    next.currentId = fresh.id;
    replaceStore(next, 'Entwürfe und Kunden gelöscht');
  });
  $('#backup-export').addEventListener('click', async () => {
    try {
      const { invoices, originals } = await exportBackup();
      settings().lastBackup = new Date().toISOString();
      save();
      renderBackupStatus();
      toast(`Sicherung mit ${invoices} Rechnungen und ${originals} Originalen heruntergeladen`);
    } catch {
      toast('Die Sicherung konnte nicht erstellt werden.');
    }
  });
  $('#backup-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { store, kept } = await importBackup(file);
      if (!(await confirmDialog({
        title: 'Sicherung einspielen?',
        text: [`Die Sicherung enthält ${store.invoices.length - kept} Rechnungen und ${store.customers.length} Kunden. Sie ersetzt Entwürfe und Einstellungen in diesem Browser.`,
          kept ? `${kept} abgeschlossene Rechnungen, die nicht in der Sicherung sind, bleiben erhalten.` : ''].filter(Boolean),
        confirm: 'Einspielen',
      }))) return;
      replaceStore(store, 'Sicherung eingespielt');
      persist();
    } catch (err) {
      toast(err.message);
    }
  });
  function renderBackupStatus() {
    const last = settings().lastBackup;
    $('#backup-status').textContent = last ? `Letzte Sicherung: ${new Date(last).toLocaleDateString('de-DE')}` : 'Noch keine Sicherung heruntergeladen.';
  }

  // ---------- Eingaben ----------
  form.addEventListener('input', (e) => {
    const t = e.target;
    const key = t.dataset.setting;
    if (!key) return;
    if (key === 'geoBias') {
      // Einschalten = Einwilligung (der Text steht direkt am Schalter); Ausschalten = Widerruf.
      // Der Schalter springt erst auf „an“, wenn der Browser den Standort wirklich freigibt.
      if (t.checked) {
        t.checked = false;
        t.disabled = true;
        app.requestGeo().finally(() => { t.disabled = false; syncGeoSwitch(); });
      } else app.revokeGeo();
      return;
    }
    setPath(settings(), key, t.type === 'checkbox' ? t.checked : key === 'numberFormat.digits' ? Number(t.value) : t.value);
    if (key === 'kleinunternehmer') app.renderItems();
    if (key === 'company.legalForm' || key === 'company.name') renderLegal();
    if (key.startsWith('numberFormat')) renderNumberPreview();
    app.renderBankSummary();
    app.update();
  });

  /** Schalter „Standort“ immer nach dem tatsächlichen Zustand richten. */
  function syncGeoSwitch() {
    const sw = $('[data-setting="geoBias"]');
    if (sw && !sw.disabled) sw.checked = Boolean(settings().geoBias);
  }

  function renderCompanyStatus() {
    const missing = app.companyMissing().length;
    const status = $('#company-status');
    status.textContent = missing ? (missing === 1 ? '1 Angabe fehlt oder ist ungültig' : `${missing} Angaben fehlen oder sind ungültig`) : 'Vollständig';
    status.classList.toggle('is-ok', !missing);
  }

  function fill() {
    for (const input of $$('[data-setting]', form)) {
      const value = getPath(settings(), input.dataset.setting);
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value ?? '';
    }
    renderLogo();
    closeWheel();
    renderDesign();
    renderCustomerList();
    renderCompanyStatus();
    renderLegal();
    renderNumberPreview();
    renderBackupStatus();
  }

  function open(focusField) {
    fill();
    if (focusField) app.touch(focusField); // Fehler am Zielfeld sofort zeigen (z. B. ungültige IBAN)
    app.renderFieldErrors();
    app.openDrawer($('#settings'));
    if (focusField) {
      const input = $(`[data-setting="${focusField}"]`, form);
      input?.closest('details')?.setAttribute('open', '');
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    }
  }

  return { open, openCustomer, fill, renderCompanyStatus, renderCustomerList, renderNumberPreview, syncGeoSwitch };
}

/** Verkleinert Logos auf max. 600 × 240 px, damit sie in den lokalen Speicher passen. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      if (file.type === 'image/svg+xml') {
        if (file.size > 300 * 1024) { reject(new Error('SVG zu groß')); return; }
        resolve(reader.result);
        return;
      }
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 600 / img.width, 240 / img.height);
        const canvas = el('canvas', { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
