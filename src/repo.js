// Accès aux données : CRUD générique validé à partir des définitions de resources.js.
import { validate, coerce } from './resources.js';
import { HttpError } from './errors.js';

export function translateDbError(err) {
  const msg = String(err?.message ?? '');
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(400, 'Référence invalide : un élément lié est introuvable');
  }
  if (msg.includes('UNIQUE constraint failed')) {
    return new HttpError(400, 'Identifiant déjà utilisé');
  }
  return err;
}

export function createRepo(db) {
  const stmts = new Map();
  const prepare = (sql) => {
    if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql));
    return stmts.get(sql);
  };

  const findById = (def, id) => prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id);

  function runCheck(def, record) {
    const errors = def.check?.(record);
    if (errors) throw new HttpError(400, 'Données invalides', errors);
  }

  /** `filters` : objet { champ: valeur brute } limité aux filtres autorisés. */
  function list(def, filters = {}) {
    const where = [];
    const params = [];
    for (const key of def.filters) {
      if (!Object.hasOwn(filters, key)) continue;
      const { value, error } = coerce(def.fields[key], filters[key]);
      if (error) throw new HttpError(400, `Filtre invalide : ${key}`);
      if (value === null) where.push(`${key} IS NULL`);
      else { where.push(`${key} = ?`); params.push(value); }
    }
    const sql = `SELECT * FROM ${def.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${def.orderBy}`;
    return prepare(sql).all(...params);
  }

  /** Crée un enregistrement ; `id` permet d'imposer l'identifiant (restauration depuis Excel). */
  function create(def, body, { id } = {}) {
    const { data, errors } = validate(def, body);
    if (errors) throw new HttpError(400, 'Données invalides', errors);
    runCheck(def, data);
    const row = id ? { id, ...data } : data;
    const cols = Object.keys(row);
    const sql = `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`;
    try {
      return prepare(sql).get(...cols.map((c) => row[c]));
    } catch (err) {
      throw translateDbError(err);
    }
  }

  function update(def, id, body) {
    const existing = findById(def, id);
    if (!existing) throw new HttpError(404, 'Ressource introuvable');
    const { data, errors } = validate(def, body, { partial: true });
    if (errors) throw new HttpError(400, 'Données invalides', errors);
    runCheck(def, { ...existing, ...data });
    const cols = Object.keys(data);
    if (!cols.length) return existing;
    const sql = `UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? RETURNING *`;
    try {
      return prepare(sql).get(...cols.map((c) => data[c]), id);
    } catch (err) {
      throw translateDbError(err);
    }
  }

  function remove(def, id) {
    const { changes } = prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
    if (!changes) throw new HttpError(404, 'Ressource introuvable');
  }

  /**
   * Exécute `fn` dans une transaction ; annule si `fn` lève une erreur ou si `rollback`
   * (booléen ou fonction évaluée après `fn`) est vrai.
   */
  function transaction(fn, { rollback = false } = {}) {
    db.exec('BEGIN');
    try {
      const result = fn();
      const cancel = typeof rollback === 'function' ? rollback(result) : rollback;
      db.exec(cancel ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function wipe() {
    for (const table of ['expenses', 'milestones', 'tasks', 'projects', 'contributors']) {
      db.exec(`DELETE FROM ${table}`);
    }
  }

  return { db, prepare, findById, list, create, update, remove, transaction, wipe };
}
