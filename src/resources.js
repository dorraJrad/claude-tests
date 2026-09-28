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
    fields: {
      name: { type: 'text', required: true, max: 200 },
      description: { type: 'text', max: 5000 },
      status: { type: 'enum', values: ENUMS.projectStatus, default: 'planned' },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      budget: { type: 'number', min: 0, default: 0 },
    },
    check: dateOrder('start_date', 'end_date', 'La date de fin doit suivre la date de début'),
    filters: ['status'],
    orderBy: 'created_at DESC, id DESC',
  },
  contributors: {
    table: 'contributors',
    fields: {
      name: { type: 'text', required: true, max: 200 },
      email: { type: 'text', format: 'email', max: 320 },
      role: { type: 'text', max: 200 },
      daily_rate: { type: 'number', min: 0, default: 0 },
    },
    filters: [],
    orderBy: 'name COLLATE NOCASE, id',
  },
  tasks: {
    table: 'tasks',
    fields: {
      project_id: { type: 'ref', required: true },
      title: { type: 'text', required: true, max: 300 },
      description: { type: 'text', max: 5000 },
      status: { type: 'enum', values: ENUMS.taskStatus, default: 'todo' },
      priority: { type: 'enum', values: ENUMS.priority, default: 'medium' },
      assignee_id: { type: 'ref' },
      start_date: { type: 'date' },
      due_date: { type: 'date' },
      estimated_hours: { type: 'number', min: 0, default: 0 },
    },
    check: dateOrder('start_date', 'due_date', "L'échéance doit suivre la date de début"),
    filters: ['project_id', 'assignee_id', 'status'],
    orderBy: 'due_date IS NULL, due_date, id',
  },
  milestones: {
    table: 'milestones',
    fields: {
      project_id: { type: 'ref', required: true },
      name: { type: 'text', required: true, max: 300 },
      description: { type: 'text', max: 5000 },
      due_date: { type: 'date', required: true },
      done: { type: 'boolean', default: 0 },
    },
    filters: ['project_id', 'done'],
    orderBy: 'due_date, id',
  },
  expenses: {
    table: 'expenses',
    fields: {
      project_id: { type: 'ref', required: true },
      label: { type: 'text', required: true, max: 300 },
      category: { type: 'enum', values: ENUMS.expenseCategory, default: 'autre' },
      amount: { type: 'number', min: 0, required: true },
      date: { type: 'date', required: true },
      task_id: { type: 'ref' },
      contributor_id: { type: 'ref' },
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
