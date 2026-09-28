// Définition des ressources exposées par l'API et validation des entrées.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ENUMS = {
  projectStatus: ['planned', 'active', 'on_hold', 'completed'],
  taskStatus: ['todo', 'in_progress', 'done'],
  priority: ['low', 'medium', 'high'],
  expenseCategory: ['personnel', 'materiel', 'logiciel', 'prestation', 'deplacement', 'autre'],
};

const dateOrder = (startKey, endKey, message) => (record) =>
  record[startKey] && record[endKey] && record[endKey] < record[startKey]
    ? { [endKey]: message }
    : null;

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
      budget: { type: 'number', min: 0, default: 0, label: 'Budget (€)' },
    },
    check: dateOrder('start_date', 'end_date', 'La date de fin doit suivre la date de début'),
    filters: ['status'],
    orderBy: 'created_at DESC, id DESC',
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
    orderBy: 'name COLLATE NOCASE, id',
  },
  tasks: {
    table: 'tasks',
    label: 'Tâches',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects' },
      title: { type: 'text', required: true, max: 300, label: 'Titre' },
      description: { type: 'text', max: 5000, label: 'Description', multiline: true },
      status: { type: 'enum', values: ENUMS.taskStatus, default: 'todo', label: 'Statut', labels: 'taskStatus' },
      priority: { type: 'enum', values: ENUMS.priority, default: 'medium', label: 'Priorité', labels: 'priority' },
      assignee_id: { type: 'ref', label: 'Responsable', ref: 'contributors' },
      start_date: { type: 'date', label: 'Début' },
      due_date: { type: 'date', label: 'Échéance' },
      estimated_hours: { type: 'number', min: 0, default: 0, label: 'Charge (h)' },
    },
    check: dateOrder('start_date', 'due_date', "L'échéance doit suivre la date de début"),
    filters: ['project_id', 'assignee_id', 'status'],
    orderBy: 'due_date IS NULL, due_date, id',
  },
  milestones: {
    table: 'milestones',
    label: 'Jalons',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects' },
      name: { type: 'text', required: true, max: 300, label: 'Nom' },
      description: { type: 'text', max: 5000, label: 'Description', multiline: true },
      due_date: { type: 'date', required: true, label: 'Date' },
      done: { type: 'boolean', default: 0, label: 'Atteint' },
    },
    filters: ['project_id', 'done'],
    orderBy: 'due_date, id',
  },
  expenses: {
    table: 'expenses',
    label: 'Dépenses',
    fields: {
      project_id: { type: 'ref', required: true, label: 'Projet', ref: 'projects' },
      label: { type: 'text', required: true, max: 300, label: 'Libellé' },
      category: { type: 'enum', values: ENUMS.expenseCategory, default: 'autre', label: 'Catégorie', labels: 'category' },
      amount: { type: 'number', min: 0, required: true, label: 'Montant (€)' },
      date: { type: 'date', required: true, label: 'Date' },
      task_id: { type: 'ref', label: 'Tâche', ref: 'tasks' },
      contributor_id: { type: 'ref', label: 'Contributeur', ref: 'contributors' },
    },
    filters: ['project_id', 'task_id', 'contributor_id'],
    orderBy: 'date DESC, id DESC',
  },
};

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
    return { errors: { _: 'Un objet JSON est attendu' } };
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
