# Pilotage de projets

Application de pilotage de projets **autonome** : un seul fichier HTML qui s'ouvre dans le navigateur.
Suivi des **tâches**, des **échéances**, des **contributeurs** et des **budgets** (budget global, postes de dépense,
engagé, réalisé).

- **Aucune installation, aucun serveur, aucune connexion Internet** : idéal pour un poste verrouillé.
- Le fichier se transmet par e-mail, clé USB, Teams, SharePoint…
- Interface en français, responsive, thème clair / sombre automatique.

## Utilisation

1. Récupérez le fichier **`dist/pilotage-projets.html`** (environ 190 Ko).
2. Enregistrez-le sur le poste (par exemple dans *Documents*), puis **double-cliquez dessus** :
   il s'ouvre dans le navigateur par défaut (Edge, Chrome ou Firefox récents).
3. Au premier lancement, choisissez : ouvrir un fichier de données, créer un projet, ou découvrir l'exemple.

### Où sont les données ?

- **Automatiquement dans le navigateur** du poste, à chaque modification. En rouvrant le fichier HTML sur le même
  poste et avec le même navigateur, on retrouve ses données.
- **Dans un fichier Excel** quand vous cliquez sur **Enregistrer** (en bas du menu, ou `Ctrl+S`).
  C'est votre sauvegarde : rouvrez-la avec **Ouvrir…**, transmettez-la à un collègue (qui l'ouvre avec sa propre
  copie de l'application), ou consultez-la directement dans Excel.
  - Avec Edge / Chrome, l'application peut réécrire directement le même fichier à chaque enregistrement ;
    sinon le fichier est téléchargé (dossier *Téléchargements*).
  - Le menu indique si des modifications n'ont pas encore été enregistrées dans un fichier, et le navigateur
    vous prévient si vous fermez la page dans ce cas.

> ⚠️ Certains postes d'entreprise effacent les données des navigateurs à la fermeture : **enregistrez régulièrement
> le fichier Excel**, c'est la seule sauvegarde qui vous appartient.

### Envoi par e-mail

Joignez simplement `pilotage-projets.html`. Certaines passerelles de messagerie bloquent les pièces jointes `.html` ;
dans ce cas, compressez-le en `.zip` ou déposez-le sur Teams / SharePoint / OneDrive.
Le destinataire doit **enregistrer** la pièce jointe puis l'ouvrir (et non l'ouvrir depuis l'aperçu de la messagerie).

## Fonctionnalités

**Tableau de bord** : projets en cours, avancement, budget engagé, échéances dépassées, santé de chaque projet,
échéances des 30 prochains jours (à cocher directement), charge des contributeurs.

**Projets**, avec quatre onglets :
- **Tâches** : tableau kanban *À faire / En cours / Terminé* avec glisser-déposer, priorité, responsable, charge, dates.
- **Planning & jalons** : diagramme de Gantt, jalons, ligne « aujourd'hui ».
- **Budget** : budget global, **postes de dépense** (prévu / engagé / réalisé / disponible / consommation),
  **engagements & dépenses** (fournisseur, référence de commande ou facture, montant engagé, montant réalisé, statut),
  alertes de dépassement, évolution mensuelle, prévision de main-d'œuvre interne.
- **Équipe** : avancement, reste à faire, retards et coûts par contributeur.

**Project management** : pilotage budgétaire consolidé de tous les projets : budget global, engagé, réalisé,
disponible, reste à payer, budget par projet, **par nature de dépense**, évolution mensuelle et alertes
(postes et projets en dépassement ou engagés à plus de 90 %).

**Échéances** : toutes les tâches et jalons ouverts, regroupés par urgence, filtrables.

**Contributeurs** : annuaire (rôle, e-mail, taux journalier) et charge de travail.

**Données** : import d'un classeur Excel (analyse préalable, erreurs localisées, mode *Fusionner* ou *Remplacer*),
export, modèle vierge, éditeur de tables façon tableur, données de démonstration, remise à zéro.

### Gestion budgétaire : définitions

| Notion | Définition |
|--------|-----------|
| **Budget global** | Enveloppe totale du projet. |
| **Poste budgétaire** | Découpage du budget (ex. *Prestations externes*, *Licences*, *Matériel*) avec un montant prévu et une nature. |
| **Engagé** | Montant commandé ou signé (bon de commande, contrat), qu'il soit facturé ou non. |
| **Réalisé** | Part de l'engagé déjà facturée ou payée (toujours ≤ engagé). |
| **Disponible** | Prévu − engagé (négatif = dépassement). |
| **Reste à payer** | Engagé − réalisé. |
| **Non réparti** | Budget global − somme des postes. |

Statut d'un engagement : *Engagé* (rien de réalisé), *Partiellement réalisé*, *Soldé*.
Santé d'un projet : *Critique* si l'engagé dépasse le budget global ou si la date de fin est passée ;
*À surveiller* en cas d'échéance dépassée, de poste en dépassement, de postes supérieurs au budget global
ou d'engagé > 90 % du budget.

### Format du fichier Excel

Un onglet par table : *Contributeurs, Projets, Postes budgétaires, Tâches, Jalons, Engagements*, plus un onglet
*Mode d'emploi* qui décrit chaque colonne. Les liens se font par le nom (colonne « Projet » = nom du projet,
« Poste » = nom d'un poste de ce projet, « Responsable » = nom d'un contributeur). Les libellés français
(« En cours », « Haute », « Oui »…) et les dates Excel ou JJ/MM/AAAA sont acceptés.
Les fichiers exportés par la version précédente (onglet *Dépenses*) s'importent aussi : leur montant devient
l'engagé, considéré comme entièrement réalisé.

## Développement

Le code source est dans `src/` ; le fichier distribué est **généré** :

```bash
npm install      # outil de construction (esbuild), uniquement pour les développeurs
npm run build    # produit dist/pilotage-projets.html
npm test         # tests du cœur (données, calculs budgétaires, import/export Excel)
```

```
src/core/   logique sans interface, testée sous Node : schéma et validation, base en mémoire
            (store.js), indicateurs et budget (metrics.js), Excel (xlsx.js, zip.js, datasheets.js)
src/ui/     interface : vues, formulaires, sauvegarde navigateur / fichier (state.js)
src/index.html, src/styles.css   gabarit et styles, intégrés dans le fichier final
build.mjs   assemble le tout en un seul fichier HTML
test/       tests (node --test)
```

Aucune bibliothèque tierce n'est embarquée dans l'application : la lecture/écriture des fichiers Excel
(format ZIP + XML) est implémentée dans `src/core/zip.js` et `src/core/xlsx.js`.
