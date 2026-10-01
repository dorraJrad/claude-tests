import { api } from '../api.js';
import { esc, daysUntil, empty } from '../ui.js';
import { deadlineRow, completeDeadline } from './shared.js';

const GROUPS = [
  ['En retard', (n) => n < 0],
  ["Aujourd'hui", (n) => n === 0],
  ['7 prochains jours', (n) => n > 0 && n <= 7],
  ['30 prochains jours', (n) => n > 7 && n <= 30],
  ['Plus tard', (n) => n > 30],
];

export async function deadlines({ el, refresh }) {
  const projectId = sessionStorage.getItem('deadlines-project') || '';
  const kind = sessionStorage.getItem('deadlines-kind') || '';
  const [items, projects] = await Promise.all([
    api.get('deadlines', { project_id: projectId }),
    api.get('projects'),
  ]);
  const visible = items.filter((d) => !kind || d.kind === kind);

  const groups = GROUPS.map(([label, test]) => [label, visible.filter((d) => test(daysUntil(d.due_date)))])
    .filter(([, list]) => list.length);

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Échéances</h1><p class="muted">Tâches non terminées et jalons non atteints, tous projets confondus.</p></div>
    </header>
    <div class="toolbar">
      <label class="inline">Projet
        <select data-filter="deadlines-project">
          <option value="">Tous les projets</option>
          ${projects.map((p) => `<option value="${p.id}"${String(p.id) === projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="inline">Type
        <select data-filter="deadlines-kind">
          <option value="">Tâches et jalons</option>
          <option value="task"${kind === 'task' ? ' selected' : ''}>Tâches</option>
          <option value="milestone"${kind === 'milestone' ? ' selected' : ''}>Jalons</option>
        </select>
      </label>
    </div>
    ${groups.length ? groups.map(([label, list]) => `
      <section class="card">
        <header class="card-header"><h2>${esc(label)} <span class="count">${list.length}</span></h2></header>
        <ul class="deadlines">${list.map((d) => deadlineRow(d, { showProject: !projectId })).join('')}</ul>
      </section>`).join('')
    : empty('Aucune échéance en attente. 🎉')}`;

  el.onchange = (e) => {
    const filter = e.target.dataset.filter;
    if (filter) {
      sessionStorage.setItem(filter, e.target.value);
      return refresh();
    }
    return completeDeadline(e, refresh);
  };
}
