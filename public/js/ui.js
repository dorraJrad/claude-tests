// Utilitaires d'affichage partagés par les vues.

export const LABELS = {
  projectStatus: { planned: 'Planifié', active: 'En cours', on_hold: 'En pause', completed: 'Terminé' },
  taskStatus: { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' },
  priority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' },
  category: {
    personnel: 'Personnel', materiel: 'Matériel', logiciel: 'Logiciel',
    prestation: 'Prestation', deplacement: 'Déplacement', autre: 'Autre',
  },
  health: { ok: 'Dans les clous', warning: 'À surveiller', critical: 'Critique' },
};

export const options = (labels) => Object.entries(labels);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (n) => moneyFmt.format(n || 0);

const numberFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
export const num = (n) => numberFmt.format(n || 0);

export const today = () => new Date().toLocaleDateString('sv-SE');

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', opts) : '—';
}

export function daysUntil(iso) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
}

export function relDay(iso) {
  if (!iso) return '';
  const n = daysUntil(iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `dans ${n} j` : `${-n} j de retard`;
}

export function badge(text, tone = 'neutral') {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

export const HEALTH_TONE = { ok: 'success', warning: 'warning', critical: 'danger' };
export const healthBadge = (h) => badge(LABELS.health[h], HEALTH_TONE[h]);

const STATUS_TONE = { planned: 'neutral', active: 'info', on_hold: 'warning', completed: 'success', todo: 'neutral', in_progress: 'info', done: 'success' };
export const projectStatusBadge = (s) => badge(LABELS.projectStatus[s], STATUS_TONE[s]);
export const taskStatusBadge = (s) => badge(LABELS.taskStatus[s], STATUS_TONE[s]);

const PRIORITY_TONE = { low: 'neutral', medium: 'info', high: 'danger' };
export const priorityBadge = (p) => badge(LABELS.priority[p], PRIORITY_TONE[p]);

export function progressBar(pct, tone = 'info', label = '') {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return `<div class="progress progress-${tone}" role="progressbar" aria-valuenow="${Math.round(pct || 0)}" aria-valuemin="0" aria-valuemax="100"${label ? ` aria-label="${esc(label)}"` : ''}>
    <div class="progress-fill" style="width:${clamped}%"></div></div>`;
}

export function budgetTone(spent, budget) {
  if (spent > budget) return 'danger';
  if (budget > 0 && spent > 0.9 * budget) return 'warning';
  return 'success';
}

export function stat(label, value, hint = '', tone = '') {
  return `<div class="stat ${tone ? `stat-${tone}` : ''}">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${value}</div>
    ${hint ? `<div class="stat-hint">${hint}</div>` : ''}
  </div>`;
}

export function initials(name) {
  return esc(String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
}

export function avatar(name) {
  if (!name) return '<span class="avatar avatar-empty" title="Non assigné">?</span>';
  return `<span class="avatar" title="${esc(name)}">${initials(name)}</span>`;
}

export function empty(message, actionHtml = '') {
  return `<div class="empty"><p>${esc(message)}</p>${actionHtml}</div>`;
}

export function toast(message, tone = 'info') {
  const host = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  host.append(node);
  setTimeout(() => node.remove(), 3500);
}

export function confirmAction(message) {
  return window.confirm(message);
}

// --- Formulaires en fenêtre modale ------------------------------------------

function fieldHtml(f, value) {
  const id = `f-${f.name}`;
  const req = f.required ? ' required' : '';
  const common = `id="${id}" name="${f.name}"${req}`;
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea ${common} rows="3">${esc(value)}</textarea>`;
      break;
    case 'select':
      input = `<select ${common}>
        ${f.required ? '' : `<option value="">${esc(f.placeholder ?? '—')}</option>`}
        ${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`;
      break;
    case 'checkbox':
      return `<label class="field field-check${f.full ? ' full' : ''}">
        <input type="checkbox" ${common}${value ? ' checked' : ''}> <span>${esc(f.label)}</span>
        <small class="field-error" data-error="${f.name}"></small></label>`;
    default: {
      const extra = [
        f.min !== undefined ? `min="${f.min}"` : '',
        f.step !== undefined ? `step="${f.step}"` : '',
        f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
      ].join(' ');
      input = `<input type="${f.type || 'text'}" ${common} value="${esc(value)}" ${extra}>`;
    }
  }
  return `<label class="field${f.full ? ' full' : ''}" for="${id}">
    <span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}
    <small class="field-error" data-error="${f.name}"></small></label>`;
}

/**
 * Ouvre un formulaire modal. `onSubmit(data)` peut lever une ApiError dont les
 * `details` sont affichés sous les champs correspondants.
 */
export function openForm({ title, fields, values = {}, submitLabel = 'Enregistrer', onSubmit, onDelete }) {
  const dialog = document.getElementById('modal');
  dialog.innerHTML = `
    <form class="modal-form" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">×</button></header>
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
      <p class="form-error" hidden></p>
      <footer>
        ${onDelete ? '<button type="button" class="btn btn-danger-ghost" data-delete>Supprimer</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" data-close>Annuler</button>
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  const form = dialog.querySelector('form');
  const close = () => dialog.close();
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  const showErrors = (err) => {
    form.querySelectorAll('[data-error]').forEach((n) => { n.textContent = ''; });
    const general = form.querySelector('.form-error');
    const details = err?.details || {};
    const unmatched = [];
    for (const [key, msg] of Object.entries(details)) {
      const slot = form.querySelector(`[data-error="${key}"]`);
      if (slot) slot.textContent = msg;
      else unmatched.push(`${key} : ${msg}`);
    }
    general.hidden = !err || (Object.keys(details).length > 0 && !unmatched.length);
    general.textContent = [err?.message, ...unmatched].filter(Boolean).join(' — ');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') data[f.name] = el.checked;
      else data[f.name] = el.value === '' ? null : el.value;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(data);
      close();
    } catch (err) {
      showErrors(err);
    } finally {
      btn.disabled = false;
    }
  });

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    try {
      if (await onDelete()) close();
    } catch (err) {
      showErrors(err);
    }
  });

  dialog.showModal();
  form.querySelector('input, textarea, select')?.focus();
}
