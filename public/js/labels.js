// Libellés français des valeurs énumérées, partagés entre l'interface et le serveur (import/export Excel).
export const LABELS = {
  projectStatus: { planned: 'Planifié', active: 'En cours', on_hold: 'En pause', completed: 'Terminé' },
  taskStatus: { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' },
  priority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' },
  category: {
    personnel: 'Personnel', materiel: 'Matériel', logiciel: 'Logiciel',
    prestation: 'Prestation', deplacement: 'Déplacement', autre: 'Autre',
  },
  health: { ok: 'Dans les clous', warning: 'À surveiller', critical: 'Critique' },
};
