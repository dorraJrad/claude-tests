import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nNode.js ${process.versions.node} détecté : la version 22.13 ou plus récente est nécessaire.`);
  console.error('Installez la version « LTS » depuis https://nodejs.org puis relancez.\n');
  process.exit(1);
}

// Import dynamique : la vérification de version ci-dessus doit s'exécuter avant le chargement de node:sqlite.
const { openDb } = await import('./db.js');
const { createServer } = await import('./server.js');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
// Par défaut, la base est dans le dossier data/ de l'application, quel que soit le dossier de lancement.
const dbFile = process.env.DB_FILE || fileURLToPath(new URL('../data/projets.db', import.meta.url));
const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

function openBrowser() {
  if (process.env.OPEN_BROWSER !== '1') return;
  const [cmd, args, opts] = process.platform === 'win32'
    ? ['cmd', ['/c', `start "" "${url}"`], { windowsVerbatimArguments: true }]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {}];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, ...opts }).on('error', () => {}).unref();
  } catch {
    // Pas de navigateur disponible : l'adresse est affichée dans la console.
  }
}

const db = openDb(dbFile);
const server = createServer({ db });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nLe port ${port} est déjà utilisé : l'application tourne peut-être déjà dans une autre fenêtre.`);
    console.error(`Ouvrez ${url} ou lancez-la sur un autre port (variable PORT).\n`);
    openBrowser();
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  console.log(`\nPilotage de projets est démarré : ${url}`);
  console.log(`Base de données : ${dbFile}`);
  console.log("Laissez cette fenêtre ouverte pendant l'utilisation. Pour arrêter : Ctrl+C ou fermez la fenêtre.\n");
  openBrowser();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
