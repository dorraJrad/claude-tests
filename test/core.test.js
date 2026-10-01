import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, AppError } from '../src/core/store.js';
import { resources as R } from '../src/core/schema.js';
import { projectSummaries, projectBudget, portfolioBudget, deadlines, workload, dashboard, expenseStatus } from '../src/core/metrics.js';
import { insertDemoData } from '../src/core/demo.js';

const TODAY = '2026-03-15';

function rejects(fn, field) {
  assert.throws(fn, (err) => err instanceof AppError && (!field || Object.hasOwn(err.details ?? {}, field)));
}

test('crée, modifie et supprime en validant les données', () => {
  const s = createStore();
  const p = s.create(R.projects, { name: '  Site web  ', budget: '1 500,50' });
  assert.equal(p.name, 'Site web');
  assert.equal(p.budget, 1500.5);
  assert.equal(p.status, 'planned');
  assert.equal(s.update(R.projects, p.id, { status: 'active' }).status, 'active');

  rejects(() => s.create(R.projects, { name: '' }), 'name');
  rejects(() => s.create(R.projects, { name: 'X', budget: -3 }), 'budget');
  rejects(() => s.create(R.projects, { name: 'X', start_date: '2026-02-30' }), 'start_date');
  rejects(() => s.create(R.projects, { name: 'X', start_date: '2026-05-01', end_date: '2026-04-01' }), 'end_date');
  rejects(() => s.update(R.projects, p.id, { start_date: '2027-01-01', end_date: '2026-01-01' }), 'end_date');
  rejects(() => s.create(R.contributors, { name: 'Bob', email: 'pas-un-email' }), 'email');
  rejects(() => s.create(R.tasks, { project_id: 999, title: 'Orpheline' }), 'project_id');

  s.remove(R.projects, p.id);
  assert.equal(s.findById(R.projects, p.id), undefined);
  assert.throws(() => s.remove(R.projects, p.id), AppError);
});

test('engagé et réalisé : le réalisé ne peut pas dépasser l\'engagé', () => {
  const s = createStore();
  const p = s.create(R.projects, { name: 'P', budget: 1000 });
  rejects(() => s.create(R.expenses, { project_id: p.id, label: 'Commande', date: TODAY, amount_committed: 100, amount_invoiced: 150 }), 'amount_invoiced');
  const e = s.create(R.expenses, { project_id: p.id, label: 'Commande', date: TODAY, amount_committed: 100 });
  assert.equal(e.amount_invoiced, 0);
  assert.equal(expenseStatus(e), 'committed');
  assert.equal(expenseStatus(s.update(R.expenses, e.id, { amount_invoiced: 40 })), 'partial');
  assert.equal(expenseStatus(s.update(R.expenses, e.id, { amount_invoiced: 100 })), 'done');
  rejects(() => s.update(R.expenses, e.id, { amount_committed: 50 }), 'amount_invoiced');
});

test("un poste ou une tâche lié doit appartenir au même projet que l'engagement", () => {
  const s = createStore();
  const a = s.create(R.projects, { name: 'A' });
  const b = s.create(R.projects, { name: 'B' });
  const lineB = s.create(R.budget_lines, { project_id: b.id, name: 'Poste de B', amount: 10 });
  rejects(() => s.create(R.expenses, { project_id: a.id, budget_line_id: lineB.id, label: 'X', date: TODAY, amount_committed: 1 }), 'budget_line_id');
  const ok = s.create(R.expenses, { project_id: b.id, budget_line_id: lineB.id, label: 'X', date: TODAY, amount_committed: 1 });
  rejects(() => s.update(R.expenses, ok.id, { project_id: a.id }), 'budget_line_id');
});

test('suppressions en cascade et liens retirés', () => {
  const s = createStore();
  const alice = s.create(R.contributors, { name: 'Alice' });
  const p = s.create(R.projects, { name: 'P' });
  const line = s.create(R.budget_lines, { project_id: p.id, name: 'Poste', amount: 100 });
  const t = s.create(R.tasks, { project_id: p.id, title: 'T', assignee_id: alice.id });
  const e = s.create(R.expenses, { project_id: p.id, budget_line_id: line.id, task_id: t.id, contributor_id: alice.id, label: 'E', date: TODAY, amount_committed: 10 });

  s.remove(R.budget_lines, line.id);
  assert.equal(s.findById(R.expenses, e.id).budget_line_id, null); // la dépense reste, non affectée
  s.remove(R.contributors, alice.id);
  assert.equal(s.findById(R.tasks, t.id).assignee_id, null);
  assert.equal(s.findById(R.expenses, e.id).contributor_id, null);
  s.remove(R.projects, p.id);
  assert.deepEqual(s.counts(), { contributors: 0, projects: 0, budget_lines: 0, tasks: 0, milestones: 0, expenses: 0 });
});

test('transactions : tout ou rien', () => {
  const s = createStore();
  let notified = 0;
  s.subscribe(() => notified++);
  assert.throws(() => s.transaction(() => {
    s.create(R.projects, { name: 'Créé puis annulé' });
    s.create(R.projects, { name: '' });
  }), AppError);
  assert.equal(s.counts().projects, 0);
  assert.equal(notified, 0);
  s.transaction(() => s.create(R.projects, { name: 'Annulé' }), { rollback: true });
  assert.equal(s.counts().projects, 0);
  s.transaction(() => {
    s.create(R.projects, { name: 'A' });
    s.create(R.projects, { name: 'B' });
  });
  assert.equal(s.counts().projects, 2);
  assert.equal(notified, 1); // une seule notification pour toute la transaction
});

test('sauvegarde et rechargement (JSON) conservent les identifiants', () => {
  const s = createStore();
  insertDemoData(s, TODAY);
  const copy = createStore(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(copy.counts(), s.counts());
  const p = copy.create(R.projects, { name: 'Nouveau' });
  assert.ok(p.id > Math.max(...s.all('projects').map((x) => x.id)));
  assert.deepEqual(createStore({ n_importe: 'quoi' }).counts().projects, 0);
});

test('budget par poste : prévu, engagé, réalisé, disponible, reste à payer', () => {
  const s = createStore();
  const p = s.create(R.projects, { name: 'P', budget: 10000, status: 'active' });
  const dev = s.create(R.budget_lines, { project_id: p.id, name: 'Développement', category: 'prestation', amount: 6000 });
  const lic = s.create(R.budget_lines, { project_id: p.id, name: 'Licences', category: 'logiciel', amount: 1000 });
  const spend = (budget_line_id, committed, invoiced, date = '2026-03-01') => s.create(R.expenses, {
    project_id: p.id, budget_line_id, label: 'x', date, amount_committed: committed, amount_invoiced: invoiced,
  });
  spend(dev.id, 5000, 2000);
  spend(dev.id, 1500, 0, '2026-04-02');
  spend(lic.id, 300, 300);
  spend(null, 200, 200);

  const b = projectBudget(s, p.id);
  assert.deepEqual(
    b.lines.map((l) => [l.name, l.budget, l.committed, l.invoiced, l.available, l.to_pay, l.over]),
    [['Développement', 6000, 6500, 2000, -500, 4500, true], ['Licences', 1000, 300, 300, 700, 0, false]],
  );
  assert.equal(b.unassigned.committed, 200);
  assert.equal(b.totals.budget, 10000);
  assert.equal(b.totals.allocated, 7000);
  assert.equal(b.totals.unallocated, 3000);
  assert.equal(b.totals.committed, 7000);
  assert.equal(b.totals.invoiced, 2500);
  assert.equal(b.totals.available, 3000);
  assert.equal(b.totals.to_pay, 4500);
  assert.equal(b.totals.lines_over, 1);
  assert.deepEqual(b.monthly.map((m) => [m.month, m.committed, m.cum_committed]), [['2026-03', 5500, 5500], ['2026-04', 1500, 7000]]);
  assert.deepEqual(b.byCategory.map((c) => [c.category, c.budget, c.committed]), [['prestation', 6000, 6500], ['logiciel', 1000, 300], [null, 0, 200]]);

  // Un poste en dépassement rend le projet « à surveiller » ; un dépassement global le rend « critique ».
  assert.equal(projectSummaries(s, TODAY)[0].health, 'warning');
  spend(lic.id, 3500, 0);
  assert.equal(projectSummaries(s, TODAY)[0].health, 'critical');
});

test('vue portefeuille consolidée', () => {
  const s = createStore();
  insertDemoData(s, TODAY);
  const pf = portfolioBudget(s);
  assert.equal(pf.projects.length, 3);
  assert.equal(pf.totals.budget, 130000);
  assert.equal(pf.totals.committed, pf.projects.reduce((a, p) => a + p.committed, 0));
  assert.equal(pf.totals.available, pf.totals.budget - pf.totals.committed);
  const presta = pf.byCategory.find((c) => c.category === 'prestation');
  assert.equal(presta.budget, 24000 + 20000 + 9000);
});

test('synthèse, échéances et charge', () => {
  const s = createStore();
  const alice = s.create(R.contributors, { name: 'Alice', daily_rate: 400 });
  const p = s.create(R.projects, { name: 'Appli', status: 'active', budget: 1000, start_date: '2026-03-01', end_date: '2026-04-30' });
  const mk = (body) => s.create(R.tasks, { project_id: p.id, ...body });
  mk({ title: 'Terminée', status: 'done', assignee_id: alice.id, due_date: '2026-03-01', estimated_hours: 8 });
  mk({ title: 'En retard', status: 'in_progress', assignee_id: alice.id, due_date: '2026-03-10', estimated_hours: 16 });
  mk({ title: 'À venir', due_date: '2026-03-20' });
  s.create(R.milestones, { project_id: p.id, name: 'Démo', due_date: '2026-03-18' });

  const [sum] = projectSummaries(s, TODAY);
  assert.equal(sum.progress, 33);
  assert.equal(sum.task_overdue, 1);
  assert.equal(sum.labor_forecast, 1200);
  assert.equal(sum.next_deadline, '2026-03-18');
  assert.equal(sum.health, 'warning');

  assert.deepEqual(deadlines(s, TODAY).map((d) => [d.kind, d.name, d.overdue]), [
    ['task', 'En retard', true], ['milestone', 'Démo', false], ['task', 'À venir', false],
  ]);
  const w = workload(s, TODAY).find((c) => c.id === alice.id);
  assert.deepEqual([w.open_tasks, w.done_tasks, w.open_hours, w.overdue_tasks], [1, 1, 16, 1]);

  const d = dashboard(s, TODAY);
  assert.equal(d.totals.tasks_overdue, 1);
  assert.ok(d.deadlines.every((x) => x.due_date <= '2026-04-14'));
});
