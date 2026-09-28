import { resources, isIsoDate, describeSchema } from './resources.js';
import { localToday } from './db.js';
import { HttpError } from './errors.js';
import { createRepo } from './repo.js';
import { exportWorkbook, importWorkbook } from './datasheets.js';
import { insertDemoData } from './demo.js';

export { HttpError };

const MAX_JSON = 1024 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `Fichier trop volumineux (${Math.round(limit / 1024 / 1024)} Mo maximum)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function sendFile(res, buffer, filename, type) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

function projectHealth(p, today) {
  const late = p.end_date && p.end_date < today && p.status !== 'completed';
  if (p.spent > p.budget || late) return 'critical';
  const overdue = p.task_overdue + p.milestone_overdue;
  if (overdue > 0 || (p.budget > 0 && p.spent > 0.9 * p.budget)) return 'warning';
  return 'ok';
}

export function createApi(db, { now = localToday } = {}) {
  const repo = createRepo(db);
  const { prepare } = repo;

  function requireId(raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Ressource introuvable');
    return id;
  }

  const filtersFrom = (def, url) => Object.fromEntries(
    def.filters.filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k)]));

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

    if (name === 'schema' && !rawId && method === 'GET') return sendJson(res, 200, describeSchema());

    if (name === 'export' && !rawId && method === 'GET') {
      const template = url.searchParams.get('template') === '1';
      const file = exportWorkbook(repo, { template });
      const fname = template ? 'modele-pilotage-projets.xlsx' : `pilotage-projets-${now()}.xlsx`;
      return sendFile(res, file, fname, XLSX_TYPE);
    }

    if (name === 'import' && !rawId && method === 'POST') {
      const buffer = await readBody(req, MAX_UPLOAD);
      if (!buffer.length) throw new HttpError(400, 'Aucun fichier reçu');
      const report = importWorkbook(repo, buffer, {
        mode: url.searchParams.get('mode') || 'merge',
        dryRun: url.searchParams.get('dryRun') === '1',
      });
      return sendJson(res, 200, report);
    }

    if (name === 'admin' && method === 'GET' && rawId === 'stats' && !sub) {
      return sendJson(res, 200, Object.fromEntries(Object.entries(resources).map(([key, def]) =>
        [key, prepare(`SELECT COUNT(*) AS n FROM ${def.table}`).get().n])));
    }
    if (name === 'admin' && method === 'POST' && rawId === 'reset' && !sub) {
      const body = await readJson(req);
      if (body.confirm !== 'SUPPRIMER') throw new HttpError(400, 'Confirmation manquante : saisissez SUPPRIMER');
      repo.transaction(() => repo.wipe());
      return sendJson(res, 200, { ok: true });
    }
    if (name === 'admin' && method === 'POST' && rawId === 'demo' && !sub) {
      repo.transaction(() => insertDemoData(db));
      return sendJson(res, 200, { ok: true });
    }

    if (name === 'projects' && sub === 'summary' && method === 'GET') {
      const [summary] = projectSummaries(requireId(rawId));
      if (!summary) throw new HttpError(404, 'Projet introuvable');
      return sendJson(res, 200, summary);
    }

    const def = Object.hasOwn(resources, name) ? resources[name] : null;
    if (!def || sub !== undefined) throw new HttpError(404, 'Route introuvable');

    if (!rawId) {
      if (method === 'GET') return sendJson(res, 200, repo.list(def, filtersFrom(def, url)));
      if (method === 'POST') return sendJson(res, 201, repo.create(def, await readJson(req)));
      throw new HttpError(405, 'Méthode non autorisée');
    }

    const id = requireId(rawId);
    if (method === 'GET') {
      const row = repo.findById(def, id);
      if (!row) throw new HttpError(404, 'Ressource introuvable');
      return sendJson(res, 200, row);
    }
    if (method === 'PATCH' || method === 'PUT') return sendJson(res, 200, repo.update(def, id, await readJson(req)));
    if (method === 'DELETE') {
      repo.remove(def, id);
      return sendJson(res, 204);
    }
    throw new HttpError(405, 'Méthode non autorisée');
  };
}
