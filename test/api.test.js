import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/server.js';

const TODAY = '2026-03-15';
let server;
let base;

before(async () => {
  server = createServer({ db: openDb(':memory:'), now: () => TODAY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('crée, lit, modifie et supprime un projet', async () => {
  const created = await call('POST', '/api/projects', { name: '  Site web  ', budget: '1 500,50' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Site web');
  assert.equal(created.body.budget, 1500.5);
  assert.equal(created.body.status, 'planned');

  const id = created.body.id;
  const patched = await call('PATCH', `/api/projects/${id}`, { status: 'active' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'active');
  assert.equal(patched.body.name, 'Site web');

  assert.equal((await call('GET', `/api/projects/${id}`)).body.status, 'active');
  assert.equal((await call('DELETE', `/api/projects/${id}`)).status, 204);
  assert.equal((await call('GET', `/api/projects/${id}`)).status, 404);
});

test('rejette les données invalides avec le détail par champ', async () => {
  const res = await call('POST', '/api/projects', {
    name: '', budget: -3, status: 'inconnu', start_date: '2026-02-30',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.details).sort(), ['budget', 'name', 'start_date', 'status']);

  const order = await call('POST', '/api/projects', { name: 'X', start_date: '2026-05-01', end_date: '2026-04-01' });
  assert.equal(order.status, 400);
  assert.ok(order.body.details.end_date);

  const email = await call('POST', '/api/contributors', { name: 'Bob', email: 'pas-un-email' });
  assert.equal(email.status, 400);
  assert.ok(email.body.details.email);
});

test("valide l'ordre des dates en tenant compte des valeurs existantes", async () => {
  const p = (await call('POST', '/api/projects', { name: 'Dates', start_date: '2026-01-10', end_date: '2026-02-10' })).body;
  const res = await call('PATCH', `/api/projects/${p.id}`, { end_date: '2026-01-01' });
  assert.equal(res.status, 400);
});

test('refuse une référence vers un projet inexistant', async () => {
  const res = await call('POST', '/api/tasks', { project_id: 99999, title: 'Orpheline' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Référence invalide/);
});

test('JSON invalide et routes inconnues', async () => {
  const res = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await call('GET', '/api/inconnu')).status, 404);
  assert.equal((await call('GET', '/api/projects/abc')).status, 404);
  assert.equal((await call('GET', '/api/projects/1/autre')).status, 404);
  assert.equal((await call('PUT', '/api/projects')).status, 405);
});

test('calcule la synthèse, les échéances et la charge', async () => {
  const alice = (await call('POST', '/api/contributors', { name: 'Alice', daily_rate: 400 })).body;
  const p = (await call('POST', '/api/projects', {
    name: 'Appli', status: 'active', budget: 1000, start_date: '2026-03-01', end_date: '2026-04-30',
  })).body;
  const mk = (body) => call('POST', '/api/tasks', { project_id: p.id, ...body });
  await mk({ title: 'Terminée', status: 'done', assignee_id: alice.id, due_date: '2026-03-01', estimated_hours: 8 });
  const late = (await mk({ title: 'En retard', status: 'in_progress', assignee_id: alice.id, due_date: '2026-03-10', estimated_hours: 16 })).body;
  await mk({ title: 'À venir', due_date: '2026-03-20' });
  await call('POST', '/api/milestones', { project_id: p.id, name: 'Démo', due_date: '2026-03-18' });
  await call('POST', '/api/expenses', { project_id: p.id, label: 'Licence', amount: 950, date: '2026-03-02', contributor_id: alice.id });

  const s = (await call('GET', `/api/projects/${p.id}/summary`)).body;
  assert.equal(s.task_total, 3);
  assert.equal(s.task_done, 1);
  assert.equal(s.task_overdue, 1);
  assert.equal(s.progress, 33);
  assert.equal(s.spent, 950);
  assert.equal(s.remaining_budget, 50);
  assert.equal(s.labor_forecast, 1200); // 24 h × 400 € / 8 h
  assert.equal(s.next_deadline, '2026-03-18');
  assert.equal(s.health, 'warning'); // tâche en retard + budget > 90 %

  const deadlines = (await call('GET', `/api/deadlines?project_id=${p.id}`)).body;
  assert.deepEqual(deadlines.map((d) => [d.kind, d.name, d.overdue]), [
    ['task', 'En retard', true],
    ['milestone', 'Démo', false],
    ['task', 'À venir', false],
  ]);
  assert.equal(deadlines[0].assignee_name, 'Alice');

  const workload = (await call('GET', '/api/workload')).body.find((c) => c.id === alice.id);
  assert.equal(workload.open_tasks, 1);
  assert.equal(workload.done_tasks, 1);
  assert.equal(workload.open_hours, 16);
  assert.equal(workload.overdue_tasks, 1);
  assert.equal(workload.expenses_total, 950);

  // Dépassement de budget => critique
  await call('POST', '/api/expenses', { project_id: p.id, label: 'Extra', amount: 100, date: '2026-03-03' });
  assert.equal((await call('GET', `/api/projects/${p.id}/summary`)).body.health, 'critical');

  // Filtres de liste
  const doneTasks = (await call('GET', `/api/tasks?project_id=${p.id}&status=done`)).body;
  assert.deepEqual(doneTasks.map((t) => t.title), ['Terminée']);

  // Suppression d'un contributeur : ses tâches deviennent non assignées
  await call('DELETE', `/api/contributors/${alice.id}`);
  assert.equal((await call('GET', `/api/tasks/${late.id}`)).body.assignee_id, null);

  // Suppression du projet en cascade
  await call('DELETE', `/api/projects/${p.id}`);
  assert.deepEqual((await call('GET', `/api/tasks?project_id=${p.id}`)).body, []);
  assert.deepEqual((await call('GET', `/api/expenses?project_id=${p.id}`)).body, []);
});

test('tableau de bord agrégé', async () => {
  const d = (await call('GET', '/api/dashboard')).body;
  assert.equal(d.today, TODAY);
  assert.ok(Array.isArray(d.projects));
  assert.equal(typeof d.totals.budget_total, 'number');
  assert.ok(d.deadlines.every((x) => x.due_date <= '2026-04-14'));
});

test('sert les fichiers statiques sans sortir du dossier public', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(await index.text(), /Pilotage de projets/);

  const js = await fetch(`${base}/js/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);

  const traversal = await fetch(`${base}/%2e%2e/package.json`);
  assert.ok([403, 404].includes(traversal.status));
});

test("refuse les modifications venant d'un autre site (CSRF)", async () => {
  const res = await fetch(`${base}/api/admin/reset`, {
    method: 'POST',
    headers: { Origin: 'https://site-malveillant.example', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ confirm: 'SUPPRIMER' }),
  });
  assert.equal(res.status, 403);
  const same = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Même origine' }),
  });
  assert.equal(same.status, 201);
});
