import { openDb } from './db.js';
import { createServer } from './server.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const dbFile = process.env.DB_FILE || 'data/projets.db';

const db = openDb(dbFile);
const server = createServer({ db });

server.listen(port, host, () => {
  console.log(`Pilotage de projets disponible sur http://${host}:${port} (base : ${dbFile})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
