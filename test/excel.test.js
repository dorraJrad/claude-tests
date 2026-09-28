import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import { readXlsx, writeXlsx } from '../src/xlsx.js';

const FIXTURE = readFileSync(new URL('./fixtures/classeur-utilisateur.xlsx', import.meta.url));
let server;
let base;

beforeEach(async () => {
  server = createServer({ db: openDb(':memory:'), now: () => '2026-10-01' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const get = (path) => fetch(`${base}${path}`).then((r) => r.json());
const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

async function upload(buffer, params = '') {
  const res = await fetch(`${base}/api/import${params}`, { method: 'POST', body: buffer });
  return { status: res.status, body: await res.json() };
}

const counts = (report) => Object.fromEntries(report.sheets.map((s) => [s.resource, [s.created, s.updated]]));

test("l'aperçu (dryRun) analyse sans rien enregistrer", async () => {
  const { status, body } = await upload(FIXTURE, '?dryRun=1');
  assert.equal(status, 200);
  assert.deepEqual(body.errors, []);
  assert.equal(body.saved, false);
  assert.deepEqual(counts(body), {
    contributors: [2, 1], // « tom leroy » en double => mise à jour
    projects: [1, 0],
    tasks: [2, 0],
    milestones: [2, 0],
    expenses: [2, 0],
  });
  assert.ok(body.warnings.some((w) => w.includes('Commentaire interne')));
  assert.deepEqual(await get('/api/projects'), []);
});

test('importe un classeur produit par un tableur (chaînes partagées, dates, libellés français)', async () => {
  const { body } = await upload(FIXTURE);
  assert.equal(body.saved, true);

  const people = await get('/api/contributors');
  const tom = people.find((c) => c.name.toLowerCase() === 'tom leroy'); // la dernière ligne l'emporte
  assert.equal(people.length, 2);
  assert.equal(tom.daily_rate, 480.5);
  assert.equal(tom.role, 'Développeur senior');

  const [project] = await get('/api/projects');
  assert.equal(project.name, 'Portail RH'); // texte enrichi reconstitué
  assert.equal(project.status, 'active');
  assert.equal(project.start_date, '2026-09-01');
  assert.equal(project.end_date, '2026-12-15');
  assert.equal(project.budget, 30000);

  const tasks = await get(`/api/tasks?project_id=${project.id}`);
  const spec = tasks.find((t) => t.title === 'Spécifications');
  assert.equal(spec.status, 'done');
  assert.equal(spec.priority, 'high');
  assert.equal(spec.due_date, '2026-09-15');
  assert.equal(spec.assignee_id, people.find((c) => c.name === 'Nadia Haddad').id);
  const dev = tasks.find((t) => t.title === 'Développement');
  assert.equal(dev.status, 'in_progress');
  assert.equal(dev.due_date, '2026-11-30');
  assert.equal(dev.estimated_hours, 80);

  const milestones = await get('/api/milestones');
  assert.deepEqual(milestones.map((m) => [m.name, m.done]), [['Kick-off', 1], ['Recette', 0]]);

  const expenses = await get('/api/expenses');
  assert.equal(expenses.find((e) => e.label === 'Spécifications').task_id, spec.id);
  assert.equal(expenses.find((e) => e.label === 'Licences').category, 'logiciel');

  // Ré-importer le même fichier met à jour sans créer de doublons.
  const again = await upload(FIXTURE);
  assert.deepEqual(counts(again.body), {
    contributors: [0, 3], projects: [0, 1], tasks: [0, 2], milestones: [0, 2], expenses: [0, 2],
  });
  assert.equal((await get('/api/expenses')).length, 2);
});

test("n'enregistre rien et localise les erreurs quand le fichier est invalide", async () => {
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
  const { body } = await upload(file);
  assert.equal(body.saved, false);
  assert.deepEqual(body.errors.map((e) => [e.sheet, e.row, e.column]), [
    ['Tâches', 3, 'Projet'],
    ['Tâches', 4, 'Statut'],
    ['Tâches', 5, 'Échéance'],
  ]);
  assert.match(body.errors[0].message, /Inconnu.*introuvable/);
  assert.deepEqual(await get('/api/projects'), []);

  const missing = writeXlsx([{ name: 'Tâches', columns: [{ header: 'Titre' }], rows: [['Sans projet']] }]);
  const res = await upload(missing);
  assert.match(res.body.errors[0].message, /Colonne\(s\) obligatoire\(s\) manquante\(s\) : Projet/);
});

test('refuse un fichier qui n\'est pas un classeur Excel', async () => {
  const bad = await upload(Buffer.from('nom;budget\nA;1'));
  assert.equal(bad.status, 400);
  const noSheet = await upload(writeXlsx([{ name: 'Feuil1', columns: [{ header: 'A' }], rows: [] }]));
  assert.equal(noSheet.status, 400);
  assert.match(noSheet.body.error, /Aucun onglet reconnu/);
  assert.equal((await upload(FIXTURE, '?mode=autre')).status, 400);
});

test("export complet puis restauration à l'identique (mode remplacement)", async () => {
  await post('/api/admin/demo', {});
  const snapshot = async () => Object.fromEntries(await Promise.all(
    ['projects', 'contributors', 'tasks', 'milestones', 'expenses'].map(async (r) =>
      [r, (await get(`/api/${r}`)).map(({ created_at, ...rest }) => rest)])));
  const before = await snapshot();

  const exported = Buffer.from(await (await fetch(`${base}/api/export`)).arrayBuffer());
  const book = readXlsx(exported);
  assert.deepEqual(book.sheets.map((s) => s.name), ['Contributeurs', 'Projets', 'Tâches', 'Jalons', 'Dépenses', "Mode d'emploi"]);

  // On modifie la base, puis on restaure le fichier exporté.
  await post('/api/projects', { name: 'Projet ajouté après export' });
  const { body } = await upload(exported, '?mode=replace');
  assert.deepEqual(body.errors, []);
  assert.deepEqual(await snapshot(), before);
});

test('modèle vierge et gestion de la base', async () => {
  const template = readXlsx(Buffer.from(await (await fetch(`${base}/api/export?template=1`)).arrayBuffer()));
  const tasks = template.sheets.find((s) => s.name === 'Tâches');
  assert.equal(tasks.rows.length, 1);
  assert.ok(tasks.rows[0].includes('Responsable'));

  await post('/api/admin/demo', {});
  const stats = await get('/api/admin/stats');
  assert.ok(stats.projects > 0 && stats.tasks > 0);

  assert.equal((await post('/api/admin/reset', {})).status, 400);
  assert.equal((await post('/api/admin/reset', { confirm: 'SUPPRIMER' })).status, 200);
  assert.deepEqual(Object.values(await get('/api/admin/stats')), [0, 0, 0, 0, 0]);

  const schema = await get('/api/schema');
  assert.equal(schema.tasks.fields.find((f) => f.name === 'assignee_id').ref, 'contributors');
});
