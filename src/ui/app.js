import { dashboard } from './views/dashboard.js';
import { projectsList } from './views/projects.js';
import { projectDetail } from './views/project.js';
import { deadlines } from './views/deadlines.js';
import { contributors } from './views/contributors.js';
import { dataView } from './views/data.js';
import { portfolio } from './views/portfolio.js';
import { esc, toast, confirmAction } from './ui.js';
import { store, saveState, initPersistence, onSaveStateChange, saveToFile, pickFile, openDataFile } from './state.js';

const ROUTES = [
  [/^#?\/?$/, 'dashboard', dashboard],
  [/^#\/projets\/?$/, 'projets', projectsList],
  [/^#\/pilotage\/?$/, 'pilotage', portfolio],
  [/^#\/projets\/(\d+)(?:\/([\w-]+))?\/?$/, 'projets', projectDetail],
  [/^#\/echeances\/?$/, 'echeances', deadlines],
  [/^#\/contributeurs\/?$/, 'contributeurs', contributors],
  [/^#\/donnees\/?$/, 'donnees', dataView],
];

const HANDLERS = ['onclick', 'onchange', 'oninput', 'ondragstart', 'ondragend', 'ondragover', 'ondragleave', 'ondrop'];

const el = document.getElementById('app');
let renderId = 0;

async function render() {
  const current = ++renderId;
  const hash = location.hash || '#/';
  const match = ROUTES.map(([re, nav, view]) => [hash.match(re), nav, view]).find(([m]) => m);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === match?.[1]));
  for (const h of HANDLERS) el[h] = null;

  if (!match) {
    el.innerHTML = '<div class="empty"><h1>Page introuvable</h1><a class="btn" href="#/">Retour au tableau de bord</a></div>';
    return;
  }
  const [m, , view] = match;
  if (!el.children.length) el.innerHTML = '<p class="loading">Chargement…</p>';
  try {
    // Chaque vue reçoit une fonction `refresh` qui ré-affiche la route courante.
    const target = document.createElement('div');
    await view({ el: target, params: m.slice(1), refresh: render });
    if (current !== renderId) return;
    for (const h of HANDLERS) el[h] = target[h];
    el.replaceChildren(...target.childNodes);
  } catch (err) {
    if (current !== renderId) return;
    console.error(err);
    el.innerHTML = `<div class="empty"><h1>Impossible d'afficher la page</h1><p>${esc(err.message)}</p>
      <a class="btn" href="#/">Retour au tableau de bord</a></div>`;
  }
}

// --- Sauvegarde ------------------------------------------------------------------

const ago = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? `à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
};

function renderSaveStatus() {
  const box = document.querySelector('[data-save-status]');
  const lines = [];
  if (!saveState.browserStorage) {
    lines.push('<span class="warn">⚠ Ce navigateur ne conserve pas les données : enregistrez un fichier avant de fermer.</span>');
  }
  if (saveState.lastFileSave) {
    lines.push(`<span>Fichier : <strong>${esc(saveState.fileName ?? '')}</strong></span>`);
    lines.push(saveState.unsavedChanges
      ? '<span class="warn">● Modifications non enregistrées dans le fichier</span>'
      : `<span class="ok">✓ Enregistré ${esc(ago(saveState.lastFileSave))}</span>`);
  } else if (store.counts().projects > 0) {
    lines.push('<span class="warn">● Jamais enregistré dans un fichier</span>');
  } else {
    lines.push('<span>Aucune donnée pour l\'instant</span>');
  }
  box.innerHTML = lines.join('');
}

async function save() {
  try {
    const name = await saveToFile();
    if (name) toast(`Données enregistrées dans « ${name} »`, 'success');
  } catch (err) {
    toast(`Enregistrement impossible : ${err.message}`, 'danger');
  }
}

async function open() {
  if (saveState.unsavedChanges && store.counts().projects > 0
    && !confirmAction('Les données actuelles contiennent des modifications non enregistrées dans un fichier.\nOuvrir un autre fichier les remplacera. Continuer ?')) return;
  const file = await pickFile();
  if (!file) return;
  try {
    const report = openDataFile(file);
    if (report.saved) {
      toast(`Fichier « ${file.name} » ouvert`, 'success');
      location.hash = '#/';
      render();
    } else {
      toast(`Le fichier contient ${report.errors.length} erreur(s) : utilisez la rubrique Données pour les voir.`, 'danger');
    }
  } catch (err) {
    toast(err.message, 'danger');
  }
}

document.querySelector('[data-save]').addEventListener('click', save);
document.querySelector('[data-open]').addEventListener('click', open);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
onSaveStateChange(renderSaveStatus);
setInterval(renderSaveStatus, 60000);
window.addEventListener('data-reloaded', () => {
  toast('Données mises à jour depuis un autre onglet');
  render();
});

initPersistence();

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  // Remonter en haut de page uniquement lors d'un vrai changement d'écran.
  const samePage = lastHash.split('/').slice(0, 3).join('/') === location.hash.split('/').slice(0, 3).join('/');
  lastHash = location.hash;
  render().then(() => { if (!samePage) window.scrollTo(0, 0); });
});
render();
