// Import / export de toute la base au format Excel.
// Un onglet par table ; les liens (projet, poste, responsable, tâche) sont exprimés par leur nom.
import { resources, validate } from './schema.js';
import { LABELS } from './labels.js';
import { readXlsx, writeXlsx, excelSerialToIso, XlsxError } from './xlsx.js';
import { ZipError } from './zip.js';
import { AppError } from './store.js';

const MAX_ERRORS = 200;

/** Normalise un libellé : sans accents, casse, ponctuation ni contenu entre parenthèses. */
export const norm = (s) => String(s ?? '')
  .replace(/\(.*?\)/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const project = { key: 'project', header: 'Projet', lookup: 'projects', field: 'project_id', required: true, aliases: ['nomduprojet', 'projectid'], width: 28 };
const id = { key: 'id', header: 'ID', type: 'id', width: 7 };

export const SHEETS = [
  {
    resource: 'contributors', name: 'Contributeurs', aliases: ['contributeur', 'contributors', 'equipe', 'ressources', 'personnes'],
    naturalKey: (r) => norm(r.name),
    columns: [
      id,
      { key: 'name', header: 'Nom', aliases: ['nomcomplet', 'contributeur', 'name'], width: 24 },
      { key: 'role', header: 'Rôle', aliases: ['fonction', 'poste', 'role'], width: 24 },
      { key: 'email', header: 'E-mail', aliases: ['email', 'mail', 'courriel'], width: 30 },
      { key: 'daily_rate', header: 'Taux journalier (€)', aliases: ['tjm', 'taux', 'dailyrate'], type: 'money', width: 18 },
    ],
  },
  {
    resource: 'projects', name: 'Projets', aliases: ['projet', 'projects'],
    naturalKey: (r) => norm(r.name),
    columns: [
      id,
      { key: 'name', header: 'Nom', aliases: ['projet', 'nomduprojet', 'name'], width: 30 },
      { key: 'description', header: 'Description', type: 'wrap', width: 40 },
      { key: 'status', header: 'Statut', labels: 'projectStatus', aliases: ['etat', 'status'], width: 14 },
      { key: 'start_date', header: 'Date de début', aliases: ['debut', 'startdate'], width: 14 },
      { key: 'end_date', header: 'Date de fin', aliases: ['fin', 'datedefinprevue', 'enddate'], width: 14 },
      { key: 'budget', header: 'Budget global (€)', aliases: ['budget', 'enveloppe', 'budgettotal'], type: 'money', width: 16 },
    ],
  },
  {
    resource: 'budget_lines', name: 'Postes budgétaires', aliases: ['postes', 'poste', 'postesbudgetaires', 'budget', 'budgetlines', 'lignesbudgetaires'],
    naturalKey: (r) => `${r.project_id}|${norm(r.name)}`,
    columns: [
      id,
      project,
      { key: 'name', header: 'Poste', aliases: ['postebudgetaire', 'nom', 'ligne', 'name'], width: 30 },
      { key: 'category', header: 'Nature', labels: 'category', aliases: ['categorie', 'type', 'category'], width: 26 },
      { key: 'amount', header: 'Budget prévu (€)', aliases: ['budget', 'montant', 'prevu', 'budgetalloue', 'amount'], type: 'money', width: 16 },
      { key: 'notes', header: 'Commentaire', aliases: ['notes', 'remarque'], type: 'wrap', width: 40 },
    ],
  },
  {
    resource: 'tasks', name: 'Tâches', aliases: ['tache', 'tasks', 'task'],
    naturalKey: (r) => `${r.project_id}|${norm(r.title)}`,
    columns: [
      id,
      project,
      { key: 'title', header: 'Titre', aliases: ['tache', 'nom', 'intitule', 'title'], width: 34 },
      { key: 'description', header: 'Description', type: 'wrap', width: 40 },
      { key: 'status', header: 'Statut', labels: 'taskStatus', aliases: ['etat', 'status'], width: 12 },
      { key: 'priority', header: 'Priorité', labels: 'priority', aliases: ['priority'], width: 11 },
      { key: 'assignee', header: 'Responsable', lookup: 'contributors', field: 'assignee_id', aliases: ['assigne', 'assignee', 'contributeur'], width: 22 },
      { key: 'start_date', header: 'Début', aliases: ['datededebut', 'startdate'], width: 12 },
      { key: 'due_date', header: 'Échéance', aliases: ['datedecheance', 'datelimite', 'duedate', 'fin'], width: 12 },
      { key: 'estimated_hours', header: 'Charge (h)', aliases: ['heures', 'chargeestimee', 'estimatedhours'], width: 11 },
    ],
  },
  {
    resource: 'milestones', name: 'Jalons', aliases: ['jalon', 'milestones', 'milestone'],
    naturalKey: (r) => `${r.project_id}|${norm(r.name)}`,
    columns: [
      id,
      project,
      { key: 'name', header: 'Nom', aliases: ['jalon', 'name'], width: 30 },
      { key: 'due_date', header: 'Date', aliases: ['echeance', 'duedate'], width: 12 },
      { key: 'done', header: 'Atteint', aliases: ['fait', 'termine', 'done'], width: 9 },
      { key: 'description', header: 'Description', type: 'wrap', width: 40 },
    ],
  },
  {
    resource: 'expenses', name: 'Engagements', aliases: ['depense', 'depenses', 'engagement', 'engagementsdepenses', 'expenses', 'couts', 'commandes'],
    naturalKey: (r) => `${r.project_id}|${norm(r.label)}|${r.date}|${Number(r.amount_committed)}`,
    columns: [
      id,
      project,
      { key: 'budget_line', header: 'Poste', lookup: 'budget_lines', field: 'budget_line_id', aliases: ['postebudgetaire', 'ligne'], width: 26 },
      { key: 'label', header: 'Libellé', aliases: ['depense', 'intitule', 'description', 'objet', 'label'], width: 32 },
      { key: 'supplier', header: 'Fournisseur', aliases: ['prestataire', 'supplier', 'tiers'], width: 22 },
      { key: 'reference', header: 'Référence', aliases: ['ref', 'numerodecommande', 'bondecommande', 'facture', 'reference'], width: 16 },
      { key: 'date', header: 'Date', width: 12 },
      { key: 'amount_committed', header: 'Montant engagé (€)', aliases: ['engage', 'montant', 'cout', 'amount', 'montantcommande'], type: 'money', width: 18 },
      { key: 'amount_invoiced', header: 'Montant réalisé (€)', aliases: ['realise', 'facture', 'paye', 'montantfacture', 'montantpaye'], type: 'money', width: 18 },
      { key: 'contributor', header: 'Contributeur', lookup: 'contributors', field: 'contributor_id', aliases: ['responsable'], width: 22 },
      { key: 'task', header: 'Tâche', lookup: 'tasks', field: 'task_id', aliases: ['tacheliee', 'task'], width: 30 },
    ],
  },
];

const fieldOf = (spec, col) => resources[spec.resource].fields[col.field ?? col.key];
const columnType = (spec, col) => col.type ?? (fieldOf(spec, col)?.type === 'date' ? 'date' : undefined);

// --- Export -------------------------------------------------------------------

export function exportWorkbook(store, { template = false } = {}) {
  const names = {
    projects: new Map(store.list(resources.projects).map((r) => [r.id, r.name])),
    contributors: new Map(store.list(resources.contributors).map((r) => [r.id, r.name])),
    tasks: new Map(store.list(resources.tasks).map((r) => [r.id, r.title])),
    budget_lines: new Map(store.list(resources.budget_lines).map((r) => [r.id, r.name])),
  };

  const sheets = SHEETS.map((spec) => {
    const records = template ? [] : store.list(resources[spec.resource]);
    return {
      name: spec.name,
      columns: spec.columns.map((c) => ({ header: c.header, type: columnType(spec, c), width: c.width })),
      rows: records.map((r) => spec.columns.map((c) => {
        if (c.lookup) return names[c.lookup].get(r[c.field]) ?? null;
        const v = r[c.key];
        if (c.labels) return LABELS[c.labels][v] ?? v;
        if (c.key === 'done') return v ? 'Oui' : 'Non';
        return v;
      })),
    };
  });
  sheets.push(helpSheet());
  return writeXlsx(sheets);
}

function helpSheet() {
  const rows = [
    ['Mode d\'emploi', '', '', ''],
    ['• Une ligne = un élément. La première ligne de chaque onglet contient les en-têtes.', '', '', ''],
    ['• Les liens se font par le nom : colonne « Projet » = nom exact du projet, « Poste » = nom du poste budgétaire du projet, « Responsable » = nom du contributeur.', '', '', ''],
    ['• Engagements : le montant engagé est le montant commandé / signé ; le montant réalisé est la part déjà facturée ou payée (≤ engagé).', '', '', ''],
    ['• Si la colonne « Montant réalisé » est absente, chaque ligne est considérée comme entièrement réalisée (dépense payée).', '', '', ''],
    ['• Colonne ID : laissez-la vide pour créer un élément ; conservez-la pour mettre à jour un élément existant.', '', '', ''],
    ['• Import en mode « fusion » : une cellule vide ne modifie pas la valeur existante.', '', '', ''],
    ['• Dates au format JJ/MM/AAAA (ou cellules au format date Excel). Montants en euros.', '', '', ''],
    ['• Les onglets sont importés dans l\'ordre : Contributeurs, Projets, Postes budgétaires, Tâches, Jalons, Engagements.', '', '', ''],
    ['', '', '', ''],
    ['Onglet', 'Colonne', 'Obligatoire', 'Valeurs possibles / format'],
  ];
  for (const spec of SHEETS) {
    for (const c of spec.columns) {
      const f = fieldOf(spec, c);
      let format = '';
      if (c.key === 'id') format = 'Nombre entier (rempli automatiquement à l\'export)';
      else if (c.labels) format = Object.values(LABELS[c.labels]).join(', ');
      else if (c.lookup) format = `Nom d'un élément de l'onglet « ${SHEETS.find((s) => s.resource === c.lookup).name} »`;
      else if (c.key === 'done') format = 'Oui / Non';
      else if (f?.type === 'date') format = 'Date (JJ/MM/AAAA)';
      else if (f?.type === 'number') format = 'Nombre ≥ 0';
      else if (f?.format === 'email') format = 'Adresse e-mail';
      else format = 'Texte';
      rows.push([spec.name, c.header, c.required || f?.required ? 'Oui' : '', format]);
    }
  }
  return {
    name: "Mode d'emploi",
    autoFilter: false,
    columns: [{ header: 'Pilotage de projets', width: 16 }, { header: '', width: 22 }, { header: '', width: 12 }, { header: '', width: 70 }],
    rows,
  };
}

// --- Import -------------------------------------------------------------------

function toIsoDate(raw, date1904) {
  if (typeof raw === 'number') return excelSerialToIso(raw, date1904);
  if (typeof raw !== 'string') return raw;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}

const TRUE_WORDS = new Set(['oui', 'o', 'x', 'vrai', 'yes', 'y', 'true', '1', 'atteint', 'fait', 'termine']);
const FALSE_WORDS = new Set(['non', 'n', 'faux', 'no', 'false', '0']);

class CellError extends Error {
  constructor(column, message) {
    super(message);
    this.column = column;
  }
}

function matchColumns(spec, headerRow) {
  const mapping = [];
  const used = new Set();
  const unknown = [];
  headerRow.forEach((h, index) => {
    if (h === null || String(h).trim() === '') return;
    const n = norm(h);
    const col = spec.columns.find((c) => !used.has(c.key)
      && (norm(c.header) === n || norm(c.key) === n || (c.aliases ?? []).includes(n)));
    if (col) {
      used.add(col.key);
      mapping.push({ index, col });
    } else {
      unknown.push(String(h));
    }
  });
  return { mapping, unknown };
}

/**
 * Importe un classeur Excel.
 * - mode 'merge' : met à jour les éléments existants (par ID ou par nom) et ajoute les nouveaux ;
 * - mode 'replace' : vide toute la base puis charge le contenu du fichier.
 * Avec `dryRun`, rien n'est enregistré : le rapport indique ce qui serait fait.
 * En cas d'erreur, rien n'est enregistré.
 */
export function importWorkbook(store, buffer, { mode = 'merge', dryRun = false } = {}) {
  if (!['merge', 'replace'].includes(mode)) throw new AppError('Mode d\'import inconnu');
  let book;
  try {
    book = readXlsx(buffer);
  } catch (err) {
    if (err instanceof XlsxError || err instanceof ZipError) throw new AppError("Le fichier n'est pas un classeur Excel (.xlsx) valide ou il est endommagé");
    throw err;
  }

  const found = SHEETS.map((spec) => ({
    spec,
    sheet: book.sheets.find((s) => norm(s.name) === norm(spec.name) || spec.aliases.includes(norm(s.name))),
  }));
  if (!found.some((f) => f.sheet)) {
    throw new AppError(`Aucun onglet reconnu dans le fichier. Onglets attendus : ${SHEETS.map((s) => s.name).join(', ')}.`);
  }

  const storert = { mode, dryRun, saved: false, sheets: [], errors: [], warnings: [] };
  const addError = (e) => { if (storert.errors.length < MAX_ERRORS) storert.errors.push(e); };

  store.transaction(() => {
    if (mode === 'replace') store.wipe();
    for (const { spec, sheet } of found) {
      if (!sheet) {
        if (mode === 'replace') storert.warnings.push(`Onglet « ${spec.name} » absent du fichier : cette table sera vide.`);
        continue;
      }
      storert.sheets.push(importSheet(store, spec, sheet, book.date1904, mode, addError, storert.warnings));
    }
  }, { rollback: () => dryRun || storert.errors.length > 0 });

  storert.saved = !dryRun && storert.errors.length === 0;
  return storert;
}

function lookupTables(store) {
  const byName = (rows, key) => {
    const map = new Map();
    for (const r of rows) if (!map.has(norm(r[key]))) map.set(norm(r[key]), r.id);
    return map;
  };
  const tasks = store.list(resources.tasks);
  return {
    projects: byName(store.list(resources.projects), 'name'),
    contributors: byName(store.list(resources.contributors), 'name'),
    tasks: new Map(tasks.map((t) => [`${t.project_id}|${norm(t.title)}`, t.id]).reverse()),
    budget_lines: new Map(store.list(resources.budget_lines).map((l) => [`${l.project_id}|${norm(l.name)}`, l.id]).reverse()),
    projectIds: new Set(store.list(resources.projects).map((p) => p.id)),
  };
}

function importSheet(store, spec, sheet, date1904, mode, addError, warnings) {
  const def = resources[spec.resource];
  const result = { sheet: sheet.name, resource: spec.resource, label: spec.name, created: 0, updated: 0, rows: 0 };
  const headerIndex = sheet.rows.findIndex((r) => r.some((v) => v !== null && String(v).trim() !== ''));
  if (headerIndex < 0) return result;

  const { mapping, unknown } = matchColumns(spec, sheet.rows[headerIndex]);
  if (unknown.length) warnings.push(`Onglet « ${sheet.name} » : colonne(s) ignorée(s) : ${unknown.join(', ')}.`);
  const missing = spec.columns.filter((c) => (c.required || def.fields[c.key]?.required)
    && !mapping.some((m) => m.col.key === c.key));
  if (missing.length) {
    addError({ sheet: sheet.name, row: headerIndex + 1, message: `Colonne(s) obligatoire(s) manquante(s) : ${missing.map((c) => c.header).join(', ')}` });
    return result;
  }

  const lookups = lookupTables(store);
  const hasInvoicedColumn = mapping.some((m) => m.col.key === 'amount_invoiced');
  const seen = new Map(); // clé naturelle -> id (éléments existants ou déjà importés)
  if (spec.naturalKey && mode === 'merge') {
    for (const r of store.list(def)) {
      const k = spec.naturalKey(r);
      if (!seen.has(k)) seen.set(k, r.id);
    }
  }

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    if (!cells.some((v) => v !== null && String(v).trim() !== '')) continue;
    result.rows++;
    const rowNumber = i + 1;
    try {
      const { body, rowId } = convertRow(spec, mapping, cells, lookups, date1904);
      let targetId = rowId && store.findById(def, rowId) ? rowId : null;
      if (!targetId && spec.naturalKey) {
        // La clé est calculée sur les valeurs normalisées (dates, montants…) pour être comparable.
        const probe = validate(def, body, { partial: true }).data ?? body;
        targetId = seen.get(spec.naturalKey(probe)) ?? null;
      }
      let saved;
      if (targetId) {
        // Une cellule vide ne remplace pas une valeur existante.
        const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
        saved = store.update(def, targetId, changes);
        result.updated++;
      } else {
        // Sans colonne « Montant réalisé », une dépense importée est considérée comme payée.
        if (spec.resource === 'expenses' && !hasInvoicedColumn && body.amount_invoiced === undefined) {
          body.amount_invoiced = body.amount_committed;
        }
        saved = store.create(def, body, { id: rowId ?? undefined });
        result.created++;
      }
      if (spec.naturalKey) seen.set(spec.naturalKey(saved), saved.id);
      if (spec.resource === 'tasks') lookups.tasks.set(`${saved.project_id}|${norm(saved.title)}`, saved.id);
      if (spec.resource === 'budget_lines') lookups.budget_lines.set(`${saved.project_id}|${norm(saved.name)}`, saved.id);
    } catch (err) {
      if (err instanceof CellError) {
        addError({ sheet: sheet.name, row: rowNumber, column: err.column, message: err.message });
      } else if (err instanceof AppError) {
        const details = Object.entries(err.details ?? {});
        if (!details.length) addError({ sheet: sheet.name, row: rowNumber, message: err.message });
        for (const [field, message] of details) {
          const col = spec.columns.find((c) => (c.field ?? c.key) === field);
          addError({ sheet: sheet.name, row: rowNumber, column: col?.header ?? field, message });
        }
      } else {
        throw err;
      }
    }
  }
  return result;
}

function convertRow(spec, mapping, cells, lookups, date1904) {
  const body = {};
  let rowId = null;
  const def = resources[spec.resource];

  // Le projet est résolu en premier : il sert à retrouver la tâche liée d'une dépense.
  const ordered = [...mapping].sort((a, b) => (a.col.key === 'project' ? -1 : b.col.key === 'project' ? 1 : 0));
  for (const { index, col } of ordered) {
    let raw = cells[index] ?? null;
    if (typeof raw === 'string') raw = raw.trim();
    const empty = raw === null || raw === '';

    if (col.key === 'id') {
      if (empty) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new CellError(col.header, `ID invalide : « ${raw} »`);
      rowId = n;
      continue;
    }

    if (col.lookup) {
      if (empty) { body[col.field] = null; continue; }
      body[col.field] = resolveLookup(col, raw, body, lookups);
      continue;
    }

    const field = def.fields[col.key];
    if (empty) { body[col.key] = null; continue; }

    if (col.labels) {
      const n = norm(raw);
      const entry = Object.entries(LABELS[col.labels]).find(([code, label]) => norm(label) === n || norm(code) === n);
      if (!entry) {
        throw new CellError(col.header, `Valeur « ${raw} » non reconnue (valeurs possibles : ${Object.values(LABELS[col.labels]).join(', ')})`);
      }
      body[col.key] = entry[0];
    } else if (field.type === 'boolean') {
      if (typeof raw === 'boolean' || typeof raw === 'number') body[col.key] = Boolean(raw);
      else if (TRUE_WORDS.has(norm(raw))) body[col.key] = true;
      else if (FALSE_WORDS.has(norm(raw))) body[col.key] = false;
      else throw new CellError(col.header, `Valeur « ${raw} » non reconnue (Oui ou Non attendu)`);
    } else if (field.type === 'date') {
      body[col.key] = toIsoDate(raw, date1904);
    } else if (field.type === 'text') {
      body[col.key] = typeof raw === 'boolean' ? (raw ? 'Oui' : 'Non') : String(raw);
    } else {
      body[col.key] = raw;
    }
  }
  return { body, rowId };
}

function resolveLookup(col, raw, body, lookups) {
  const n = norm(raw);
  let found;
  if (col.lookup === 'tasks' || col.lookup === 'budget_lines') {
    found = lookups[col.lookup].get(`${body.project_id}|${n}`);
    if (!found) {
      const what = col.lookup === 'tasks' ? 'Tâche' : 'Poste';
      throw new CellError(col.header, `${what} « ${raw} » introuvable dans ce projet${col.lookup === 'budget_lines' ? " (vérifiez l'onglet Postes budgétaires)" : ''}`);
    }
    return found;
  }
  found = lookups[col.lookup].get(n);
  if (!found && col.lookup === 'projects' && Number.isInteger(raw) && lookups.projectIds.has(raw)) found = raw;
  if (!found) {
    const what = col.lookup === 'projects' ? 'Projet' : 'Contributeur';
    throw new CellError(col.header, `${what} « ${raw} » introuvable (vérifiez l'onglet ${col.lookup === 'projects' ? 'Projets' : 'Contributeurs'})`);
  }
  return found;
}
