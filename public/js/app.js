import { dashboard } from './views/dashboard.js';
import { projectsList } from './views/projects.js';
import { projectDetail } from './views/project.js';
import { deadlines } from './views/deadlines.js';
import { contributors } from './views/contributors.js';
import { dataView } from './views/data.js';
import { esc } from './ui.js';

const ROUTES = [
  [/^#?\/?$/, 'dashboard', dashboard],
  [/^#\/projets\/?$/, 'projets', projectsList],
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

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  // Remonter en haut de page uniquement lors d'un vrai changement d'écran.
  const samePage = lastHash.split('/').slice(0, 3).join('/') === location.hash.split('/').slice(0, 3).join('/');
  lastHash = location.hash;
  render().then(() => { if (!samePage) window.scrollTo(0, 0); });
});
render();
