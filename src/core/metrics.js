// Indicateurs calculés : synthèse des projets, budget, échéances et charge des contributeurs.
import { resources } from './schema.js';

export const round2 = (n) => Math.round((n || 0) * 100) / 100;
const sum = (list, fn) => round2(list.reduce((acc, x) => acc + (fn(x) || 0), 0));
const ratio = (a, b) => (b > 0 ? a / b : a > 0 ? Infinity : 0);

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Statut d'un engagement selon la part déjà réalisée (facturée / payée). */
export function expenseStatus(e) {
  if (e.amount_committed > 0 && e.amount_invoiced >= e.amount_committed) return 'done';
  if (e.amount_invoiced > 0) return 'partial';
  return 'committed';
}

// --- Budget -------------------------------------------------------------------

/** Indicateurs d'une enveloppe : disponible = prévu − engagé ; reste à payer = engagé − réalisé. */
function figures(budget, committed, invoiced) {
  return {
    budget: round2(budget),
    committed: round2(committed),
    invoiced: round2(invoiced),
    available: round2(budget - committed),
    to_pay: round2(committed - invoiced),
    committed_rate: ratio(committed, budget),
    invoiced_rate: ratio(invoiced, budget),
    over: committed > budget + 0.005,
  };
}

const lineFigures = (budget, expenses) =>
  figures(budget, sum(expenses, (e) => e.amount_committed), sum(expenses, (e) => e.amount_invoiced));

/** Regroupe postes et dépenses par nature de poste (`null` = dépenses non affectées). */
function groupByCategory(lines, expenses) {
  const lineCategory = new Map(lines.map((l) => [l.id, l.category]));
  const groups = new Map();
  const bucket = (key) => {
    if (!groups.has(key)) groups.set(key, { budget: 0, committed: 0, invoiced: 0 });
    return groups.get(key);
  };
  for (const l of lines) bucket(l.category).budget += l.amount;
  for (const e of expenses) {
    const g = bucket(lineCategory.get(e.budget_line_id) ?? null);
    g.committed += e.amount_committed;
    g.invoiced += e.amount_invoiced;
  }
  return [...groups.entries()]
    .map(([category, g]) => ({ category, ...figures(g.budget, g.committed, g.invoiced) }))
    .sort((a, b) => b.budget - a.budget || b.committed - a.committed);
}

/**
 * Budget détaillé d'un projet :
 * - budget global (enveloppe du projet) et part répartie sur les postes ;
 * - par poste : prévu, engagé, réalisé, disponible (= prévu − engagé), reste à payer (= engagé − réalisé) ;
 * - répartition par nature et évolution mensuelle.
 */
export function projectBudget(store, projectId) {
  const project = store.all('projects').find((p) => p.id === projectId);
  if (!project) return null;
  const lines = store.all('budget_lines').filter((l) => l.project_id === projectId).sort(resources.budget_lines.sort);
  const expenses = store.all('expenses').filter((e) => e.project_id === projectId);
  const lineIds = new Set(lines.map((l) => l.id));
  const unassigned = expenses.filter((e) => !lineIds.has(e.budget_line_id));

  const byLine = lines.map((l) => ({
    ...l,
    ...lineFigures(l.amount, expenses.filter((e) => e.budget_line_id === l.id)),
    expense_count: expenses.filter((e) => e.budget_line_id === l.id).length,
  }));
  const allocated = sum(lines, (l) => l.amount);
  const totals = {
    ...lineFigures(project.budget, expenses),
    allocated,
    unallocated: round2(project.budget - allocated),
    over_allocated: allocated > project.budget + 0.005,
    lines_over: byLine.filter((l) => l.over).length,
  };

  return {
    project,
    totals,
    lines: byLine,
    unassigned: unassigned.length ? { ...lineFigures(0, unassigned), expense_count: unassigned.length } : null,
    byCategory: groupByCategory(lines, expenses),
    monthly: monthlySeries(expenses, project.budget),
  };
}

/** Engagé et réalisé par mois, avec cumuls (courbe de consommation du budget). */
export function monthlySeries(expenses, budget = 0) {
  const months = new Map();
  for (const e of expenses) {
    const m = e.date.slice(0, 7);
    const row = months.get(m) ?? { month: m, committed: 0, invoiced: 0 };
    row.committed += e.amount_committed;
    row.invoiced += e.amount_invoiced;
    months.set(m, row);
  }
  let cumCommitted = 0;
  let cumInvoiced = 0;
  return [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((r) => {
    cumCommitted += r.committed;
    cumInvoiced += r.invoiced;
    return {
      month: r.month,
      committed: round2(r.committed),
      invoiced: round2(r.invoiced),
      cum_committed: round2(cumCommitted),
      cum_invoiced: round2(cumInvoiced),
      cum_committed_rate: ratio(cumCommitted, budget),
    };
  });
}

/** Vue consolidée de tous les projets pour la rubrique Project management. */
export function portfolioBudget(store, { includeCompleted = true } = {}) {
  const projects = store.all('projects')
    .filter((p) => includeCompleted || p.status !== 'completed')
    .sort(resources.projects.sort);
  const rows = projects.map((p) => {
    const b = projectBudget(store, p.id);
    return { ...p, ...b.totals, line_count: b.lines.length, unassigned_committed: b.unassigned?.committed ?? 0 };
  });
  const totals = figures(sum(rows, (r) => r.budget), sum(rows, (r) => r.committed), sum(rows, (r) => r.invoiced));
  totals.allocated = sum(rows, (r) => r.allocated);

  const ids = new Set(projects.map((p) => p.id));
  const lines = store.all('budget_lines').filter((l) => ids.has(l.project_id));
  const expenses = store.all('expenses').filter((e) => ids.has(e.project_id));
  const byCategory = groupByCategory(lines, expenses);

  return { totals, projects: rows, byCategory, monthly: monthlySeries(expenses, totals.budget) };
}

// --- Synthèse des projets --------------------------------------------------------

function projectHealth(p, today) {
  const late = p.end_date && p.end_date < today && p.status !== 'completed';
  if (p.committed > p.budget + 0.005 || late) return 'critical';
  const overdue = p.task_overdue + p.milestone_overdue;
  if (overdue > 0 || p.lines_over > 0 || p.over_allocated || (p.budget > 0 && p.committed > 0.9 * p.budget)) return 'warning';
  return 'ok';
}

export function projectSummaries(store, today, projectId = null) {
  const contributors = new Map(store.all('contributors').map((c) => [c.id, c]));
  return store.all('projects')
    .filter((p) => projectId === null || p.id === projectId)
    .sort(resources.projects.sort)
    .map((p) => {
      const tasks = store.all('tasks').filter((t) => t.project_id === p.id);
      const milestones = store.all('milestones').filter((m) => m.project_id === p.id);
      const open = tasks.filter((t) => t.status !== 'done');
      const upcoming = [
        ...open.filter((t) => t.due_date && t.due_date >= today).map((t) => t.due_date),
        ...milestones.filter((m) => !m.done && m.due_date >= today).map((m) => m.due_date),
      ].sort();
      const budget = projectBudget(store, p.id).totals;
      const summary = {
        ...p,
        task_total: tasks.length,
        task_done: tasks.length - open.length,
        task_in_progress: tasks.filter((t) => t.status === 'in_progress').length,
        task_overdue: open.filter((t) => t.due_date && t.due_date < today).length,
        milestone_total: milestones.length,
        milestone_done: milestones.filter((m) => m.done).length,
        milestone_overdue: milestones.filter((m) => !m.done && m.due_date < today).length,
        committed: budget.committed,
        invoiced: budget.invoiced,
        available: budget.available,
        to_pay: budget.to_pay,
        allocated: budget.allocated,
        over_allocated: budget.over_allocated,
        lines_over: budget.lines_over,
        labor_forecast: sum(tasks, (t) => t.estimated_hours * (contributors.get(t.assignee_id)?.daily_rate || 0) / 8),
        estimated_hours: sum(tasks, (t) => t.estimated_hours),
        contributor_count: new Set(tasks.map((t) => t.assignee_id).filter(Boolean)).size,
        next_deadline: upcoming[0] ?? null,
        progress: tasks.length ? Math.round(((tasks.length - open.length) * 100) / tasks.length) : 0,
      };
      summary.health = projectHealth(summary, today);
      return summary;
    });
}

/** Tâches non terminées et jalons non atteints, triés par date. */
export function deadlines(store, today, { projectId = null, until = null } = {}) {
  const projects = new Map(store.all('projects').map((p) => [p.id, p]));
  const contributors = new Map(store.all('contributors').map((c) => [c.id, c]));
  const items = [
    ...store.all('tasks').filter((t) => t.status !== 'done' && t.due_date).map((t) => ({
      kind: 'task', id: t.id, name: t.title, due_date: t.due_date, status: t.status, priority: t.priority,
      project_id: t.project_id, assignee_id: t.assignee_id ?? null, assignee_name: contributors.get(t.assignee_id)?.name ?? null,
    })),
    ...store.all('milestones').filter((m) => !m.done).map((m) => ({
      kind: 'milestone', id: m.id, name: m.name, due_date: m.due_date, status: 'todo', priority: null,
      project_id: m.project_id, assignee_id: null, assignee_name: null,
    })),
  ];
  return items
    .filter((d) => (projectId === null || d.project_id === projectId) && (!until || d.due_date <= until))
    .map((d) => ({ ...d, project_name: projects.get(d.project_id)?.name ?? '', overdue: d.due_date < today }))
    .sort((a, b) => (a.due_date !== b.due_date ? (a.due_date < b.due_date ? -1 : 1)
      : a.kind !== b.kind ? (a.kind === 'task' ? -1 : 1) : a.id - b.id));
}

export function workload(store, today) {
  const tasks = store.all('tasks');
  const expenses = store.all('expenses');
  return store.all('contributors').slice().sort(resources.contributors.sort).map((c) => {
    const mine = tasks.filter((t) => t.assignee_id === c.id);
    const open = mine.filter((t) => t.status !== 'done');
    return {
      ...c,
      task_total: mine.length,
      done_tasks: mine.length - open.length,
      open_tasks: open.length,
      open_hours: sum(open, (t) => t.estimated_hours),
      overdue_tasks: open.filter((t) => t.due_date && t.due_date < today).length,
      project_count: new Set(mine.map((t) => t.project_id)).size,
      expenses_total: sum(expenses.filter((e) => e.contributor_id === c.id), (e) => e.amount_committed),
    };
  });
}

export function dashboard(store, today) {
  const projects = projectSummaries(store, today);
  const open = projects.filter((p) => p.status !== 'completed');
  const team = workload(store, today);
  const total = (key) => sum(projects, (p) => p[key]);
  return {
    today,
    totals: {
      projects_total: projects.length,
      projects_active: projects.filter((p) => p.status === 'active').length,
      projects_at_risk: open.filter((p) => p.health !== 'ok').length,
      budget_total: total('budget'),
      committed_total: total('committed'),
      invoiced_total: total('invoiced'),
      tasks_total: total('task_total'),
      tasks_done: total('task_done'),
      tasks_overdue: total('task_overdue'),
      milestones_overdue: total('milestone_overdue'),
      contributors: team.length,
    },
    projects,
    deadlines: deadlines(store, today, { until: addDays(today, 30) }),
    workload: team,
  };
}
