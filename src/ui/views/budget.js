// Éléments d'affichage budgétaires partagés (onglet Budget d'un projet et rubrique Project management).
import { esc, money, stat, badge, progressBar, LABELS } from '../ui.js';
import { expenseStatus } from '../../core/metrics.js';

export const pct = (rate) => (Number.isFinite(rate) ? `${Math.round(rate * 100)} %` : '—');

export function rateTone(committed, budget) {
  if (committed > budget + 0.005) return 'danger';
  if (budget > 0 && committed > 0.9 * budget) return 'warning';
  return 'success';
}

const STATUS_TONE = { committed: 'info', partial: 'warning', done: 'success' };
export const expenseStatusBadge = (e) => {
  const s = expenseStatus(e);
  return badge(LABELS.expenseStatus[s], STATUS_TONE[s]);
};

/** Tuiles : budget global, engagé, réalisé, disponible, reste à payer. */
export function budgetKpis(t, { budgetLabel = 'Budget global' } = {}) {
  return `<section class="stats stats-5">
    ${stat(budgetLabel, money(t.budget), t.allocated !== undefined ? `Réparti sur les postes : ${money(t.allocated)}` : '')}
    ${stat('Engagé', money(t.committed), `${pct(t.committed_rate)} du budget`, rateTone(t.committed, t.budget) === 'success' ? '' : rateTone(t.committed, t.budget))}
    ${stat('Réalisé', money(t.invoiced), `${pct(t.invoiced_rate)} du budget · facturé / payé`)}
    ${stat('Disponible', money(t.available), 'Budget − engagé', t.available < 0 ? 'danger' : 'success')}
    ${stat('Reste à payer', money(t.to_pay), 'Engagé − réalisé')}
  </section>`;
}

/** Jauge empilée : réalisé | engagé non réalisé | disponible (ou dépassement). */
export function budgetGauge(t) {
  const base = Math.max(t.budget, t.committed, 1);
  const w = (v) => `${Math.max(0, (v / base) * 100)}%`;
  const over = t.committed - t.budget;
  return `<div class="gauge" role="img" aria-label="Réalisé ${money(t.invoiced)}, engagé ${money(t.committed)}, budget ${money(t.budget)}">
      <span class="gauge-invoiced" style="width:${w(t.invoiced)}"></span>
      <span class="gauge-committed" style="width:${w(t.committed - t.invoiced)}"></span>
      ${over > 0 ? '' : `<span class="gauge-available" style="width:${w(t.available)}"></span>`}
      ${over > 0 ? `<span class="gauge-limit" style="left:${w(t.budget)}" title="Budget global"></span>` : ''}
    </div>
    <p class="legend small muted">
      <span class="swatch gauge-invoiced"></span>Réalisé ${money(t.invoiced)}
      <span class="swatch gauge-committed"></span>Engagé non réalisé ${money(t.to_pay)}
      ${over > 0
        ? `<span class="swatch is-overdue"></span><span class="text-danger">Dépassement ${money(over)}</span>`
        : `<span class="swatch gauge-available"></span>Disponible ${money(t.available)}`}
    </p>`;
}

/** Ligne de tableau « prévu / engagé / réalisé / disponible / consommation ». */
export function figuresCells(f) {
  return `<td class="num">${money(f.budget)}</td>
    <td class="num">${money(f.committed)}</td>
    <td class="num">${money(f.invoiced)}</td>
    <td class="num${f.available < 0 ? ' text-danger' : ''}">${money(f.available)}</td>
    <td class="w-bar">${progressBar(Number.isFinite(f.committed_rate) ? f.committed_rate * 100 : 100, rateTone(f.committed, f.budget), 'Taux d\'engagement')}
      <small class="muted">${pct(f.committed_rate)} engagé${f.over ? ' · <span class="text-danger">dépassement</span>' : ''}</small></td>`;
}

export const FIGURES_HEAD = `<th class="num">Prévu</th><th class="num">Engagé</th><th class="num">Réalisé</th>
  <th class="num">Disponible</th><th>Consommation</th>`;

/** Tableau des postes budgétaires d'un projet. */
export function linesTable(b, { editable = true } = {}) {
  const t = b.totals;
  return `<div class="table-wrap"><table class="table${editable ? ' table-hover' : ''}">
    <thead><tr><th>Poste</th>${FIGURES_HEAD}</tr></thead>
    <tbody>
      ${b.lines.map((l) => `<tr${editable ? ` data-action="edit-line" data-id="${l.id}"` : ''}>
        <td><strong>${esc(l.name)}</strong><div class="muted small">${esc(LABELS.category[l.category])}${l.expense_count ? ` · ${l.expense_count} engagement(s)` : ''}</div></td>
        ${figuresCells(l)}</tr>`).join('')}
      ${b.unassigned ? `<tr class="row-muted"><td><em>Engagements non affectés à un poste</em></td>
        <td class="num">—</td><td class="num">${money(b.unassigned.committed)}</td><td class="num">${money(b.unassigned.invoiced)}</td>
        <td class="num">—</td><td></td></tr>` : ''}
    </tbody>
    <tfoot>
      <tr><td>Total des postes</td><td class="num">${money(t.allocated)}</td><td class="num">${money(t.committed)}</td>
        <td class="num">${money(t.invoiced)}</td><td class="num${t.allocated - t.committed < 0 ? ' text-danger' : ''}">${money(t.allocated - t.committed)}</td><td></td></tr>
      <tr class="row-muted"><td>Budget global du projet</td><td class="num">${money(t.budget)}</td><td colspan="2"></td>
        <td class="num${t.available < 0 ? ' text-danger' : ''}">${money(t.available)}</td>
        <td class="small ${t.unallocated < 0 ? 'text-danger' : 'muted'}">${t.unallocated < 0
          ? `Postes supérieurs au budget global de ${money(-t.unallocated)}`
          : `Non réparti sur les postes : ${money(t.unallocated)}`}</td></tr>
    </tfoot>
  </table></div>`;
}

/** Alertes budgétaires d'un projet. */
export function budgetAlerts(b) {
  const t = b.totals;
  const alerts = [];
  if (t.committed > t.budget + 0.005) alerts.push(['danger', `Budget global dépassé de ${money(t.committed - t.budget)}.`]);
  for (const l of b.lines.filter((x) => x.over)) {
    alerts.push(['danger', `Poste « ${l.name} » dépassé de ${money(l.committed - l.budget)}.`]);
  }
  for (const l of b.lines.filter((x) => !x.over && x.budget > 0 && x.committed > 0.9 * x.budget)) {
    alerts.push(['warning', `Poste « ${l.name} » engagé à ${pct(l.committed_rate)}.`]);
  }
  if (t.over_allocated) alerts.push(['warning', `La somme des postes dépasse le budget global de ${money(-t.unallocated)}.`]);
  if (b.unassigned) alerts.push(['info', `${b.unassigned.expense_count} engagement(s) sans poste (${money(b.unassigned.committed)}).`]);
  return alerts.length
    ? `<ul class="alerts">${alerts.map(([tone, msg]) => `<li class="alert alert-${tone}">${esc(msg)}</li>`).join('')}</ul>`
    : '<p class="alert alert-success">Aucun dépassement : tous les postes sont dans leur enveloppe.</p>';
}

const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

/** Évolution mensuelle de l'engagé et du réalisé (cumuls). */
export function monthlyTable(monthly, budget) {
  if (!monthly.length) return '<p class="muted small">Aucun engagement pour l\'instant.</p>';
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Mois</th><th class="num">Engagé</th><th class="num">Réalisé</th>
      <th class="num">Cumul engagé</th><th class="num">Cumul réalisé</th><th>Cumul engagé / budget</th></tr></thead>
    <tbody>${monthly.map((m) => `<tr><td>${esc(monthLabel(m.month))}</td>
      <td class="num">${money(m.committed)}</td><td class="num">${money(m.invoiced)}</td>
      <td class="num">${money(m.cum_committed)}</td><td class="num">${money(m.cum_invoiced)}</td>
      <td class="w-bar">${progressBar(Number.isFinite(m.cum_committed_rate) ? m.cum_committed_rate * 100 : 100, rateTone(m.cum_committed, budget))}
        <small class="muted">${pct(m.cum_committed_rate)}</small></td></tr>`).join('')}</tbody>
  </table></div>`;
}
