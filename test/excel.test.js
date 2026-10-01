import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, AppError } from '../src/core/store.js';
import { resources as R } from '../src/core/schema.js';
import { readXlsx, writeXlsx } from '../src/core/xlsx.js';
import { exportWorkbook, importWorkbook } from '../src/core/datasheets.js';
import { insertDemoData } from '../src/core/demo.js';

// Classeur réaliste produit par un tableur (chaînes partagées, texte enrichi, vraies dates),
// au format de la version précédente (onglet « Dépenses » avec un seul montant et une catégorie).
const FIXTURE = new Uint8Array(readFileSync(new URL('./fixtures/classeur-utilisateur.xlsx', import.meta.url)));

const counts = (report) => Object.fromEntries(report.sheets.map((s) => [s.resource, [s.created, s.updated]]));
const byId = (rows) => rows.map(({ created_at, ...r }) => r).sort((a, b) => a.id - b.id);

test("l'aperçu (dryRun) analyse sans rien enregistrer", () => {
  const s = createStore();
  const report = importWorkbook(s, FIXTURE, { dryRun: true });
  assert.deepEqual(report.errors, []);
  assert.equal(report.saved, false);
  assert.deepEqual(counts(report), {
    contributors: [2, 1], // « tom leroy » en double => mise à jour
    projects: [1, 0],
    tasks: [2, 0],
    milestones: [2, 0],
    expenses: [2, 0],
  });
  assert.ok(report.warnings.some((w) => w.includes('Commentaire interne')));
  assert.ok(report.warnings.some((w) => w.includes('Catégorie')));
  assert.equal(s.counts().projects, 0);
});

test('importe un classeur produit par un tableur (chaînes partagées, dates, libellés français)', () => {
  const s = createStore();
  assert.equal(importWorkbook(s, FIXTURE).saved, true);

  const people = s.list(R.contributors);
  const tom = people.find((c) => c.name.toLowerCase() === 'tom leroy'); // la dernière ligne l'emporte
  assert.equal(people.length, 2);
  assert.equal(tom.daily_rate, 480.5); // cellule vide de la 2e ligne : valeur conservée
  assert.equal(tom.role, 'Développeur senior');

  const [project] = s.list(R.projects);
  assert.equal(project.name, 'Portail RH'); // texte enrichi reconstitué
  assert.equal(project.status, 'active');
  assert.equal(project.start_date, '2026-09-01');
  assert.equal(project.end_date, '2026-12-15');
  assert.equal(project.budget, 30000);

  const tasks = s.list(R.tasks, { project_id: project.id });
  const spec = tasks.find((t) => t.title === 'Spécifications');
  assert.deepEqual([spec.status, spec.priority, spec.due_date], ['done', 'high', '2026-09-15']);
  assert.equal(spec.assignee_id, people.find((c) => c.name === 'Nadia Haddad').id);
  const dev = tasks.find((t) => t.title === 'Développement');
  assert.deepEqual([dev.status, dev.due_date, dev.estimated_hours], ['in_progress', '2026-11-30', 80]);

  assert.deepEqual(s.list(R.milestones).map((m) => [m.name, m.done]), [['Kick-off', 1], ['Recette', 0]]);

  // Ancien format : « Montant » = engagé ; sans colonne « réalisé », la dépense est considérée comme payée.
  const licences = s.list(R.expenses).find((e) => e.label === 'Licences');
  assert.deepEqual([licences.amount_committed, licences.amount_invoiced, licences.budget_line_id], [1200.5, 1200.5, null]);
  assert.equal(s.list(R.expenses).find((e) => e.label === 'Spécifications').task_id, spec.id);

  // Ré-importer le même fichier met à jour sans créer de doublons.
  const again = importWorkbook(s, FIXTURE);
  assert.deepEqual(counts(again), {
    contributors: [0, 3], projects: [0, 1], tasks: [0, 2], milestones: [0, 2], expenses: [0, 2],
  });
  assert.equal(s.counts().expenses, 2);
});

test('postes budgétaires et engagements liés par leur nom', () => {
  const s = createStore();
  const file = writeXlsx([
    { name: 'Projets', columns: [{ header: 'Nom' }, { header: 'Budget global (€)' }], rows: [['Alpha', 10000]] },
    {
      name: 'Postes budgétaires',
      columns: [{ header: 'Projet' }, { header: 'Poste' }, { header: 'Nature' }, { header: 'Budget prévu (€)' }],
      rows: [['Alpha', 'Prestataires', 'Prestations externes', 6000], ['Alpha', 'Licences', 'logiciel', '1 500']],
    },
    {
      name: 'Engagements',
      columns: [{ header: 'Projet' }, { header: 'Poste' }, { header: 'Libellé' }, { header: 'Date' },
        { header: 'Montant engagé (€)' }, { header: 'Montant réalisé (€)' }],
      rows: [
        ['Alpha', 'prestataires', 'Commande lot 1', '05/03/2026', 4000, 1000],
        ['Alpha', null, 'Divers', '2026-03-06', 50, null],
      ],
    },
  ]);
  const report = importWorkbook(s, file);
  assert.deepEqual(report.errors, []);
  const lines = s.list(R.budget_lines);
  assert.deepEqual(lines.map((l) => [l.name, l.category, l.amount]), [['Prestataires', 'prestation', 6000], ['Licences', 'logiciel', 1500]]);
  const [divers, lot1] = s.list(R.expenses);
  assert.deepEqual([lot1.budget_line_id, lot1.date, lot1.amount_committed, lot1.amount_invoiced], [lines[0].id, '2026-03-05', 4000, 1000]);
  assert.deepEqual([divers.budget_line_id, divers.amount_invoiced], [null, 0]); // colonne présente mais vide : 0

  const bad = writeXlsx([{
    name: 'Engagements',
    columns: [{ header: 'Projet' }, { header: 'Poste' }, { header: 'Libellé' }, { header: 'Date' }, { header: 'Montant engagé' }, { header: 'Montant réalisé' }],
    rows: [['Alpha', 'Inconnu', 'X', '2026-03-01', 10, 0], ['Alpha', 'Licences', 'Y', '2026-03-01', 10, 20]],
  }]);
  const r2 = importWorkbook(s, bad);
  assert.equal(r2.saved, false);
  assert.deepEqual(r2.errors.map((e) => [e.row, e.column]), [[2, 'Poste'], [3, 'Montant réalisé (€)']]);
  assert.match(r2.errors[0].message, /Poste « Inconnu » introuvable/);
});

test("n'enregistre rien et localise les erreurs quand le fichier est invalide", () => {
  const s = createStore();
  const file = writeXlsx([
    { name: 'Projets', columns: [{ header: 'Nom' }, { header: 'Statut' }], rows: [['Alpha', 'En cours']] },
    {
      name: 'Tâches',
      columns: [{ header: 'Projet' }, { header: 'Titre' }, { header: 'Statut' }, { header: 'Échéance' }],
      rows: [
        ['Alpha', 'OK', 'À faire', '2026-10-10'],
        ['Inconnu', 'Orpheline', 'À faire', null],
        ['Alpha', 'Statut bizarre', 'Peut-être', null],
        ['Alpha', 'Date fausse', 'À faire', '31/02/2026'],
      ],
    },
  ]);
  const report = importWorkbook(s, file);
  assert.equal(report.saved, false);
  assert.deepEqual(report.errors.map((e) => [e.sheet, e.row, e.column]), [
    ['Tâches', 3, 'Projet'], ['Tâches', 4, 'Statut'], ['Tâches', 5, 'Échéance'],
  ]);
  assert.match(report.errors[0].message, /Inconnu.*introuvable/);
  assert.equal(s.counts().projects, 0);

  const missing = writeXlsx([{ name: 'Tâches', columns: [{ header: 'Titre' }], rows: [['Sans projet']] }]);
  assert.match(importWorkbook(s, missing).errors[0].message, /Colonne\(s\) obligatoire\(s\) manquante\(s\) : Projet/);
});

test("refuse un fichier qui n'est pas un classeur Excel", () => {
  const s = createStore();
  assert.throws(() => importWorkbook(s, new TextEncoder().encode('nom;budget\nA;1')), AppError);
  assert.throws(() => importWorkbook(s, writeXlsx([{ name: 'Feuil1', columns: [{ header: 'A' }], rows: [] }])), /Aucun onglet reconnu/);
  assert.throws(() => importWorkbook(s, FIXTURE, { mode: 'autre' }), AppError);
});

test("export complet puis restauration à l'identique (mode remplacement)", () => {
  const s = createStore();
  insertDemoData(s, '2026-10-01');
  const before = Object.fromEntries(Object.keys(s.counts()).map((t) => [t, byId(s.all(t))]));

  const exported = exportWorkbook(s);
  assert.deepEqual(readXlsx(exported).sheets.map((x) => x.name),
    ['Contributeurs', 'Projets', 'Postes budgétaires', 'Tâches', 'Jalons', 'Engagements', "Mode d'emploi"]);

  s.create(R.projects, { name: 'Projet ajouté après export' });
  const report = importWorkbook(s, exported, { mode: 'replace' });
  assert.deepEqual(report.errors, []);
  for (const t of Object.keys(before)) assert.deepEqual(byId(s.all(t)), before[t], t);
});

test('modèle vierge', () => {
  const template = readXlsx(exportWorkbook(createStore(), { template: true }));
  const sheet = template.sheets.find((x) => x.name === 'Engagements');
  assert.equal(sheet.rows.length, 1);
  assert.ok(sheet.rows[0].includes('Montant engagé (€)'));
  assert.ok(template.sheets.some((x) => x.name === "Mode d'emploi"));
});
