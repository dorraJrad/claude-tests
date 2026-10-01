// Rubrique « Project management » : pilotage budgétaire consolidé de tous les projets.
import { api } from '../api.js';
import { esc, money, empty, projectStatusBadge, LABELS } from '../ui.js';
import { budgetKpis, budgetGauge, figuresCells, FIGURES_HEAD, monthlyTable, pct } from './budget.js';

export async function portfolio({ el, refresh }) {
  const includeCompleted = sessionStorage.getItem('portfolio-completed') !== '0';
  const data = await api.get('portfolio', { completed: includeCompleted ? '1' : '0' });
  const budgets = await Promise.all(data.projects.map((p) => api.get(`projects/${p.id}/budget`)));
  const t = data.totals;

  const alerts = [];
  for (const b of budgets) {
    const name = b.project.name;
    if (b.totals.committed > b.totals.budget + 0.005) {
      alerts.push(['danger', b.project.id, `${name} : budget global dépassé de ${money(b.totals.committed - b.totals.budget)}`]);
    }
    for (const l of b.lines.filter((x) => x.over)) {
      alerts.push(['danger', b.project.id, `${name} › ${l.name} : poste dépassé de ${money(l.committed - l.budget)}`]);
    }
    for (const l of b.lines.filter((x) => !x.over && x.budget > 0 && x.committed > 0.9 * x.budget)) {
      alerts.push(['warning', b.project.id, `${name} › ${l.name} : engagé à ${pct(l.committed_rate)}`]);
    }
    if (b.totals.over_allocated) {
      alerts.push(['warning', b.project.id, `${name} : postes supérieurs au budget global de ${money(-b.totals.unallocated)}`]);
    }
  }

  el.innerHTML = `
    <header class="page-header">
      <div><h1>Project management</h1>
        <p class="muted">Pilotage budgétaire consolidé : budget global, postes de dépense, engagé et réalisé.</p></div>
      <label class="inline small"><input type="checkbox" data-action="toggle-completed"${includeCompleted ? ' checked' : ''}> Inclure les projets terminés</label>
    </header>

    ${data.projects.length ? `
    ${budgetKpis(t, { budgetLabel: 'Budget global' })}

    <div class="grid-2 grid-wide-left">
      <section class="card">
        <header class="card-header"><h2>Consommation du budget (tous projets)</h2></header>
        ${budgetGauge(t)}
        <p class="muted small">Engagé = commandes et contrats signés · Réalisé = part facturée ou payée ·
          Disponible = budget − engagé · Reste à payer = engagé − réalisé.</p>
      </section>
      <section class="card">
        <header class="card-header"><h2>Alertes <span class="count">${alerts.length}</span></h2></header>
        ${alerts.length ? `<ul class="alerts">${alerts.map(([tone, id, msg]) =>
          `<li class="alert alert-${tone}"><a href="#/projets/${id}/budget">${esc(msg)}</a></li>`).join('')}</ul>`
          : '<p class="alert alert-success">Aucun dépassement : tous les projets et postes sont dans leur enveloppe.</p>'}
      </section>
    </div>

    <section class="card">
      <header class="card-header"><h2>Budget par projet</h2></header>
      <div class="table-wrap"><table class="table table-hover">
        <thead><tr><th>Projet</th>${FIGURES_HEAD}<th class="num">Reste à payer</th></tr></thead>
        <tbody>${data.projects.map((p) => `<tr data-href="#/projets/${p.id}/budget">
          <td><a href="#/projets/${p.id}/budget"><strong>${esc(p.name)}</strong></a>
            <div>${projectStatusBadge(p.status)} <span class="muted small">${p.line_count} poste(s)</span></div></td>
          ${figuresCells(p)}
          <td class="num">${money(p.to_pay)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${money(t.budget)}</td><td class="num">${money(t.committed)}</td>
          <td class="num">${money(t.invoiced)}</td><td class="num${t.available < 0 ? ' text-danger' : ''}">${money(t.available)}</td>
          <td>${pct(t.committed_rate)} engagé</td><td class="num">${money(t.to_pay)}</td></tr></tfoot>
      </table></div>
    </section>

    <section class="card">
        <header class="card-header"><h2>Par nature de dépense</h2></header>
        ${data.byCategory.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Nature</th>${FIGURES_HEAD}</tr></thead>
          <tbody>${data.byCategory.map((c) => `<tr>
            <td>${c.category ? esc(LABELS.category[c.category]) : '<em class="muted">Non affecté à un poste</em>'}</td>
            ${figuresCells(c)}</tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted small">Aucun poste budgétaire défini.</p>'}
    </section>
    <section class="card">
        <header class="card-header"><h2>Évolution mensuelle (tous projets)</h2></header>
        ${monthlyTable(data.monthly, t.budget)}
    </section>`
    : empty('Aucun projet à afficher.', '<a class="btn btn-primary" href="#/projets">Aller aux projets</a>')}`;

  el.onclick = (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('[data-href]');
    if (row) location.hash = row.dataset.href;
  };
  el.onchange = (e) => {
    if (e.target.dataset.action !== 'toggle-completed') return;
    sessionStorage.setItem('portfolio-completed', e.target.checked ? '1' : '0');
    refresh();
  };
}
