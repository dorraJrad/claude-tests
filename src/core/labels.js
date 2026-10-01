// Libellés français des valeurs énumérées (interface et import/export Excel).
export const LABELS = {
  projectStatus: { planned: 'Planifié', active: 'En cours', on_hold: 'En pause', completed: 'Terminé' },
  taskStatus: { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' },
  priority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' },
  category: {
    personnel: 'Personnel interne', prestation: 'Prestations externes', logiciel: 'Logiciels & licences',
    materiel: 'Matériel', infrastructure: 'Infrastructure & hébergement', deplacement: 'Déplacements',
    formation: 'Formation', provision: 'Provision pour risques', autre: 'Autre',
  },
  expenseStatus: { committed: 'Engagé', partial: 'Partiellement réalisé', done: 'Soldé' },
  health: { ok: 'Dans les clous', warning: 'À surveiller', critical: 'Critique' },
};
