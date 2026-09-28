import { resources, validate, coerce, isIsoDate } from './resources.js';
import { localToday } from './db.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const MAX_BODY = 1024 * 1024;

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

export function sendJson(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function translateDbError(err) {
  const msg = String(err?.message ?? '');
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(400, 'Référence invalide : un élément lié est introuvable');
  }
  return err;
}

function projectHealth(p, today) {
  const late = p.end_date && p.end_date < today && p.status !== 'completed';
  if (p.spent > p.budget || late) return 'critical';
  const overdue = p.task_overdue + p.milestone_overdue;
  if (overdue > 0 || (p.budget > 0 && p.spent > 0.9 * p.budget)) return 'warning';
  return 'ok';
}

export function createApi(db, { now = localToday } = {}) {
  const stmts = new Map();
  const prepare = (sql) => {
    if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql));
    return stmts.get(sql);
  };

  const findById = (def, id) => prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id);

  function requireId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Ressource introuvable');
    return id;
  }

  function runCheck(def, record) {
    const errors = def.check?.(record);
    if (errors) throw new HttpError(400, 'Données invalides', errors);
  }

  // --- CRUD générique -------------------------------------------------------

  function list(def, url) {
    const where = [];
    const params = [];
    for (const key of def.filters) {
      const raw = url.searchParams.get(key);
      if (raw === null) continue;
      const { value, error } = coerce(def.fields[key], raw);
      if (error) throw new HttpError(400, `Filtre invalide : ${key}`);
      if (value === null) where.push(`${key} IS NULL`);
      else { where.push(`${key} = ?`); params.push(value); }
    }
    const sql = `SELECT * FROM ${def.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${def.orderBy}`;
    return db.prepare(sql).all(...params);
  }

  function create(def, body) {
    const { data, errors } = validate(def, body);
    if (errors) throw new HttpError(400, 'Données invalides', errors);
    runCheck(def, data);
    const cols = Object.keys(data);
    const sql = `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`;
    try {
      return prepare(sql).get(...cols.map((c) => data[c]));
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

  // --- Indicateurs ----------------------------------------------------------

  function projectSummaries(projectId = null) {
    const today = now();
    const rows = prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_total,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS task_done,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress') AS task_in_progress,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done' AND t.due_date < :today) AS task_overdue,
        (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestone_total,
        (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestone_done,
        (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 0 AND m.due_date < :today) AS milestone_overdue,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.project_id = p.id) AS spent,
        (SELECT COALESCE(SUM(t.estimated_hours * c.daily_rate / 8.0), 0)
           FROM tasks t JOIN contributors c ON c.id = t.assignee_id WHERE t.project_id = p.id) AS labor_forecast,
        (SELECT COALESCE(SUM(t.estimated_hours), 0) FROM tasks t WHERE t.project_id = p.id) AS estimated_hours,
        (SELECT COUNT(DISTINCT t.assignee_id) FROM tasks t WHERE t.project_id = p.id) AS contributor_count,
        (SELECT MIN(t.due_date) FROM tasks t
           WHERE t.project_id = p.id AND t.status <> 'done' AND t.due_date >= :today) AS next_task_deadline,
        (SELECT MIN(m.due_date) FROM milestones m
           WHERE m.project_id = p.id AND m.done = 0 AND m.due_date >= :today) AS next_milestone_deadline
      FROM projects p
      WHERE (:pid IS NULL OR p.id = :pid)
      ORDER BY p.created_at DESC, p.id DESC`).all({ today, pid: projectId });

    return rows.map((p) => {
      const { next_task_deadline: a, next_milestone_deadline: b, ...rest } = p;
      const summary = {
        ...rest,
        next_deadline: a && b ? (a < b ? a : b) : (a ?? b),
        progress: p.task_total ? Math.round((p.task_done * 100) / p.task_total) : 0,
        remaining_budget: Math.round((p.budget - p.spent) * 100) / 100,
      };
      summary.health = projectHealth(summary, today);
      return summary;
    });
  }

  function deadlines(url) {
    const today = now();
    const pidRaw = url.searchParams.get('project_id');
    const pid = pidRaw ? requireId(pidRaw) : null;
    const until = url.searchParams.get('until');
    if (until !== null && !isIsoDate(until)) throw new HttpError(400, 'Paramètre until invalide');
    const rows = prepare(`
      SELECT * FROM (
        SELECT 'task' AS kind, t.id, t.title AS name, t.due_date, t.status, t.priority,
               p.id AS project_id, p.name AS project_name, c.id AS assignee_id, c.name AS assignee_name
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          LEFT JOIN contributors c ON c.id = t.assignee_id
         WHERE t.status <> 'done' AND t.due_date IS NOT NULL
        UNION ALL
        SELECT 'milestone', m.id, m.name, m.due_date, 'todo', NULL,
               p.id, p.name, NULL, NULL
          FROM milestones m
          JOIN projects p ON p.id = m.project_id
         WHERE m.done = 0
      )
      WHERE (:pid IS NULL OR project_id = :pid)
        AND (:until IS NULL OR due_date <= :until)
      ORDER BY due_date, kind DESC, id`).all({ pid, until });
    return rows.map((r) => ({ ...r, overdue: r.due_date < today }));
  }

  function workload() {
    return prepare(`
      SELECT c.*,
        COUNT(t.id) AS task_total,
        COALESCE(SUM(t.status = 'done'), 0) AS done_tasks,
        COALESCE(SUM(t.status <> 'done'), 0) AS open_tasks,
        COALESCE(SUM(CASE WHEN t.status <> 'done' THEN t.estimated_hours ELSE 0 END), 0) AS open_hours,
        COALESCE(SUM(t.status <> 'done' AND t.due_date < :today), 0) AS overdue_tasks,
        COUNT(DISTINCT t.project_id) AS project_count,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.contributor_id = c.id) AS expenses_total
      FROM contributors c
      LEFT JOIN tasks t ON t.assignee_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE, c.id`).all({ today: now() });
  }

  function dashboard() {
    const projects = projectSummaries();
    const sum = (key, list = projects) => list.reduce((acc, p) => acc + (p[key] || 0), 0);
    const open = projects.filter((p) => p.status !== 'completed');
    const horizon = new Date(`${now()}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 30);
    const upcoming = deadlines(new URL(`http://x/?until=${horizon.toISOString().slice(0, 10)}`));
    const team = workload();
    return {
      today: now(),
      totals: {
        projects_total: projects.length,
        projects_active: projects.filter((p) => p.status === 'active').length,
        projects_at_risk: open.filter((p) => p.health !== 'ok').length,
        budget_total: sum('budget'),
        spent_total: Math.round(sum('spent') * 100) / 100,
        tasks_total: sum('task_total'),
        tasks_done: sum('task_done'),
        tasks_overdue: sum('task_overdue'),
        milestones_overdue: sum('milestone_overdue'),
        contributors: team.length,
      },
      projects,
      deadlines: upcoming,
      workload: team,
    };
  }

  // --- Routage --------------------------------------------------------------

  return async function handle(req, res, url) {
    const [, , name, rawId, sub, ...rest] = url.pathname.split('/');
    const method = req.method;

    if (rest.length) throw new HttpError(404, 'Route introuvable');

    if (name === 'dashboard' && !rawId && method === 'GET') return sendJson(res, 200, dashboard());
    if (name === 'deadlines' && !rawId && method === 'GET') return sendJson(res, 200, deadlines(url));
    if (name === 'workload' && !rawId && method === 'GET') return sendJson(res, 200, workload());

    if (name === 'projects' && sub === 'summary' && method === 'GET') {
      const [summary] = projectSummaries(requireId(rawId));
      if (!summary) throw new HttpError(404, 'Projet introuvable');
      return sendJson(res, 200, summary);
    }

    const def = Object.hasOwn(resources, name) ? resources[name] : null;
    if (!def || sub !== undefined) throw new HttpError(404, 'Route introuvable');

    if (!rawId) {
      if (method === 'GET') return sendJson(res, 200, list(def, url));
      if (method === 'POST') return sendJson(res, 201, create(def, await readJson(req)));
      throw new HttpError(405, 'Méthode non autorisée');
    }

    const id = requireId(rawId);
    if (method === 'GET') {
      const row = findById(def, id);
      if (!row) throw new HttpError(404, 'Ressource introuvable');
      return sendJson(res, 200, row);
    }
    if (method === 'PATCH' || method === 'PUT') return sendJson(res, 200, update(def, id, await readJson(req)));
    if (method === 'DELETE') {
      remove(def, id);
      return sendJson(res, 204);
    }
    throw new HttpError(405, 'Méthode non autorisée');
  };
}
