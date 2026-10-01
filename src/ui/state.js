// Magasin de données de l'application et sauvegarde :
// - automatique dans le navigateur (localStorage) à chaque modification ;
// - dans un fichier Excel (.xlsx), que l'utilisateur conserve, transmet ou rouvre.
import { createStore, DATA_VERSION } from '../core/store.js';
import { exportWorkbook, importWorkbook } from '../core/datasheets.js';

const KEY = 'pilotage-projets/donnees';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const store = createStore();

/** État de la sauvegarde, affiché dans la barre latérale. */
export const saveState = {
  browserStorage: true, // false si le navigateur refuse le stockage local (navigation privée, stratégie d'entreprise)
  unsavedChanges: false, // modifications non encore enregistrées dans un fichier
  lastFileSave: null,
  fileName: null,
};

let fileHandle = null; // accès direct au fichier (Chrome / Edge), pour réenregistrer sans re-télécharger
let applyingRemote = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(saveState));
export const onSaveStateChange = (fn) => listeners.add(fn);

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    saveState.browserStorage = false;
    return null;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: DATA_VERSION,
      data: store.toJSON(),
      meta: { unsavedChanges: saveState.unsavedChanges, lastFileSave: saveState.lastFileSave, fileName: saveState.fileName },
    }));
    saveState.browserStorage = true;
  } catch {
    saveState.browserStorage = false;
  }
}

/** Charge les données conservées par le navigateur et branche la sauvegarde automatique. */
export function initPersistence() {
  const saved = readLocal();
  if (saved?.data) {
    store.load(saved.data);
    Object.assign(saveState, {
      unsavedChanges: Boolean(saved.meta?.unsavedChanges),
      lastFileSave: saved.meta?.lastFileSave ?? null,
      fileName: saved.meta?.fileName ?? null,
    });
  }
  store.subscribe(() => {
    if (applyingRemote) return;
    saveState.unsavedChanges = true;
    writeLocal();
    notify();
  });
  // Modification faite dans un autre onglet : on recharge les données.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue);
      applyingRemote = true;
      store.load(next.data);
      Object.assign(saveState, next.meta ?? {});
    } catch {
      // Contenu illisible : on garde l'état courant.
    } finally {
      applyingRemote = false;
    }
    notify();
    window.dispatchEvent(new CustomEvent('data-reloaded'));
  });
  // Avertit avant de fermer la page si des modifications ne sont pas enregistrées dans un fichier.
  window.addEventListener('beforeunload', (e) => {
    if (!saveState.unsavedChanges || store.counts().projects === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
  writeLocal();
  notify();
}

export function downloadBytes(bytes, name, type = XLSX_TYPE) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const localDate = () => new Date().toLocaleDateString('sv-SE');
const defaultName = () => `pilotage-projets-${localDate()}.xlsx`;
const pickerTypes = [{ description: 'Classeur Excel', accept: { [XLSX_TYPE]: ['.xlsx'] } }];

function markSaved(name) {
  Object.assign(saveState, { unsavedChanges: false, lastFileSave: new Date().toISOString(), fileName: name });
  writeLocal();
  notify();
}

/**
 * Enregistre toutes les données dans un fichier Excel. Avec Chrome / Edge, le fichier ouvert
 * ou enregistré précédemment est réécrit directement ; sinon le fichier est téléchargé.
 * Renvoie le nom du fichier, ou null si l'utilisateur a annulé.
 */
export async function saveToFile({ saveAs = false } = {}) {
  const bytes = exportWorkbook(store);
  if (window.showSaveFilePicker && (saveAs || !fileHandle)) {
    try {
      fileHandle = await window.showSaveFilePicker({ suggestedName: saveState.fileName || defaultName(), types: pickerTypes });
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      fileHandle = null; // API indisponible dans ce contexte : téléchargement classique
    }
  }
  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();
      markSaved(fileHandle.name);
      return fileHandle.name;
    } catch {
      fileHandle = null;
    }
  }
  const name = defaultName();
  downloadBytes(bytes, name);
  markSaved(name);
  return name;
}

/** Demande un fichier Excel à l'utilisateur. Renvoie { name, bytes, handle } ou null. */
export async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: pickerTypes, multiple: false });
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
    } catch (err) {
      if (err?.name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Ouvre un fichier de données : remplace tout le contenu actuel par celui du fichier.
 * Renvoie le rapport d'import (erreurs éventuelles : rien n'est alors modifié).
 */
export function openDataFile({ name, bytes, handle }) {
  const report = importWorkbook(store, bytes, { mode: 'replace' });
  if (report.saved) {
    fileHandle = handle ?? null;
    markSaved(name);
  }
  return report;
}
