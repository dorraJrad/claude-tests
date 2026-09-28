import { api } from '../api.js';
import {
  esc, money, num, fmtDate, relDay, stat, progressBar, budgetTone, healthBadge,
  projectStatusBadge, avatar, empty,
} from '../ui.js';
import { projectForm } from '../forms.js';
import { deadlineRow, completeDeadline } from './shared.js';

export async function dashboard({ el, refresh }) {
  const d = await api.get('dashboard');
  const t = d.totals;
  const budgetPct = t.budget_total ? (t.spent_total / t.budget_total) * 100 : 0;
  const overdue = t.tasks_overdue + t.milestones_overdue;
  const active = d.projects.filter((p) => p.status !== 'completed');

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Tableau de bord</h1><p class="muted">Vue d'ensemble au ${esc(fmtDate(d.today, { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
      <button class="btn btn-primary" data-action="new-project">+ Nouveau projet</button>
    </header>

    <section class="stats">
      ${stat('Projets en cours', t.projects_active, `${t.projects_total} au total · ${t.projects_at_risk} à risque`, t.projects_at_risk ? 'warning' : '')}
      ${stat('Avancement des tâches', `${t.tasks_total ? Math.round((t.tasks_done * 100) / t.tasks_total) : 0} %`, `${t.tasks_done} / ${t.tasks_total} tâches terminées`)}
      ${stat('Budget consommé', money(t.spent_total), `sur ${money(t.budget_total)} (${Math.round(budgetPct)} %)`, budgetTone(t.spent_total, t.budget_total) === 'danger' ? 'danger' : '')}
      ${stat('Échéances dépassées', overdue, `${t.tasks_overdue} tâche(s) · ${t.milestones_overdue} jalon(s)`, overdue ? 'danger' : 'success')}
    </section>

    <section class="card">
      <header class="card-header"><h2>Projets</h2><a href="#/projets" class="small">Tout voir →</a></header>
      ${active.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Projet</th><th>Avancement</th><th>Budget</th><th>Prochaine échéance</th><th>Santé</th></tr></thead>
        <tbody>${active.map(projectRow).join('')}</tbody></table></div>`
      : empty('Aucun projet en cours.', '<button class="btn btn-primary" data-action="new-project">Créer un projet</button>')}
    </section>

    <div class="grid-2">
      <section class="card">
        <header class="card-header"><h2>Échéances à 30 jours</h2><a href="#/echeances" class="small">Tout voir →</a></header>
        ${d.deadlines.length
          ? `<ul class="deadlines">${d.deadlines.slice(0, 10).map((x) => deadlineRow(x)).join('')}</ul>`
          : empty('Aucune échéance à venir.')}
      </section>
      <section class="card">
        <header class="card-header"><h2>Charge des contributeurs</h2><a href="#/contributeurs" class="small">Gérer →</a></header>
        ${d.workload.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Contributeur</th><th class="num">Ouvertes</th><th class="num">Reste</th><th class="num">Retard</th></tr></thead>
          <tbody>${d.workload.map((c) => `<tr>
            <td><div class="person">${avatar(c.name)}<div><strong>${esc(c.name)}</strong><div class="muted small">${esc(c.role || '')}</div></div></div></td>
            <td class="num">${c.open_tasks}</td>
            <td class="num">${num(c.open_hours)} h</td>
            <td class="num">${c.overdue_tasks ? `<span class="text-danger">${c.overdue_tasks}</span>` : '0'}</td></tr>`).join('')}</tbody></table></div>`
        : empty("Aucun contributeur pour l'instant.", '<a class="btn" href="#/contributeurs">Ajouter des contributeurs</a>')}
      </section>
    </div>`;

  el.onclick = async (e) => {
    const target = e.target.closest('[data-action]');
    if (target?.dataset.action === 'new-project') {
      projectForm(null, (p) => { if (p) location.hash = `#/projets/${p.id}`; });
    }
  };
  el.onchange = (e) => completeDeadline(e, refresh);
}

function projectRow(p) {
  return `<tr>
    <td><a href="#/projets/${p.id}"><strong>${esc(p.name)}</strong></a><div>${projectStatusBadge(p.status)}</div></td>
    <td class="w-bar">${progressBar(p.progress, 'info', 'Avancement')}<small class="muted">${p.progress} % · ${p.task_done}/${p.task_total}</small></td>
    <td class="w-bar">${progressBar(p.budget ? (p.spent / p.budget) * 100 : (p.spent ? 100 : 0), budgetTone(p.spent, p.budget), 'Budget consommé')}
      <small class="muted">${money(p.spent)} / ${money(p.budget)}</small></td>
    <td>${p.next_deadline ? `${esc(fmtDate(p.next_deadline))}<div class="muted small">${esc(relDay(p.next_deadline))}</div>` : '<span class="muted">—</span>'}</td>
    <td>${healthBadge(p.health)}</td>
  </tr>`;
}
