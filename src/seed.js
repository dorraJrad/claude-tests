// Remplit la base avec le jeu de données de démonstration.
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { insertDemoData } from './demo.js';

const dbFile = process.env.DB_FILE || fileURLToPath(new URL('../data/projets.db', import.meta.url));
const db = openDb(dbFile);

const existing = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`La base ${dbFile} contient déjà ${existing} projet(s). Relancez avec --force pour ajouter la démo quand même.`);
  process.exit(0);
}

db.exec('BEGIN');
try {
  insertDemoData(db);
  db.exec('COMMIT');
  console.log(`Données de démonstration ajoutées dans ${dbFile}.`);
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
} finally {
  db.close();
}
