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
  const budgetPct = t.budget_total ? (t.committed_total / t.budget_total) * 100 : 0;
  const overdue = t.tasks_overdue + t.milestones_overdue;
  const active = d.projects.filter((p) => p.status !== 'completed');

  if (t.projects_total === 0) {
    el.innerHTML = welcomeHtml();
    el.onclick = async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'new-project') projectForm(null, (p) => { if (p) location.hash = `#/projets/${p.id}`; });
      if (action === 'open-file') document.querySelector('[data-open]').click();
      if (action === 'demo') {
        await api.create('admin/demo', {});
        refresh();
      }
    };
    return;
  }

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Tableau de bord</h1><p class="muted">Vue d'ensemble au ${esc(fmtDate(d.today, { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
      <button class="btn btn-primary" data-action="new-project">+ Nouveau projet</button>
    </header>

    <section class="stats">
      ${stat('Projets en cours', t.projects_active, `${t.projects_total} au total · ${t.projects_at_risk} à risque`, t.projects_at_risk ? 'warning' : '')}
      ${stat('Avancement des tâches', `${t.tasks_total ? Math.round((t.tasks_done * 100) / t.tasks_total) : 0} %`, `${t.tasks_done} / ${t.tasks_total} tâches terminées`)}
      ${stat('Budget engagé', money(t.committed_total), `sur ${money(t.budget_total)} (${Math.round(budgetPct)} %) · réalisé ${money(t.invoiced_total)}`, budgetTone(t.committed_total, t.budget_total) === 'danger' ? 'danger' : '')}
      ${stat('Échéances dépassées', overdue, `${t.tasks_overdue} tâche(s) · ${t.milestones_overdue} jalon(s)`, overdue ? 'danger' : 'success')}
    </section>

    <section class="card">
      <header class="card-header"><h2>Projets</h2><a href="#/projets" class="small">Tout voir →</a></header>
      ${active.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Projet</th><th>Avancement</th><th>Budget engagé</th><th>Prochaine échéance</th><th>Santé</th></tr></thead>
        <tbody>${active.map(projectRow).join('')}</tbody></table></div>`
      : empty('Aucun projet en cours.', `<div class="actions center"><button class="btn btn-primary" data-action="new-project">Créer un projet</button>
          <a class="btn" href="#/donnees">Importer un fichier Excel</a></div>`)}
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
    <td class="w-bar">${progressBar(p.budget ? (p.committed / p.budget) * 100 : (p.committed ? 100 : 0), budgetTone(p.committed, p.budget), 'Budget engagé')}
      <small class="muted">${money(p.committed)} engagés / ${money(p.budget)}</small></td>
    <td>${p.next_deadline ? `${esc(fmtDate(p.next_deadline))}<div class="muted small">${esc(relDay(p.next_deadline))}</div>` : '<span class="muted">—</span>'}</td>
    <td>${healthBadge(p.health)}</td>
  </tr>`;
}

function welcomeHtml() {
  return `<section class="welcome card">
    <h1>Bienvenue dans Pilotage de projets</h1>
    <p class="muted">Suivez vos projets, tâches, échéances, contributeurs et budgets (postes, engagé, réalisé).
      L'application fonctionne entièrement dans ce navigateur : rien n'est installé ni envoyé sur Internet.</p>
    <div class="welcome-actions">
      <button class="welcome-choice" data-action="open-file"><strong>📂 Ouvrir un fichier de données</strong>
        <span>Reprendre un fichier .xlsx enregistré avec cette application (ou reçu d'un collègue).</span></button>
      <button class="welcome-choice" data-action="new-project"><strong>➕ Créer un premier projet</strong>
        <span>Partir de zéro. Vous pourrez aussi importer un fichier Excel depuis la rubrique Données.</span></button>
      <button class="welcome-choice" data-action="demo"><strong>👀 Découvrir avec un exemple</strong>
        <span>Charger 3 projets fictifs pour explorer l'application. Vous pourrez tout effacer ensuite.</span></button>
    </div>
    <p class="muted small">💾 Vos données sont conservées automatiquement dans ce navigateur. Pour les garder en lieu sûr
      ou les transmettre, cliquez sur <strong>Enregistrer</strong> (en bas du menu) : vous obtenez un fichier Excel.</p>
  </section>`;
}
