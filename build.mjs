// Construit l'application autonome : un seul fichier HTML contenant styles et scripts,
// à ouvrir directement dans un navigateur (aucun serveur, aucune installation).
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const buildDate = new Date().toISOString().slice(0, 10);

const result = await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  write: false,
  legalComments: 'inline',
  charset: 'utf8',
});

// Une séquence « </script » ou « <!-- » dans le code fermerait la balise <script> : on la neutralise.
const js = result.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const css = (await readFile('src/styles.css', 'utf8')).replace(/<\/(style)/gi, '<\\/$1');
const html = (await readFile('src/index.html', 'utf8'))
  .replace('<!--STYLES-->', () => `<style>\n${css}</style>`)
  .replace('<!--SCRIPT-->', () => `<script>\n${js}</script>`)
  .replace('<!--VERSION-->', () => `v${pkg.version} · ${buildDate}`);

if (html.includes('<!--STYLES-->') || html.includes('<!--SCRIPT-->')) throw new Error('Gabarit HTML invalide');

await mkdir('dist', { recursive: true });
const out = 'dist/pilotage-projets.html';
await writeFile(out, html);
console.log(`${out} : ${(Buffer.byteLength(html) / 1024).toFixed(0)} Ko`);
