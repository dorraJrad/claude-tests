import { api } from '../api.js';
import { esc, fmtDate, relDay, badge, avatar, priorityBadge, toast } from '../ui.js';

/** Ligne d'échéance (tâche ou jalon) avec case à cocher pour la clôturer. */
export function deadlineRow(d, { showProject = true } = {}) {
  const kind = d.kind === 'milestone' ? badge('Jalon', 'milestone') : badge('Tâche', 'neutral');
  const when = d.overdue
    ? `<span class="text-danger">${esc(relDay(d.due_date))}</span>`
    : `<span class="muted">${esc(relDay(d.due_date))}</span>`;
  return `<li class="deadline${d.overdue ? ' is-overdue' : ''}">
    <input type="checkbox" class="check" data-action="complete-deadline" data-kind="${d.kind}" data-id="${d.id}"
      aria-label="Marquer « ${esc(d.name)} » comme terminé">
    <div class="deadline-date"><strong>${esc(fmtDate(d.due_date, { day: 'numeric', month: 'short' }))}</strong>${when}</div>
    <div class="deadline-main">
      <div>${kind} ${esc(d.name)} ${d.priority === 'high' ? priorityBadge('high') : ''}</div>
      ${showProject ? `<a class="muted small" href="#/projets/${d.project_id}">${esc(d.project_name)}</a>` : ''}
    </div>
    ${d.kind === 'task' ? avatar(d.assignee_name) : ''}
  </li>`;
}

/** Gère la case « terminé » d'une ligne d'échéance. */
export async function completeDeadline(e, refresh) {
  const box = e.target.closest('[data-action="complete-deadline"]');
  if (!box) return;
  box.disabled = true;
  try {
    if (box.dataset.kind === 'milestone') await api.update('milestones', box.dataset.id, { done: true });
    else await api.update('tasks', box.dataset.id, { status: 'done' });
    toast('Échéance marquée comme terminée', 'success');
    await refresh();
  } catch (err) {
    box.checked = false;
    box.disabled = false;
    toast(err.message, 'danger');
  }
}
