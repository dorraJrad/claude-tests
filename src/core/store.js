// Base de données en mémoire (sérialisable en JSON) : CRUD validé, liens entre tables, transactions.
import { resources, validate, coerce, TABLE_ORDER } from './schema.js';

export const DATA_VERSION = 2;

export class AppError extends Error {
  constructor(message, details, status = 400) {
    super(message);
    this.details = details;
    this.status = status;
  }
}

const emptyState = () => ({
  version: DATA_VERSION,
  seq: Object.fromEntries(TABLE_ORDER.map((t) => [t, 0])),
  tables: Object.fromEntries(TABLE_ORDER.map((t) => [t, []])),
});

/** Vérifie et complète un état chargé (sauvegarde du navigateur ou fichier). */
function normalizeState(input) {
  const state = emptyState();
  if (!input || typeof input !== 'object' || !input.tables) return state;
  for (const t of TABLE_ORDER) {
    const rows = Array.isArray(input.tables[t]) ? input.tables[t] : [];
    state.tables[t] = rows.filter((r) => r && Number.isInteger(r.id) && r.id > 0).map((r) => ({ ...r }));
    const maxId = state.tables[t].reduce((m, r) => Math.max(m, r.id), 0);
    state.seq[t] = Math.max(maxId, Number(input.seq?.[t]) || 0);
  }
  return state;
}

export function createStore(initial) {
  let state = normalizeState(initial);
  const listeners = new Set();
  let batchDepth = 0;
  let pending = false;

  function emit() {
    if (batchDepth) {
      pending = true;
      return;
    }
    for (const fn of listeners) fn();
  }

  const rowsOf = (def) => state.tables[def.table];
  const findRow = (def, id) => rowsOf(def).find((r) => r.id === id);

  function findById(def, id) {
    const row = findRow(def, Number(id));
    return row ? { ...row } : undefined;
  }

  /** `filters` : { champ: valeur brute } limité aux filtres autorisés par la table. */
  function list(def, filters = {}) {
    const tests = [];
    for (const key of def.filters) {
      if (!Object.hasOwn(filters, key) || filters[key] === undefined) continue;
      const { value, error } = coerce(def.fields[key], filters[key]);
      if (error) throw new AppError(`Filtre invalide : ${key}`);
      tests.push((r) => (r[key] ?? null) === value);
    }
    return rowsOf(def).filter((r) => tests.every((t) => t(r))).sort(def.sort).map((r) => ({ ...r }));
  }

  function checkRecord(def, record) {
    const errors = def.check?.(record);
    if (errors) throw new AppError('Données invalides', errors);
    for (const [key, field] of Object.entries(def.fields)) {
      if (field.type !== 'ref' || record[key] === null || record[key] === undefined) continue;
      const target = findRow(resources[field.ref], record[key]);
      if (!target) {
        throw new AppError('Référence invalide : un élément lié est introuvable', { [key]: `${field.label} introuvable` });
      }
      // Un poste, une tâche… lié à un élément doit appartenir au même projet que lui.
      if (key !== 'project_id' && record.project_id && target.project_id && target.project_id !== record.project_id) {
        throw new AppError('Données invalides', { [key]: `${field.label} : appartient à un autre projet` });
      }
    }
  }

  /** Crée un élément ; `id` permet d'imposer l'identifiant (restauration depuis Excel). */
  function create(def, body, { id } = {}) {
    const { data, errors } = validate(def, body);
    if (errors) throw new AppError('Données invalides', errors);
    checkRecord(def, data);
    if (id !== undefined && (!Number.isInteger(id) || id <= 0 || findRow(def, id))) {
      throw new AppError('Identifiant déjà utilisé ou invalide', { id: `ID ${id} déjà utilisé` });
    }
    const newId = id ?? state.seq[def.table] + 1;
    state.seq[def.table] = Math.max(state.seq[def.table], newId);
    const row = { id: newId, ...data, created_at: new Date().toISOString() };
    rowsOf(def).push(row);
    emit();
    return { ...row };
  }

  function update(def, id, body) {
    const row = findRow(def, Number(id));
    if (!row) throw new AppError('Élément introuvable', undefined, 404);
    const { data, errors } = validate(def, body, { partial: true });
    if (errors) throw new AppError('Données invalides', errors);
    const merged = { ...row, ...data };
    checkRecord(def, merged);
    Object.assign(row, data);
    emit();
    return { ...row };
  }

  function removeRow(def, id) {
    const row = findRow(def, id);
    if (!row) return false;
    // Applique les règles de suppression des tables qui pointent vers celle-ci.
    for (const other of Object.values(resources)) {
      for (const [key, field] of Object.entries(other.fields)) {
        if (field.ref !== def.table) continue;
        for (const dep of rowsOf(other).filter((r) => r[key] === id)) {
          if (field.onDelete === 'cascade') removeRow(other, dep.id);
          else dep[key] = null;
        }
      }
    }
    state.tables[def.table] = rowsOf(def).filter((r) => r.id !== id);
    return true;
  }

  function remove(def, id) {
    if (!removeRow(def, Number(id))) throw new AppError('Élément introuvable', undefined, 404);
    emit();
  }

  /**
   * Exécute `fn` d'un bloc : en cas d'erreur, ou si `rollback` (booléen ou fonction
   * évaluée sur le résultat) est vrai, toutes les modifications sont annulées.
   */
  function transaction(fn, { rollback = false } = {}) {
    const snapshot = structuredClone(state);
    batchDepth++;
    let cancel = true;
    try {
      const result = fn();
      cancel = typeof rollback === 'function' ? rollback(result) : rollback;
      return result;
    } finally {
      batchDepth--;
      if (cancel) state = snapshot;
      if (!batchDepth && pending) {
        pending = false;
        if (!cancel) emit();
      }
    }
  }

  function wipe() {
    state = emptyState();
    emit();
  }

  /** Remplace tout le contenu (ouverture d'une sauvegarde). */
  function load(json) {
    state = normalizeState(json);
    emit();
  }

  const counts = () => Object.fromEntries(TABLE_ORDER.map((t) => [t, state.tables[t].length]));

  return {
    findById, list, create, update, remove, transaction, wipe, load, counts,
    toJSON: () => structuredClone(state),
    all: (table) => state.tables[table],
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
