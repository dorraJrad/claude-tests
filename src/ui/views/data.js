// Rubrique « Données » : import / export Excel et édition directe des tables.
import { api } from '../api.js';
import { esc, badge, empty, toast, openForm, confirmAction, LABELS, options } from '../ui.js';
import { downloadBytes, saveToFile } from '../state.js';

const TABLE_ORDER = ['projects', 'budget_lines', 'expenses', 'tasks', 'milestones', 'contributors'];
const MAX_ROWS = 500;

// Fichier sélectionné et mode d'import : conservés entre deux affichages de la page.
const importState = { file: null, mode: 'merge', report: null };

export async function dataView({ el, refresh }) {
  const tab = sessionStorage.getItem('data-tab') || 'projects';
  const [schema, stats, projects, contributors, tasks, budgetLines] = await Promise.all([
    api.get('schema'), api.get('admin/stats'), api.get('projects'), api.get('contributors'), api.get('tasks'), api.get('budget_lines'),
  ]);
  const loaded = { projects, contributors, tasks, budget_lines: budgetLines };
  const rows = loaded[tab] ?? await api.get(tab);
  const def = schema[tab];
  const refOptions = buildRefOptions(loaded);

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Données</h1><p class="muted">Importez un fichier Excel, exportez vos données et modifiez directement les tables de la base.</p></div>
    </header>

    <section class="stats stats-auto">
      ${TABLE_ORDER.map((k) => `<div class="stat stat-compact"><div class="stat-label">${esc(schema[k].label)}</div><div class="stat-value">${stats[k]}</div></div>`).join('')}
    </section>

    <div class="grid-2 grid-wide-left">
      <section class="card">
        <header class="card-header"><h2>Importer un fichier Excel</h2>
          <button class="btn btn-small" data-action="template">Télécharger le modèle</button></header>
        <ol class="steps muted small">
          <li>Téléchargez le modèle (ou un export) et remplissez un onglet par table : Contributeurs, Projets, Postes budgétaires, Tâches, Jalons, Engagements.</li>
          <li>Les liens se font par le nom (colonnes « Projet », « Poste », « Responsable »…). L'onglet « Mode d'emploi » détaille chaque colonne.</li>
          <li>Analysez le fichier : rien n'est enregistré tant que vous n'avez pas confirmé.</li>
        </ol>
        <label class="dropzone" data-dropzone>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-action="pick-file" hidden>
          <strong data-file-label>${importState.file ? esc(importState.file.name) : 'Choisir un fichier .xlsx'}</strong>
          <span class="muted small">ou glissez-déposez-le ici</span>
        </label>
        <fieldset class="modes">
          <label><input type="radio" name="import-mode" value="merge"${importState.mode === 'merge' ? ' checked' : ''}>
            <span><strong>Fusionner</strong> avec les données existantes <span class="muted small">— met à jour les éléments de même ID ou de même nom, ajoute les nouveaux</span></span></label>
          <label><input type="radio" name="import-mode" value="replace"${importState.mode === 'replace' ? ' checked' : ''}>
            <span><strong>Remplacer</strong> toute la base <span class="muted small">— efface tout puis charge le fichier (restauration d'une sauvegarde)</span></span></label>
        </fieldset>
        <div class="actions">
          <button class="btn btn-primary" data-action="analyze"${importState.file ? '' : ' disabled'}>Analyser le fichier</button>
        </div>
        <div data-report>${importState.report ? reportHtml(importState.report) : ''}</div>
      </section>

      <div class="stack">
        <section class="card">
          <header class="card-header"><h2>Exporter / sauvegarder</h2></header>
          <p class="muted small">Toute la base dans un classeur Excel (un onglet par table). C'est aussi votre fichier de sauvegarde :
            rouvrez-le avec « Ouvrir… » ou transmettez-le à un collègue.</p>
          <button class="btn btn-primary" data-action="export">Enregistrer sous… (.xlsx)</button>
        </section>
        <section class="card danger-zone">
          <header class="card-header"><h2>Zone sensible</h2></header>
          <div class="actions">
            <button class="btn" data-action="demo">Ajouter les données de démonstration</button>
            <button class="btn btn-danger" data-action="reset">Vider toute la base…</button>
          </div>
          <p class="muted small">Pensez à exporter vos données avant de vider la base.</p>
        </section>
      </div>
    </div>

    <section class="card">
      <header class="card-header"><h2>Éditer les tables</h2></header>
      <nav class="tabs">${TABLE_ORDER.map((k) =>
        `<a href="#" data-action="tab" data-tab="${k}" class="${k === tab ? 'is-active' : ''}">${esc(schema[k].label)} <span class="count">${stats[k]}</span></a>`).join('')}</nav>
      <div class="toolbar">
        <input type="search" placeholder="Rechercher…" data-action="search" aria-label="Rechercher dans la table">
        <span class="muted small">Modifiez une cellule : l'enregistrement est immédiat.</span>
        <span class="spacer"></span>
        <button class="btn btn-primary" data-action="add">+ Ajouter une ligne</button>
      </div>
      ${rows.length ? gridHtml(def, rows, refOptions) : empty('Cette table est vide.')}
    </section>`;

  // --- Événements ---------------------------------------------------------------

  el.onclick = async (e) => {
    const root = e.currentTarget;
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'tab') {
      e.preventDefault();
      sessionStorage.setItem('data-tab', target.dataset.tab);
      return refresh();
    }
    if (action === 'template') {
      downloadBytes(await api.exportWorkbook({ template: true }), 'modele-pilotage-projets.xlsx');
      return;
    }
    if (action === 'export') {
      const name = await saveToFile({ saveAs: true });
      if (name) toast(`Données enregistrées dans « ${name} »`, 'success');
      return;
    }
    if (action === 'analyze') return runImport(root, true, refresh);
    if (action === 'confirm-import') return runImport(root, false, refresh);
    if (action === 'add') return addRow(def, tab, refOptions, refresh);
    if (action === 'delete-row') {
      if (!confirmAction('Supprimer cette ligne ? Les éléments liés (tâches, dépenses…) peuvent être supprimés ou détachés.')) return;
      try {
        await api.remove(tab, target.dataset.id);
        toast('Ligne supprimée', 'success');
        refresh();
      } catch (err) {
        toast(err.message, 'danger');
      }
    }
    if (action === 'demo') {
      await api.create('admin/demo', {});
      toast('Données de démonstration ajoutées', 'success');
      refresh();
    }
    if (action === 'reset') {
      const answer = window.prompt('Cette action efface définitivement tous les projets, tâches, jalons, dépenses et contributeurs.\nTapez SUPPRIMER pour confirmer :');
      if (answer === null) return;
      try {
        await api.create('admin/reset', { confirm: answer.trim().toUpperCase() });
        toast('La base a été vidée', 'success');
        refresh();
      } catch (err) {
        toast(err.message, 'danger');
      }
    }
  };

  el.onchange = async (e) => {
    const root = e.currentTarget;
    const t = e.target;
    if (t.name === 'import-mode') {
      importState.mode = t.value;
      return clearReport(root);
    }
    if (t.dataset.action === 'pick-file') return pickFile(root, t.files[0]);
    if (t.dataset.field) return saveCell(t, def, tab);
  };

  el.oninput = (e) => {
    if (e.target.dataset.action !== 'search') return;
    const q = normalize(e.target.value);
    e.currentTarget.querySelectorAll('tbody tr[data-search]').forEach((tr) => {
      tr.hidden = q && !tr.dataset.search.includes(q);
    });
  };

  el.ondragover = (e) => {
    const zone = e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('is-over');
  };
  el.ondragleave = (e) => e.target.closest('[data-dropzone]')?.classList.remove('is-over');
  el.ondrop = (e) => {
    const zone = e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('is-over');
    pickFile(e.currentTarget, e.dataTransfer.files[0]);
  };
}

// --- Import -------------------------------------------------------------------

function pickFile(root, file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) {
    toast('Choisissez un fichier Excel .xlsx (si besoin : « Enregistrer sous » > Classeur Excel)', 'danger');
    return;
  }
  importState.file = file;
  root.querySelector('[data-file-label]').textContent = file.name;
  root.querySelector('[data-action="analyze"]').disabled = false;
  clearReport(root);
}

function clearReport(root) {
  importState.report = null;
  root.querySelector('[data-report]').innerHTML = '';
}

async function runImport(root, dryRun, refresh) {
  const { file, mode } = importState;
  if (!file) return;
  if (!dryRun && mode === 'replace'
    && !confirmAction('Le mode « Remplacer » va effacer toutes les données actuelles avant l\'import. Continuer ?')) return;
  const buttons = root.querySelectorAll('[data-action="analyze"], [data-action="confirm-import"]');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const report = await api.importWorkbook(new Uint8Array(await file.arrayBuffer()), { mode, dryRun });
    if (!dryRun && report.saved) {
      importState.file = null;
      importState.report = null;
      toast('Import terminé', 'success');
      return refresh();
    }
    importState.report = report;
    root.querySelector('[data-report]').innerHTML = reportHtml(report);
  } catch (err) {
    root.querySelector('[data-report]').innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function reportHtml(r) {
  const ok = r.errors.length === 0;
  const total = r.sheets.reduce((a, s) => a + s.created + s.updated, 0);
  return `<div class="report">
    <h3>${ok ? '✅ Fichier valide' : `⚠️ ${r.errors.length}${r.errors.length >= 200 ? '+' : ''} erreur(s) à corriger`}</h3>
    <table class="table">
      <thead><tr><th>Onglet</th><th class="num">Lignes</th><th class="num">À créer</th><th class="num">À mettre à jour</th></tr></thead>
      <tbody>${r.sheets.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.rows}</td>
        <td class="num">${s.created}</td><td class="num">${s.updated}</td></tr>`).join('')}</tbody>
    </table>
    ${r.warnings.length ? `<ul class="warnings small">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${ok ? `<div class="actions">
        <button class="btn btn-primary" data-action="confirm-import"${total ? '' : ' disabled'}>
          ${r.mode === 'replace' ? 'Remplacer la base par ce fichier' : 'Confirmer l\'import'}</button>
        ${r.mode === 'replace' ? badge('Toutes les données actuelles seront effacées', 'danger') : ''}
      </div>`
    : `<p class="small muted">Corrigez ces lignes dans Excel puis sélectionnez à nouveau le fichier. Rien n'a été enregistré.</p>
      <div class="table-wrap errors"><table class="table">
        <thead><tr><th>Onglet</th><th class="num">Ligne</th><th>Colonne</th><th>Problème</th></tr></thead>
        <tbody>${r.errors.map((e) => `<tr><td>${esc(e.sheet)}</td><td class="num">${e.row}</td>
          <td>${esc(e.column ?? '—')}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody>
      </table></div>`}
  </div>`;
}

// --- Éditeur de tables -------------------------------------------------------

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function buildRefOptions({ projects, contributors, tasks, budget_lines: lines }) {
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  return {
    projects: projects.map((p) => [p.id, p.name]),
    contributors: contributors.map((c) => [c.id, c.name]),
    tasks: tasks.map((t) => [t.id, `${projectName.get(t.project_id) ?? '?'} › ${t.title}`]),
    budget_lines: lines.map((l) => [l.id, `${projectName.get(l.project_id) ?? '?'} › ${l.name}`]),
  };
}

function displayValue(f, value, refOptions) {
  if (value === null || value === undefined) return '';
  if (f.ref) return refOptions[f.ref].find(([id]) => id === value)?.[1] ?? '';
  if (f.labels) return LABELS[f.labels][value] ?? value;
  if (f.type === 'boolean') return value ? 'oui' : 'non';
  return String(value);
}

function cellHtml(f, row, refOptions) {
  const v = row[f.name];
  const attrs = `data-field="${f.name}" data-id="${row.id}" aria-label="${esc(f.label)}"`;
  switch (f.type) {
    case 'boolean':
      return `<input type="checkbox" class="check" ${attrs}${v ? ' checked' : ''}>`;
    case 'enum':
      return `<select ${attrs}>${f.values.map((code) =>
        `<option value="${code}"${code === v ? ' selected' : ''}>${esc(LABELS[f.labels][code])}</option>`).join('')}</select>`;
    case 'ref':
      return `<select ${attrs}>${f.required ? '' : '<option value="">—</option>'}${refOptions[f.ref].map(([id, label]) =>
        `<option value="${id}"${id === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    case 'number':
      return `<input type="number" step="any" min="${f.min ?? ''}" value="${v ?? ''}" ${attrs}>`;
    case 'date':
      return `<input type="date" value="${esc(v ?? '')}" ${attrs}>`;
    default:
      return `<input type="${f.format === 'email' ? 'email' : 'text'}" value="${esc(v ?? '')}" ${attrs}>`;
  }
}

function gridHtml(def, rows, refOptions) {
  const shown = rows.slice(0, MAX_ROWS);
  return `<div class="table-wrap grid-wrap"><table class="table data-grid">
    <thead><tr><th class="num">ID</th>${def.fields.map((f) => `<th class="col-${f.type}${f.multiline ? ' col-wide' : ''}">${esc(f.label)}${f.required ? ' *' : ''}</th>`).join('')}<th></th></tr></thead>
    <tbody>${shown.map((row) => `<tr data-search="${esc(normalize(def.fields.map((f) => displayValue(f, row[f.name], refOptions)).join(' ')))}">
      <td class="num muted">${row.id}</td>
      ${def.fields.map((f) => `<td class="col-${f.type}${f.multiline ? ' col-wide' : ''}">${cellHtml(f, row, refOptions)}</td>`).join('')}
      <td><button class="icon-btn danger" data-action="delete-row" data-id="${row.id}" title="Supprimer la ligne" aria-label="Supprimer la ligne ${row.id}">🗑</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${rows.length > MAX_ROWS ? `<p class="muted small">${MAX_ROWS} premières lignes affichées sur ${rows.length}. Utilisez l'export Excel pour tout voir.</p>` : ''}`;
}

async function saveCell(input, def, tab) {
  const field = def.fields.find((f) => f.name === input.dataset.field);
  const value = field.type === 'boolean' ? input.checked : (input.value === '' ? null : input.value);
  const cell = input.closest('td');
  cell.classList.remove('is-saved', 'is-invalid');
  try {
    await api.update(tab, input.dataset.id, { [field.name]: value });
    input.defaultValue = input.value;
    if (input.tagName === 'SELECT') [...input.options].forEach((o) => { o.defaultSelected = o.selected; });
    if (field.type === 'boolean') input.defaultChecked = input.checked;
    void cell.offsetWidth; // relance l'animation
    cell.classList.add('is-saved');
  } catch (err) {
    cell.classList.add('is-invalid');
    const labelOf = (key) => def.fields.find((f) => f.name === key)?.label ?? key;
    const detail = Object.entries(err.details ?? {}).map(([key, msg]) => `${labelOf(key)} : ${msg}`).join(' ; ');
    toast(detail || `${field.label} : ${err.message}`, 'danger');
    // Revient à la dernière valeur enregistrée.
    if (field.type === 'boolean') input.checked = input.defaultChecked;
    else if (input.tagName === 'SELECT') [...input.options].forEach((o) => { o.selected = o.defaultSelected; });
    else input.value = input.defaultValue;
  }
}

function addRow(def, tab, refOptions, refresh) {
  const fields = def.fields.map((f) => {
    const base = { name: f.name, label: f.label, required: f.required };
    switch (f.type) {
      case 'enum': return { ...base, type: 'select', options: options(LABELS[f.labels]) };
      case 'ref': return { ...base, type: 'select', options: refOptions[f.ref], full: true };
      case 'boolean': return { ...base, type: 'checkbox' };
      case 'number': return { ...base, type: 'number', min: f.min, step: 'any' };
      case 'date': return { ...base, type: 'date' };
      default: return { ...base, type: f.multiline ? 'textarea' : f.format === 'email' ? 'email' : 'text', full: f.multiline };
    }
  });
  const defaults = Object.fromEntries(def.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
  openForm({
    title: `Nouvelle ligne — ${def.label}`,
    fields,
    values: defaults,
    submitLabel: 'Ajouter',
    onSubmit: async (data) => {
      await api.create(tab, data);
      toast('Ligne ajoutée', 'success');
      refresh();
    },
  });
}
