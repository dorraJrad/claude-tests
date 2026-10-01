// Jeu de données de démonstration (dates relatives à aujourd'hui).
import { resources as R } from './schema.js';
import { addDays } from './metrics.js';

/** Ajoute les données de démonstration au magasin (dans une transaction). */
export function insertDemoData(store, today) {
  const day = (offset) => addDays(today, offset);
  const add = (table, row) => store.create(R[table], row).id;

  return store.transaction(() => {
    const alice = add('contributors', { name: 'Alice Martin', email: 'alice.martin@example.com', role: 'Développeuse front-end', daily_rate: 550 });
    const karim = add('contributors', { name: 'Karim Benali', email: 'karim.benali@example.com', role: 'Développeur back-end', daily_rate: 600 });
    const sophie = add('contributors', { name: 'Sophie Dubois', email: 'sophie.dubois@example.com', role: 'Designer UX/UI', daily_rate: 500 });
    const lucas = add('contributors', { name: 'Lucas Petit', email: 'lucas.petit@example.com', role: 'Testeur QA', daily_rate: 420 });

    const crm = add('projects', {
      name: 'Migration du CRM', description: 'Migration des données clients vers le nouveau CRM.',
      status: 'planned', start_date: day(30), end_date: day(120), budget: 25000,
    });
    const appli = add('projects', {
      name: 'Application mobile de fidélité', description: 'Application iOS/Android pour le programme de points clients.',
      status: 'active', start_date: day(-20), end_date: day(75), budget: 45000,
    });
    const site = add('projects', {
      name: 'Refonte du site e-commerce', description: 'Nouvelle boutique en ligne responsive avec tunnel de commande simplifié.',
      status: 'active', start_date: day(-45), end_date: day(40), budget: 60000,
    });

    const line = (project_id, name, category, amount, notes = null) => add('budget_lines', { project_id, name, category, amount, notes });
    const siteTeam = line(site, 'Équipe projet interne', 'personnel', 22000);
    const siteDev = line(site, 'Développement (prestataire)', 'prestation', 24000, 'Contrat cadre WebAgency');
    const siteSoft = line(site, 'Licences & outils', 'logiciel', 3000);
    const siteHost = line(site, 'Hébergement cloud', 'infrastructure', 6000);
    line(site, 'Provision pour risques', 'provision', 5000);
    const appTeam = line(appli, 'Équipe projet interne', 'personnel', 18000);
    const appDev = line(appli, 'Développement mobile (prestataire)', 'prestation', 20000);
    const appHw = line(appli, 'Matériel de test', 'materiel', 2500);
    const appStore = line(appli, 'Comptes stores & licences', 'logiciel', 1500);
    line(crm, 'Éditeur CRM (licences 1re année)', 'logiciel', 12000);
    line(crm, 'Reprise de données (prestataire)', 'prestation', 9000);
    line(crm, 'Formation des utilisateurs', 'formation', 4000);

    const task = (project_id, title, status, priority, assignee_id, start_date, due_date, estimated_hours) =>
      add('tasks', { project_id, title, status, priority, assignee_id, start_date, due_date, estimated_hours });
    const cadrage = task(site, 'Ateliers de cadrage', 'done', 'high', sophie, day(-45), day(-38), 16);
    const maquettes = task(site, 'Maquettes des pages clés', 'done', 'high', sophie, day(-38), day(-20), 40);
    const catalogue = task(site, 'Intégration du catalogue produits', 'in_progress', 'high', alice, day(-15), day(5), 48);
    const paiement = task(site, 'API de paiement', 'in_progress', 'high', karim, day(-10), day(-2), 32);
    task(site, 'Tunnel de commande', 'todo', 'medium', alice, day(3), day(18), 40);
    task(site, 'Campagne de tests de recette', 'todo', 'medium', lucas, day(20), day(32), 32);
    task(site, 'Mise en production', 'todo', 'high', karim, day(36), day(40), 8);
    const wireframes = task(appli, 'Parcours utilisateur et wireframes', 'done', 'medium', sophie, day(-20), day(-8), 24);
    task(appli, 'Back-end des points de fidélité', 'in_progress', 'high', karim, day(-5), day(12), 56);
    task(appli, 'Écrans de connexion', 'todo', 'medium', alice, day(2), day(9), 20);
    task(appli, 'Notifications push', 'todo', 'low', null, null, day(30), 16);

    const milestone = (project_id, name, due_date, done) => add('milestones', { project_id, name, due_date, done });
    milestone(site, 'Validation des maquettes', day(-20), true);
    milestone(site, 'Recette fonctionnelle', day(32), false);
    milestone(site, 'Mise en ligne', day(40), false);
    milestone(appli, 'Démo au comité de pilotage', day(-3), false);
    milestone(appli, 'Publication sur les stores', day(75), false);

    const spend = (project_id, budget_line_id, label, supplier, reference, date, amount_committed, amount_invoiced, extra = {}) =>
      add('expenses', { project_id, budget_line_id, label, supplier, reference, date, amount_committed, amount_invoiced, ...extra });
    spend(site, siteTeam, 'Ateliers de cadrage', null, null, day(-38), 1000, 1000, { task_id: cadrage, contributor_id: sophie });
    spend(site, siteTeam, 'Maquettes', null, null, day(-20), 2500, 2500, { task_id: maquettes, contributor_id: sophie });
    spend(site, siteTeam, 'Développement catalogue (sprint 1)', null, null, day(-5), 13200, 13200, { task_id: catalogue, contributor_id: alice });
    spend(site, siteDev, 'Bon de commande API de paiement', 'WebAgency', 'BC-2026-041', day(-12), 18000, 9000, { task_id: paiement });
    spend(site, siteDev, 'Bon de commande tunnel de commande', 'WebAgency', 'BC-2026-052', day(-2), 8500, 0);
    spend(site, siteSoft, 'Licence thème premium', 'ThemeShop', 'FA-88412', day(-30), 890, 890);
    spend(site, siteHost, 'Hébergement cloud (abonnement annuel)', 'CloudNet', 'BC-2026-038', day(-15), 5800, 1450);
    spend(appli, appTeam, 'Wireframes', null, null, day(-8), 1500, 1500, { task_id: wireframes, contributor_id: sophie });
    spend(appli, appDev, 'Développement mobile — lot 1', 'AppFactory', 'BC-2026-047', day(-6), 12000, 4000);
    spend(appli, appStore, 'Comptes développeur Apple & Google', 'Apple / Google', null, day(-18), 125, 125);
    spend(appli, appHw, 'Téléphones de test', 'Boulanger Pro', 'FA-20931', day(-12), 1340, 1340, { contributor_id: lucas });
  });
}
