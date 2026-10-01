import { api } from '../api.js';
import { esc, money, num, avatar, empty } from '../ui.js';
import { contributorForm } from '../forms.js';

export async function contributors({ el, refresh }) {
  const people = await api.get('workload');

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Contributeurs</h1><p class="muted">${people.length} personne(s) dans l'annuaire</p></div>
      <button class="btn btn-primary" data-action="new">+ Nouveau contributeur</button>
    </header>
    ${people.length ? `<section class="card"><div class="table-wrap"><table class="table table-hover">
      <thead><tr><th>Contributeur</th><th>E-mail</th><th class="num">Taux journalier</th><th class="num">Projets</th>
        <th class="num">Tâches ouvertes</th><th class="num">Reste à faire</th><th class="num">En retard</th><th class="num">Terminées</th></tr></thead>
      <tbody>${people.map((c) => `<tr data-action="edit" data-id="${c.id}">
        <td><div class="person">${avatar(c.name)}<div><strong>${esc(c.name)}</strong><div class="muted small">${esc(c.role || '')}</div></div></div></td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">—</span>'}</td>
        <td class="num">${money(c.daily_rate)}</td>
        <td class="num">${c.project_count}</td>
        <td class="num">${c.open_tasks}</td>
        <td class="num">${num(c.open_hours)} h <span class="muted small">(${num(c.open_hours / 8)} j)</span></td>
        <td class="num">${c.overdue_tasks ? `<span class="text-danger">${c.overdue_tasks}</span>` : '0'}</td>
        <td class="num">${c.done_tasks}</td>
      </tr>`).join('')}</tbody></table></div></section>`
    : empty("L'annuaire est vide. Ajoutez les personnes qui contribuent à vos projets.",
      '<button class="btn btn-primary" data-action="new">Ajouter un contributeur</button>')}`;

  el.onclick = (e) => {
    if (e.target.closest('a[href^="mailto:"]')) return;
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'new') contributorForm(null, refresh);
    if (target.dataset.action === 'edit') {
      contributorForm(people.find((c) => c.id === Number(target.dataset.id)), refresh);
    }
  };
}
