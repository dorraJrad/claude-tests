import { api } from '../api.js';
import {
  esc, money, num, fmtDate, relDay, today, stat, progressBar, healthBadge,
  projectStatusBadge, priorityBadge, avatar, empty, toast, LABELS,
} from '../ui.js';
import { projectForm, taskForm, milestoneForm, expenseForm, budgetLineForm } from '../forms.js';
import { budgetKpis, budgetGauge, budgetAlerts, linesTable, monthlyTable, expenseStatusBadge, pct, rateTone } from './budget.js';

const TABS = [
  ['taches', 'Tâches'],
  ['planning', 'Planning & jalons'],
  ['budget', 'Budget'],
  ['equipe', 'Équipe'],
];

export async function projectDetail({ el, params, refresh }) {
  const [id, tabParam] = params;
  const tab = TABS.some(([k]) => k === tabParam) ? tabParam : 'taches';
  const [project, budget, tasks, milestones, expenses, contributors] = await Promise.all([
    api.get(`projects/${id}/summary`),
    api.get(`projects/${id}/budget`),
    api.get('tasks', { project_id: id }),
    api.get('milestones', { project_id: id }),
    api.get('expenses', { project_id: id }),
    api.get('contributors'),
  ]);
  const lines = budget.lines;
  const ctx = { project, budget, lines, tasks, milestones, expenses, contributors, byId: new Map(contributors.map((c) => [c.id, c])) };
  const overdue = project.task_overdue + project.milestone_overdue;

  el.innerHTML = `
    <a href="#/projets" class="back small">← Projets</a>
    <header class="page-header">
      <div>
        <h1>${esc(project.name)}</h1>
        <div class="meta">${projectStatusBadge(project.status)} ${healthBadge(project.health)}
          <span class="muted">${esc(fmtDate(project.start_date))} → ${esc(fmtDate(project.end_date))}
          ${project.end_date && project.status !== 'completed' ? `(${esc(relDay(project.end_date))})` : ''}</span></div>
        ${project.description ? `<p class="muted description">${esc(project.description)}</p>` : ''}
      </div>
      <button class="btn" data-action="edit-project">Modifier</button>
    </header>

    <section class="stats">
      ${stat('Avancement', `${project.progress} %`, progressBar(project.progress, 'info', 'Avancement') + `<span>${project.task_done} / ${project.task_total} tâches terminées</span>`)}
      ${stat('Budget engagé', money(project.committed), progressBar(project.budget ? (project.committed / project.budget) * 100 : (project.committed ? 100 : 0), rateTone(project.committed, project.budget), 'Budget engagé') + `<span>${pct(budget.totals.committed_rate)} de ${money(project.budget)}</span>`)}
      ${stat('Disponible', money(project.available), `Réalisé : ${money(project.invoiced)} · reste à payer : ${money(project.to_pay)}`, project.available < 0 ? 'danger' : '')}
      ${stat('Échéances dépassées', overdue, project.next_deadline ? `Prochaine : ${esc(fmtDate(project.next_deadline))} (${esc(relDay(project.next_deadline))})` : 'Aucune échéance à venir', overdue ? 'danger' : 'success')}
    </section>

    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/projets/${id}/${k}" class="${k === tab ? 'is-active' : ''}">${l}</a>`).join('')}</nav>
    <div class="tab-panel">${RENDER[tab](ctx)}</div>`;

  const reload = () => refresh();
  const actions = {
    'edit-project': () => projectForm(project, (p) => (p ? reload() : (location.hash = '#/projets'))),
    'new-task': () => taskForm({ project_id: project.id }, ctx, reload),
    'edit-task': (t) => taskForm(tasks.find((x) => x.id === Number(t.dataset.id)), ctx, reload),
    'new-milestone': () => milestoneForm({ project_id: project.id, due_date: project.end_date }, reload),
    'edit-milestone': (t) => milestoneForm(milestones.find((x) => x.id === Number(t.dataset.id)), reload),
    'new-expense': () => expenseForm({ project_id: project.id }, ctx, reload),
    'edit-expense': (t) => expenseForm(expenses.find((x) => x.id === Number(t.dataset.id)), ctx, reload),
    'new-line': () => budgetLineForm({ project_id: project.id }, reload),
    'edit-line': (t) => budgetLineForm(lines.find((x) => x.id === Number(t.dataset.id)), reload),
  };

  el.onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (target && actions[target.dataset.action]) {
      e.preventDefault();
      actions[target.dataset.action](target);
    }
  };

  el.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.action === 'filter-assignee' || t.dataset.action === 'filter-line') {
      sessionStorage.setItem(`${t.dataset.action}-${id}`, t.value);
      return refresh();
    }
    if (t.dataset.action === 'toggle-milestone') {
      await patch('milestones', t.dataset.id, { done: t.checked }, reload);
    }
  };

  // Glisser-déposer des cartes du tableau kanban.
  el.ondragstart = (e) => {
    const card = e.target.closest?.('[data-task]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.task);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  };
  el.ondragend = (e) => e.target.closest?.('[data-task]')?.classList.remove('is-dragging');
  el.ondragover = (e) => {
    const col = e.target.closest('[data-status]');
    if (!col) return;
    e.preventDefault();
    e.currentTarget.querySelectorAll('.kanban-col.is-over').forEach((c) => c !== col && c.classList.remove('is-over'));
    col.classList.add('is-over');
  };
  el.ondragleave = (e) => {
    const col = e.target.closest('[data-status]');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
  };
  el.ondrop = async (e) => {
    const col = e.target.closest('[data-status]');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('is-over');
    const taskId = Number(e.dataTransfer.getData('text/plain'));
    const task = tasks.find((x) => x.id === taskId);
    if (task && task.status !== col.dataset.status) {
      await patch('tasks', taskId, { status: col.dataset.status }, reload);
    }
  };
}

async function patch(resource, id, body, reload) {
  try {
    await api.update(resource, id, body);
    await reload();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

// --- Onglet Tâches (kanban) ------------------------------------------------

function renderTasks({ project, tasks, contributors, byId }) {
  const filter = sessionStorage.getItem(`filter-assignee-${project.id}`) || '';
  const visible = tasks.filter((t) =>
    !filter ? true : filter === 'none' ? !t.assignee_id : String(t.assignee_id) === filter);
  const now = today();
  const columns = Object.entries(LABELS.taskStatus).map(([status, label]) => {
    const items = visible.filter((t) => t.status === status);
    return `<section class="kanban-col" data-status="${status}">
      <header><h3>${label}</h3><span class="count">${items.length}</span></header>
      <div class="kanban-items">
        ${items.map((t) => {
          const late = t.status !== 'done' && t.due_date && t.due_date < now;
          const who = byId.get(t.assignee_id);
          return `<article class="task-card${late ? ' is-overdue' : ''}" draggable="true" data-task="${t.id}" data-action="edit-task" data-id="${t.id}" tabindex="0">
            <div class="task-title">${esc(t.title)}</div>
            <div class="task-meta">
              ${priorityBadge(t.priority)}
              ${t.due_date ? `<span class="${late ? 'text-danger' : 'muted'} small">📅 ${esc(fmtDate(t.due_date, { day: 'numeric', month: 'short' }))}</span>` : ''}
              ${t.estimated_hours ? `<span class="muted small">⏱ ${num(t.estimated_hours)} h</span>` : ''}
              <span class="spacer"></span>${avatar(who?.name)}
            </div>
          </article>`;
        }).join('') || '<p class="muted small kanban-empty">Déposez une tâche ici</p>'}
      </div>
    </section>`;
  }).join('');

  return `
    <div class="toolbar">
      <label class="inline">Responsable
        <select data-action="filter-assignee">
          <option value="">Tous</option>
          <option value="none"${filter === 'none' ? ' selected' : ''}>Non assigné</option>
          ${contributors.map((c) => `<option value="${c.id}"${String(c.id) === filter ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-action="new-task">+ Nouvelle tâche</button>
    </div>
    ${tasks.length ? `<div class="kanban">${columns}</div>`
      : empty('Aucune tâche pour ce projet.', '<button class="btn btn-primary" data-action="new-task">Créer la première tâche</button>')}
    <p class="muted small hint">Astuce : glissez-déposez une carte pour changer son statut, cliquez dessus pour la modifier.</p>`;
}

// --- Onglet Planning & jalons (Gantt simplifié) ---------------------------

const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const DAY = 86400000;

function renderPlanning({ project, tasks, milestones, byId }) {
  const now = today();
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  const points = [
    project.start_date, project.end_date, now,
    ...dated.flatMap((t) => [t.start_date, t.due_date]),
    ...milestones.map((m) => m.due_date),
  ].filter(Boolean).map(toTime);
  const min = Math.min(...points);
  const max = Math.max(...points) + DAY;
  const span = Math.max(max - min, DAY);
  const pos = (iso) => ((toTime(iso) - min) / span) * 100;

  // Graduations mensuelles
  const months = [];
  const cursor = new Date(min);
  cursor.setUTCDate(1);
  while (cursor.getTime() < max) {
    const t = Math.max(cursor.getTime(), min);
    months.push({ left: ((t - min) / span) * 100, label: cursor.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const bar = (t) => {
    const start = t.start_date || t.due_date;
    const end = t.due_date || t.start_date;
    const late = t.status !== 'done' && t.due_date && t.due_date < now;
    const left = pos(start);
    const width = Math.max(((toTime(end) + DAY - toTime(start)) / span) * 100, 0.8);
    return `<div class="gantt-row">
      <div class="gantt-label" title="${esc(t.title)}">
        <a href="#" data-action="edit-task" data-id="${t.id}">${esc(t.title)}</a>
        <span class="muted small">${esc(byId.get(t.assignee_id)?.name || 'Non assigné')}</span>
      </div>
      <div class="gantt-track">
        <div class="gantt-bar status-${t.status}${late ? ' is-overdue' : ''}" style="left:${left}%;width:${width}%"
          title="${esc(t.title)} : ${esc(fmtDate(start))} → ${esc(fmtDate(end))} (${esc(LABELS.taskStatus[t.status])})"></div>
      </div>
    </div>`;
  };

  const gantt = `
    <div class="gantt">
      <div class="gantt-row gantt-scale">
        <div class="gantt-label"></div>
        <div class="gantt-track">
          ${months.map((m) => `<span class="gantt-month" style="left:${m.left}%">${esc(m.label)}</span>`).join('')}
        </div>
      </div>
      <div class="gantt-row gantt-milestones">
        <div class="gantt-label"><strong>Jalons</strong></div>
        <div class="gantt-track">
          ${milestones.map((m) => `<span class="gantt-diamond${m.done ? ' is-done' : m.due_date < now ? ' is-overdue' : ''}"
            style="left:${pos(m.due_date) + (DAY / span) * 50}%" title="${esc(m.name)} — ${esc(fmtDate(m.due_date))}"></span>`).join('')}
        </div>
      </div>
      ${dated.map(bar).join('')}
      <div class="gantt-overlay"><div class="gantt-label"></div><div class="gantt-track">
        <span class="gantt-today" style="left:${pos(now) + (DAY / span) * 50}%" title="Aujourd'hui"></span>
        ${project.end_date ? `<span class="gantt-end" style="left:${pos(project.end_date) + (DAY / span) * 100}%" title="Fin prévue du projet"></span>` : ''}
      </div></div>
    </div>
    <p class="legend small muted">
      <span class="swatch status-todo"></span>À faire <span class="swatch status-in_progress"></span>En cours
      <span class="swatch status-done"></span>Terminé <span class="swatch is-overdue"></span>En retard
      <span class="swatch today"></span>Aujourd'hui
    </p>`;

  const undated = tasks.length - dated.length;

  return `
    <div class="grid-2 grid-wide-left">
      <section class="card">
        <header class="card-header"><h2>Planning</h2>
          ${undated ? `<span class="muted small">${undated} tâche(s) sans date non affichée(s)</span>` : ''}</header>
        ${dated.length || milestones.length ? gantt : empty('Ajoutez des dates à vos tâches pour visualiser le planning.')}
      </section>
      <section class="card">
        <header class="card-header"><h2>Jalons</h2><button class="btn btn-small btn-primary" data-action="new-milestone">+ Jalon</button></header>
        ${milestones.length ? `<ul class="milestones">${milestones.map((m) => {
          const late = !m.done && m.due_date < now;
          return `<li class="${m.done ? 'is-done' : ''}${late ? ' is-overdue' : ''}">
            <input type="checkbox" class="check" data-action="toggle-milestone" data-id="${m.id}"${m.done ? ' checked' : ''}
              aria-label="Jalon « ${esc(m.name)} » atteint">
            <div class="grow">
              <a href="#" data-action="edit-milestone" data-id="${m.id}"><strong>${esc(m.name)}</strong></a>
              <div class="small ${late ? 'text-danger' : 'muted'}">${esc(fmtDate(m.due_date))}${m.done ? ' · atteint' : ` · ${esc(relDay(m.due_date))}`}</div>
            </div>
          </li>`;
        }).join('')}</ul>` : empty('Aucun jalon défini.')}
      </section>
    </div>`;
}

// --- Onglet Budget ----------------------------------------------------------

function renderBudget({ project, budget, expenses, tasks, byId }) {
  const filter = sessionStorage.getItem(`filter-line-${project.id}`) || '';
  const lineName = new Map(budget.lines.map((l) => [l.id, l.name]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const visible = expenses.filter((e) => !filter || (filter === 'none' ? !e.budget_line_id : String(e.budget_line_id) === filter));
  const sum = (key) => visible.reduce((a, e) => a + e[key], 0);

  return `
    ${budgetKpis(budget.totals)}
    <div class="grid-2 grid-wide-left">
      <section class="card">
        <header class="card-header"><h2>Consommation du budget global</h2></header>
        ${budgetGauge(budget.totals)}
      </section>
      <section class="card">
        <header class="card-header"><h2>Alertes</h2></header>
        ${budgetAlerts(budget)}
      </section>
    </div>

    <section class="card">
      <header class="card-header"><h2>Postes budgétaires</h2>
        <button class="btn btn-small btn-primary" data-action="new-line">+ Poste</button></header>
      ${budget.lines.length || budget.unassigned ? linesTable(budget)
        : empty('Aucun poste budgétaire. Découpez le budget global en postes (prestations, licences, matériel…) pour suivre chacun.',
          '<button class="btn btn-primary" data-action="new-line">Créer un poste</button>')}
    </section>

    <section class="card">
      <header class="card-header"><h2>Engagements & dépenses</h2>
        <div class="toolbar-inline">
          <select data-action="filter-line" aria-label="Filtrer par poste">
            <option value="">Tous les postes</option>
            ${budget.lines.map((l) => `<option value="${l.id}"${String(l.id) === filter ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
            <option value="none"${filter === 'none' ? ' selected' : ''}>Non affectés</option>
          </select>
          <button class="btn btn-small btn-primary" data-action="new-expense">+ Engagement</button>
        </div></header>
      <p class="muted small">Un <strong>engagement</strong> est un montant commandé ou signé (bon de commande, contrat) ;
        le <strong>réalisé</strong> est la part déjà facturée ou payée.</p>
      ${visible.length ? `<div class="table-wrap"><table class="table table-hover">
        <thead><tr><th>Date</th><th>Libellé</th><th>Poste</th><th class="num">Engagé</th><th class="num">Réalisé</th>
          <th class="num">Reste à payer</th><th>Statut</th></tr></thead>
        <tbody>${visible.map((e) => `<tr data-action="edit-expense" data-id="${e.id}">
          <td>${esc(fmtDate(e.date))}</td>
          <td>${esc(e.label)}<div class="muted small">${esc([e.supplier, e.reference, byId.get(e.contributor_id)?.name, taskById.get(e.task_id)?.title].filter(Boolean).join(' · '))}</div></td>
          <td>${e.budget_line_id ? esc(lineName.get(e.budget_line_id)) : '<span class="muted">Non affecté</span>'}</td>
          <td class="num">${money(e.amount_committed)}</td>
          <td class="num">${money(e.amount_invoiced)}</td>
          <td class="num">${money(e.amount_committed - e.amount_invoiced)}</td>
          <td>${expenseStatusBadge(e)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total${filter ? ' (filtré)' : ''}</td><td class="num">${money(sum('amount_committed'))}</td>
          <td class="num">${money(sum('amount_invoiced'))}</td><td class="num">${money(sum('amount_committed') - sum('amount_invoiced'))}</td><td></td></tr></tfoot>
      </table></div>` : empty(filter ? 'Aucun engagement pour ce filtre.' : 'Aucun engagement enregistré pour ce projet.')}
    </section>

    <section class="card">
      <header class="card-header"><h2>Évolution mensuelle</h2></header>
      ${monthlyTable(budget.monthly, budget.totals.budget)}
    </section>
    <section class="card">
        <header class="card-header"><h2>Main-d'œuvre interne (prévision)</h2></header>
        <p>Charge estimée des tâches × taux journalier ÷ 8 h : <strong>${money(project.labor_forecast)}</strong>
          pour ${num(project.estimated_hours)} h de travail.</p>
        <p class="muted small">Indicatif : ce montant n'est pas compté dans l'engagé. Pour le suivre dans le budget,
          créez un poste « Personnel interne » et enregistrez les coûts comme engagements.</p>
    </section>`;
}

// --- Onglet Équipe ----------------------------------------------------------

function renderTeam({ tasks, expenses, contributors }) {
  const now = today();
  const rows = [...contributors, { id: null, name: null }].map((c) => {
    const mine = tasks.filter((t) => (t.assignee_id ?? null) === c.id);
    const open = mine.filter((t) => t.status !== 'done');
    return {
      ...c,
      total: mine.length,
      done: mine.length - open.length,
      openHours: open.reduce((a, t) => a + t.estimated_hours, 0),
      hours: mine.reduce((a, t) => a + t.estimated_hours, 0),
      overdue: open.filter((t) => t.due_date && t.due_date < now).length,
      spent: c.id ? expenses.filter((e) => e.contributor_id === c.id).reduce((a, e) => a + e.amount_committed, 0) : 0,
    };
  }).filter((r) => r.total > 0 || r.spent > 0);

  if (!rows.length) {
    return empty("Aucun contributeur n'est encore affecté à ce projet. Assignez des tâches pour constituer l'équipe.");
  }
  return `<section class="card">
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Contributeur</th><th>Avancement</th><th class="num">Reste à faire</th><th class="num">En retard</th>
        <th class="num">Coût prévu</th><th class="num">Engagements imputés</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><div class="person">${avatar(r.name)}<div><strong>${esc(r.name || 'Non assigné')}</strong>
          <div class="muted small">${esc(r.role || '')}${r.daily_rate ? ` · ${money(r.daily_rate)}/j` : ''}</div></div></div></td>
        <td class="w-bar">${progressBar(r.total ? (r.done / r.total) * 100 : 0, 'info', 'Avancement')}<small class="muted">${r.done} / ${r.total} tâches</small></td>
        <td class="num">${num(r.openHours)} h</td>
        <td class="num">${r.overdue ? `<span class="text-danger">${r.overdue}</span>` : '0'}</td>
        <td class="num">${r.id ? money((r.hours * (r.daily_rate || 0)) / 8) : '—'}</td>
        <td class="num">${r.id ? money(r.spent) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div></section>`;
}

const RENDER = { taches: renderTasks, planning: renderPlanning, budget: renderBudget, equipe: renderTeam };
