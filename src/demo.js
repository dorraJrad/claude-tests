// Jeu de données de démonstration (dates relatives à aujourd'hui).
import { localToday } from './db.js';

/** Insère les données de démonstration. À appeler dans une transaction. */
export function insertDemoData(db) {
  const base = new Date(`${localToday()}T00:00:00Z`);
  const day = (offset) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const insert = (table, row) => {
    const cols = Object.keys(row);
    return db
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`)
      .get(...cols.map((c) => row[c])).id;
  };

  const alice = insert('contributors', { name: 'Alice Martin', email: 'alice.martin@example.com', role: 'Développeuse front-end', daily_rate: 550 });
  const karim = insert('contributors', { name: 'Karim Benali', email: 'karim.benali@example.com', role: 'Développeur back-end', daily_rate: 600 });
  const sophie = insert('contributors', { name: 'Sophie Dubois', email: 'sophie.dubois@example.com', role: 'Designer UX/UI', daily_rate: 500 });
  const lucas = insert('contributors', { name: 'Lucas Petit', email: 'lucas.petit@example.com', role: 'Testeur QA', daily_rate: 420 });

  const site = insert('projects', {
    name: 'Refonte du site e-commerce',
    description: 'Nouvelle boutique en ligne responsive avec tunnel de commande simplifié.',
    status: 'active', start_date: day(-45), end_date: day(40), budget: 60000,
  });
  const appli = insert('projects', {
    name: 'Application mobile de fidélité',
    description: 'Application iOS/Android pour le programme de points clients.',
    status: 'active', start_date: day(-20), end_date: day(75), budget: 45000,
  });
  insert('projects', {
    name: 'Migration du CRM',
    description: 'Migration des données clients vers le nouveau CRM.',
    status: 'planned', start_date: day(30), end_date: day(120), budget: 25000,
  });

  const tasks = [
    [site, 'Ateliers de cadrage', 'done', 'high', sophie, day(-45), day(-38), 16],
    [site, 'Maquettes des pages clés', 'done', 'high', sophie, day(-38), day(-20), 40],
    [site, 'Intégration du catalogue produits', 'in_progress', 'high', alice, day(-15), day(5), 48],
    [site, 'API de paiement', 'in_progress', 'high', karim, day(-10), day(-2), 32],
    [site, 'Tunnel de commande', 'todo', 'medium', alice, day(3), day(18), 40],
    [site, 'Campagne de tests de recette', 'todo', 'medium', lucas, day(20), day(32), 32],
    [site, 'Mise en production', 'todo', 'high', karim, day(36), day(40), 8],
    [appli, 'Parcours utilisateur et wireframes', 'done', 'medium', sophie, day(-20), day(-8), 24],
    [appli, 'Back-end des points de fidélité', 'in_progress', 'high', karim, day(-5), day(12), 56],
    [appli, 'Écrans de connexion', 'todo', 'medium', alice, day(2), day(9), 20],
    [appli, 'Notifications push', 'todo', 'low', null, null, day(30), 16],
  ];
  const taskIds = tasks.map(([project_id, title, status, priority, assignee_id, start_date, due_date, estimated_hours]) =>
    insert('tasks', { project_id, title, status, priority, assignee_id, start_date, due_date, estimated_hours }));

  insert('milestones', { project_id: site, name: 'Validation des maquettes', due_date: day(-20), done: 1 });
  insert('milestones', { project_id: site, name: 'Recette fonctionnelle', due_date: day(32), done: 0 });
  insert('milestones', { project_id: site, name: 'Mise en ligne', due_date: day(40), done: 0 });
  insert('milestones', { project_id: appli, name: 'Démo au comité de pilotage', due_date: day(-3), done: 0 });
  insert('milestones', { project_id: appli, name: 'Publication sur les stores', due_date: day(75), done: 0 });

  const expenses = [
    [site, 'Ateliers de cadrage', 'personnel', 1000, day(-38), taskIds[0], sophie],
    [site, 'Maquettes', 'personnel', 2500, day(-20), taskIds[1], sophie],
    [site, 'Licence thème premium', 'logiciel', 890, day(-30), null, null],
    [site, 'Hébergement cloud (trimestre)', 'prestation', 1450, day(-15), null, null],
    [site, 'Développement catalogue (sprint 1)', 'personnel', 13200, day(-5), taskIds[2], alice],
    [site, 'Développement API paiement', 'personnel', 18000, day(-3), taskIds[3], karim],
    [appli, 'Wireframes', 'personnel', 1500, day(-8), taskIds[7], sophie],
    [appli, 'Compte développeur Apple & Google', 'logiciel', 125, day(-18), null, null],
    [appli, 'Téléphones de test', 'materiel', 1340, day(-12), null, lucas],
  ];
  for (const [project_id, label, category, amount, date, task_id, contributor_id] of expenses) {
    insert('expenses', { project_id, label, category, amount, date, task_id, contributor_id });
  }
}
