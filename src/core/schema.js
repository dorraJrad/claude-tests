// Schéma des données : tables, champs, règles de validation et liens entre tables.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ENUMS = {
  projectStatus: ['planned', 'active', 'on_hold', 'completed'],
  taskStatus: ['todo', 'in_progress', 'done'],
  priority: ['low', 'medium', 'high'],
  category: ['personnel', 'prestation', 'logiciel', 'materiel', 'infrastructure', 'deplacement', 'formation', 'provision', 'autre'],
};

const dateOrder = (startKey, endKey, message) => (record) =>
  record[startKey] && record[endKey] && record[endKey] < record[startKey]
    ? { [endKey]: message }
    : null;

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const byId = (a, b) => a.id - b.id;
/** Tri par date croissante, les éléments sans date en dernier. */
const byDate = (key) => (a, b) => (a[key] === b[key] ? 0 : !a[key] ? 1 : !b[key] ? -1 : a[key] < b[key] ? -1 : 1);
const chain = (...cmps) => (a, b) => {
  for (const cmp of cmps) {
    const r = cmp(a, b);
    if (r) return r;
  }
  return 0;
};

/*
 * Pour chaque champ `ref`, `onDelete` indique ce qu'il advient de l'élément quand
 * l'élément référencé est supprimé : 'cascade' (supprimé aussi) ou 'set null' (lien retiré).
 */
export const resources = {
  projects: {
    table: 'projects',
    label: 'Projets',
    fields: {
      name: { type: 'text', required: true, max: 200, label: 'Nom' },
      description: { type: 'text', max: 5000, label: 'Description', multiline: true },
      status: { type: 'enum', values: ENUMS.projectStatus, default: 'planned', label: 'Statut', labels: 'projectStatus' },
      start_date: { type: 'date', label: 'Début' },
      end_date: { type: 'date', label: 'Fin' },
      budget: { type: 'number', min: 0, default: 0, label: 'Budget global (€)' },
    },
    check: dateOrder('start_date', 'end_date', 'La date de fin doit suivre la date de début'),
    filters: ['status'],
    sort: (a, b) => b.id - a.id,
  },
  contributors: {
    table: 'contributors',
    label: 'Contributeurs',
    fields: {
      name: { type: 'text', required: true, max: 200, label: 'Nom' },
      email: { type: 'text', format: 'email', max: 320, label: 'E-mail' },
      role: { type: 'text', max: 200, label: 'Rôle' },
      daily_rate: { type: 'number', min: 0, default: 0, label: 'Taux journalier (€)' },
    },
    filters: [],
    sort: chain((a, b) => collator.compare(a.name, b.name), byId),
  },
  budget_lines: {
    table: 'budget_lines',
    label: 'Postes budgétaires',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects', onDelete: 'cascade' },
      name: { type: 'text', required: true, max: 200, label: 'Poste' },
      category: { type: 'enum', values: ENUMS.category, default: 'autre', label: 'Nature', labels: 'category' },
      amount: { type: 'number', min: 0, default: 0, label: 'Budget prévu (€)' },
      notes: { type: 'text', max: 2000, label: 'Commentaire', multiline: true },
    },
    filters: ['project_id', 'category'],
    sort: byId,
  },
  tasks: {
    table: 'tasks',
    label: 'Tâches',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects', onDelete: 'cascade' },
      title: { type: 'text', required: true, max: 300, label: 'Titre' },
      description: { type: 'text', max: 5000, label: 'Description', multiline: true },
      status: { type: 'enum', values: ENUMS.taskStatus, default: 'todo', label: 'Statut', labels: 'taskStatus' },
      priority: { type: 'enum', values: ENUMS.priority, default: 'medium', label: 'Priorité', labels: 'priority' },
      assignee_id: { type: 'ref', label: 'Responsable', ref: 'contributors', onDelete: 'set null' },
      start_date: { type: 'date', label: 'Début' },
      due_date: { type: 'date', label: 'Échéance' },
      estimated_hours: { type: 'number', min: 0, default: 0, label: 'Charge (h)' },
    },
    check: dateOrder('start_date', 'due_date', "L'échéance doit suivre la date de début"),
    filters: ['project_id', 'assignee_id', 'status'],
    sort: chain(byDate('due_date'), byId),
  },
  milestones: {
    table: 'milestones',
    label: 'Jalons',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects', onDelete: 'cascade' },
      name: { type: 'text', required: true, max: 300, label: 'Nom' },
      description: { type: 'text', max: 5000, label: 'Description', multiline: true },
      due_date: { type: 'date', required: true, label: 'Date' },
      done: { type: 'boolean', default: 0, label: 'Atteint' },
    },
    filters: ['project_id', 'done'],
    sort: chain(byDate('due_date'), byId),
  },
  expenses: {
    table: 'expenses',
    label: 'Engagements & dépenses',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects', onDelete: 'cascade' },
      budget_line_id: { type: 'ref', label: 'Poste', ref: 'budget_lines', onDelete: 'set null' },
      label: { type: 'text', required: true, max: 300, label: 'Libellé' },
      supplier: { type: 'text', max: 200, label: 'Fournisseur' },
      reference: { type: 'text', max: 100, label: 'Référence (commande / facture)' },
      date: { type: 'date', required: true, label: 'Date' },
      amount_committed: { type: 'number', min: 0, required: true, label: 'Montant engagé (€)' },
      amount_invoiced: { type: 'number', min: 0, default: 0, label: 'Montant réalisé (€)' },
      task_id: { type: 'ref', label: 'Tâche', ref: 'tasks', onDelete: 'set null' },
      contributor_id: { type: 'ref', label: 'Contributeur', ref: 'contributors', onDelete: 'set null' },
    },
    check: (r) => (r.amount_invoiced > r.amount_committed
      ? { amount_invoiced: "Le réalisé ne peut pas dépasser l'engagé : augmentez d'abord le montant engagé" }
      : null),
    filters: ['project_id', 'budget_line_id', 'task_id', 'contributor_id'],
    sort: chain((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1), (a, b) => b.id - a.id),
  },
};

/** Ordre de chargement : une table n'y référence que des tables placées avant elle. */
export const TABLE_ORDER = ['contributors', 'projects', 'budget_lines', 'tasks', 'milestones', 'expenses'];

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Convertit une valeur brute selon la définition du champ. */
export function coerce(field, value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { value: null };
  }
  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return { error: 'Texte attendu' };
      const s = value.trim();
      if (field.max && s.length > field.max) return { error: `${field.max} caractères maximum` };
      if (field.format === 'email' && !EMAIL.test(s)) return { error: 'Adresse e-mail invalide' };
      return { value: s };
    }
    case 'number': {
      const n = typeof value === 'number' ? value
        : typeof value === 'string' ? Number(value.replace(',', '.').replace(/\s/g, ''))
        : NaN;
      if (!Number.isFinite(n)) return { error: 'Nombre attendu' };
      if (field.min !== undefined && n < field.min) return { error: `Doit être supérieur ou égal à ${field.min}` };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'ref': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (!Number.isInteger(n) || n <= 0) return { error: 'Identifiant invalide' };
      return { value: n };
    }
    case 'date':
      return isIsoDate(value) ? { value } : { error: 'Date invalide (AAAA-MM-JJ)' };
    case 'enum':
      return field.values.includes(value) ? { value } : { error: 'Valeur non autorisée' };
    case 'boolean':
      if (value === true || value === 1 || value === '1' || value === 'true') return { value: 1 };
      if (value === false || value === 0 || value === '0' || value === 'false') return { value: 0 };
      return { error: 'Booléen attendu' };
    default:
      throw new Error(`Type de champ inconnu : ${field.type}`);
  }
}

/**
 * Valide un corps de requête. En mode partiel (mise à jour), seuls les champs
 * présents sont traités ; sinon les champs absents prennent leur valeur par défaut.
 */
export function validate(def, input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: { _: 'Données attendues' } };
  }
  const data = {};
  const errors = {};
  for (const [key, field] of Object.entries(def.fields)) {
    if (!Object.hasOwn(input, key)) {
      if (partial) continue;
      if (field.required) errors[key] = 'Champ obligatoire';
      else data[key] = field.default ?? null;
      continue;
    }
    const result = coerce(field, input[key]);
    if (result.error) errors[key] = result.error;
    else if (result.value === null && field.required) errors[key] = 'Champ obligatoire';
    else data[key] = result.value ?? field.default ?? null;
  }
  return Object.keys(errors).length ? { errors } : { data };
}

/** Description des tables pour l'éditeur de données de l'interface. */
export function describeSchema() {
  return Object.fromEntries(Object.entries(resources).map(([name, def]) => [name, {
    label: def.label,
    fields: Object.entries(def.fields).map(([key, f]) => ({
      name: key,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
      ...(f.default !== undefined && { default: f.default }),
      ...(f.values && { values: f.values, labels: f.labels }),
      ...(f.ref && { ref: f.ref }),
      ...(f.min !== undefined && { min: f.min }),
      ...(f.format && { format: f.format }),
      ...(f.multiline && { multiline: true }),
    })),
  }]));
}
