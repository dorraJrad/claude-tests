import { api } from '../api.js';
import {
  esc, money, fmtDate, relDay, progressBar, budgetTone, healthBadge, projectStatusBadge, empty, LABELS,
} from '../ui.js';
import { projectForm } from '../forms.js';

export async function projectsList({ el, refresh }) {
  const projects = await api.get('dashboard').then((d) => d.projects);
  const filter = sessionStorage.getItem('projects-filter') || 'open';
  const visible = projects.filter((p) =>
    filter === 'all' ? true : filter === 'open' ? p.status !== 'completed' : p.status === filter);

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Projets</h1><p class="muted">${projects.length} projet(s)</p></div>
      <button class="btn btn-primary" data-action="new-project">+ Nouveau projet</button>
    </header>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Filtrer les projets">
        ${[['open', 'Non terminés'], ...Object.entries(LABELS.projectStatus), ['all', 'Tous']]
          .map(([v, l]) => `<button class="${v === filter ? 'is-active' : ''}" data-action="filter" data-value="${v}">${esc(l)}</button>`).join('')}
      </div>
    </div>
    ${visible.length ? `<div class="project-grid">${visible.map(card).join('')}</div>`
      : empty('Aucun projet ne correspond à ce filtre.', '<button class="btn btn-primary" data-action="new-project">Créer un projet</button>')}`;

  el.onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'new-project') {
      projectForm(null, (p) => { if (p) location.hash = `#/projets/${p.id}`; });
    } else if (target.dataset.action === 'filter') {
      sessionStorage.setItem('projects-filter', target.dataset.value);
      refresh();
    }
  };
}

function card(p) {
  const budgetPct = p.budget ? (p.spent / p.budget) * 100 : (p.spent ? 100 : 0);
  return `<a class="card project-card" href="#/projets/${p.id}">
    <div class="project-card-head">
      <h3>${esc(p.name)}</h3>
      ${healthBadge(p.health)}
    </div>
    <div class="muted small">${projectStatusBadge(p.status)} ${esc(fmtDate(p.start_date))} → ${esc(fmtDate(p.end_date))}</div>
    ${p.description ? `<p class="clamp">${esc(p.description)}</p>` : ''}
    <div class="metric"><span>Avancement</span><span>${p.progress} %</span></div>
    ${progressBar(p.progress, 'info', 'Avancement')}
    <div class="metric"><span>Budget</span><span>${money(p.spent)} / ${money(p.budget)}</span></div>
    ${progressBar(budgetPct, budgetTone(p.spent, p.budget), 'Budget consommé')}
    <div class="project-card-foot small">
      <span>${p.task_total} tâche(s)${p.task_overdue ? ` · <span class="text-danger">${p.task_overdue} en retard</span>` : ''}</span>
      <span>${p.next_deadline ? `Prochaine échéance ${esc(relDay(p.next_deadline))}` : 'Aucune échéance'}</span>
    </div>
  </a>`;
}
