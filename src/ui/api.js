// Façade d'accès aux données : même interface que l'ancienne API HTTP, mais tout s'exécute
// dans le navigateur sur le magasin local (aucun serveur).
import { resources, describeSchema } from '../core/schema.js';
import { AppError } from '../core/store.js';
import { dashboard, deadlines, workload, projectSummaries, projectBudget, portfolioBudget } from '../core/metrics.js';
import { exportWorkbook, importWorkbook } from '../core/datasheets.js';
import { insertDemoData } from '../core/demo.js';
import { store } from './state.js';
import { today } from './ui.js';

export { AppError as ApiError };

const resourceOf = (name) => {
  if (!Object.hasOwn(resources, name)) throw new AppError(`Ressource inconnue : ${name}`, undefined, 404);
  return resources[name];
};

const toId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Élément introuvable', undefined, 404);
  return id;
};

const clean = (params = {}) => Object.fromEntries(
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
);

function get(path, params = {}) {
  const q = clean(params);
  const [name, rawId, sub] = path.split('/');
  switch (name) {
    case 'dashboard': return dashboard(store, today());
    case 'workload': return workload(store, today());
    case 'portfolio': return portfolioBudget(store, { includeCompleted: q.completed !== '0' });
    case 'schema': return describeSchema();
    case 'deadlines':
      return deadlines(store, today(), { projectId: q.project_id ? toId(q.project_id) : null, until: q.until ?? null });
    case 'admin':
      if (rawId === 'stats') return store.counts();
      break;
    default:
  }
  if (name === 'projects' && sub === 'summary') {
    const [summary] = projectSummaries(store, today(), toId(rawId));
    if (!summary) throw new AppError('Projet introuvable', undefined, 404);
    return summary;
  }
  if (name === 'projects' && sub === 'budget') {
    const budget = projectBudget(store, toId(rawId));
    if (!budget) throw new AppError('Projet introuvable', undefined, 404);
    return budget;
  }
  const def = resourceOf(name);
  if (!rawId) return store.list(def, q);
  const row = store.findById(def, toId(rawId));
  if (!row) throw new AppError('Élément introuvable', undefined, 404);
  return row;
}

function create(resource, body = {}) {
  if (resource === 'admin/demo') return insertDemoData(store, today());
  if (resource === 'admin/reset') {
    if (body.confirm !== 'SUPPRIMER') throw new AppError('Confirmation manquante : saisissez SUPPRIMER');
    return store.wipe();
  }
  return store.create(resourceOf(resource), body);
}

// Les fonctions sont asynchrones pour garder l'interface des vues (await api.get(...)).
export const api = {
  get: async (path, params) => get(path, params),
  create: async (resource, body) => create(resource, body),
  update: async (resource, id, body) => store.update(resourceOf(resource), toId(id), body),
  remove: async (resource, id) => store.remove(resourceOf(resource), toId(id)),
  /** Analyse (dryRun) ou importe un classeur Excel. */
  importWorkbook: async (bytes, options) => importWorkbook(store, bytes, options),
  /** Classeur Excel de toute la base (ou modèle vierge). */
  exportWorkbook: async ({ template = false } = {}) => exportWorkbook(store, { template }),
};
