# Pilotage de projets

Application web pour chef de projet : suivi des **tâches**, des **budgets**, des **échéances** et des **contributeurs**.

- Aucune dépendance à installer : Node.js ≥ 22.13 suffit (serveur HTTP et base SQLite intégrés à Node).
- Interface en français, responsive, avec thème clair/sombre automatique.

## Installation sur votre poste

1. **Installer Node.js** (une seule fois) : téléchargez la version **LTS** sur <https://nodejs.org/fr/download>
   et installez-la avec les options par défaut. Il faut la version 22.13 ou plus récente.
2. **Récupérer l'application** : sur GitHub, ouvrez la branche de l'application, cliquez sur
   **Code → Download ZIP** puis décompressez le dossier (ou `git clone` si vous utilisez Git).
3. **Lancer l'application** en double-cliquant sur le lanceur correspondant à votre système :

   | Système  | Fichier à double-cliquer | Remarque |
   |----------|--------------------------|----------|
   | Windows  | `Demarrer-Windows.bat`   | Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur *Informations complémentaires → Exécuter quand même*. |
   | macOS    | `Demarrer-Mac.command`   | La première fois : clic droit → *Ouvrir* (Gatekeeper bloque les fichiers téléchargés). |
   | Linux    | `demarrer-linux.sh`      | Ou `./demarrer-linux.sh` dans un terminal. |

   Le navigateur s'ouvre automatiquement sur <http://127.0.0.1:3000>.
   **Laissez la fenêtre noire ouverte** pendant l'utilisation ; fermez-la pour arrêter l'application.

Alternative en ligne de commande (dans le dossier de l'application) :

```bash
npm start        # démarre sur http://127.0.0.1:3000
npm run seed     # (optionnel) ajoute des données de démonstration
```

**Où sont mes données ?** Dans le fichier `data/projets.db` du dossier de l'application.
Pour sauvegarder, utilisez **Données → Télécharger les données (.xlsx)** ; pour restaurer, importez ce fichier
en mode *Remplacer*. Pour mettre à jour l'application, remplacez les fichiers en conservant le dossier `data/`.

Variables d'environnement (facultatives) :

| Variable  | Défaut             | Rôle                          |
|-----------|--------------------|-------------------------------|
| `PORT`    | `3000`             | Port d'écoute (si 3000 est déjà pris) |
| `HOST`    | `127.0.0.1`        | Mettre `0.0.0.0` pour y accéder depuis d'autres postes du réseau (aucune authentification : réseau de confiance uniquement) |
| `DB_FILE` | `data/projets.db`  | Fichier de la base SQLite     |

## Fonctionnalités

**Tableau de bord** — projets en cours, avancement global, budget consommé, échéances dépassées ;
état de santé de chaque projet (*Dans les clous*, *À surveiller*, *Critique*) ; échéances des 30 prochains jours
(à cocher directement) ; charge de chaque contributeur.

**Projets** — fiche projet (statut, dates, budget) avec quatre onglets :
- **Tâches** : tableau kanban *À faire / En cours / Terminé* avec glisser-déposer, priorité, responsable,
  charge estimée, dates ; filtre par responsable.
- **Planning & jalons** : diagramme de Gantt des tâches, jalons, ligne « aujourd'hui » et fin prévue.
- **Budget** : budget alloué / dépensé / reste, prévision de main-d'œuvre (charge × taux journalier),
  coût projeté à terminaison, répartition par catégorie, liste des dépenses.
- **Équipe** : avancement, reste à faire, retards, coût prévu et dépenses imputées par contributeur.

**Échéances** — toutes les tâches et jalons ouverts, regroupés (en retard, aujourd'hui, 7 jours, 30 jours, plus tard),
filtrables par projet et par type.

**Contributeurs** — annuaire (rôle, e-mail, taux journalier) et charge de travail.

**Données** — gestion de la base directement dans l'interface :
- **Import Excel** : téléchargez le modèle, remplissez un onglet par table (Contributeurs, Projets, Tâches, Jalons, Dépenses),
  puis importez-le. Le fichier est d'abord **analysé** (nombre d'éléments à créer / mettre à jour, erreurs localisées
  par onglet, ligne et colonne) ; rien n'est enregistré avant confirmation, et rien du tout s'il reste une erreur.
  - *Fusionner* : met à jour les éléments de même ID ou de même nom, ajoute les nouveaux ; une cellule vide ne modifie pas la valeur existante.
  - *Remplacer* : vide la base puis charge le fichier (restauration d'une sauvegarde).
  - Libellés en français acceptés (« En cours », « Haute », « Oui »…), dates Excel ou JJ/MM/AAAA, liens par nom (projet, responsable, tâche).
- **Export Excel** de toute la base (sauvegarde, ou modification en masse dans Excel puis ré-import).
- **Éditeur de tables** : chaque table affichée comme un tableur, modification directe des cellules
  (enregistrement immédiat et validé), ajout, suppression, recherche.
- Chargement des données de démonstration et remise à zéro de la base (confirmation requise).

### Règles de calcul

- **Avancement** = tâches terminées / tâches totales.
- **Prévision main-d'œuvre** = Σ (heures estimées × taux journalier / 8) des tâches assignées.
- **Santé** : *Critique* si les dépenses dépassent le budget ou si la date de fin est passée (projet non terminé) ;
  *À surveiller* s'il existe une tâche ou un jalon en retard, ou si plus de 90 % du budget est consommé.

## API REST

Toutes les routes sont sous `/api` et échangent du JSON.

| Ressource       | Routes                                                     | Filtres (`?clé=valeur`)                 |
|-----------------|------------------------------------------------------------|-----------------------------------------|
| `projects`      | `GET, POST /api/projects` · `GET, PATCH, DELETE /api/projects/:id` | `status`                        |
| `tasks`         | idem                                                       | `project_id`, `assignee_id`, `status`   |
| `milestones`    | idem                                                       | `project_id`, `done`                    |
| `expenses`      | idem                                                       | `project_id`, `task_id`, `contributor_id` |
| `contributors`  | idem                                                       | —                                       |

Données : `GET /api/export` (classeur .xlsx, `?template=1` pour le modèle vierge),
`POST /api/import?mode=merge|replace&dryRun=1` (corps : fichier .xlsx), `GET /api/schema`, `GET /api/admin/stats`,
`POST /api/admin/demo`, `POST /api/admin/reset` (`{"confirm":"SUPPRIMER"}`).

Indicateurs : `GET /api/dashboard`, `GET /api/projects/:id/summary`,
`GET /api/deadlines?project_id=&until=AAAA-MM-JJ`, `GET /api/workload`.

Les erreurs de validation renvoient `400` avec le détail par champ : `{ "error": "...", "details": { "champ": "message" } }`.

## Structure

```
src/        serveur (index.js, server.js, api.js, repo.js, resources.js, db.js,
            datasheets.js = import/export Excel, xlsx.js = lecture/écriture .xlsx sans dépendance)
public/     interface (index.html, styles.css, js/…)
test/       tests d'API et d'import/export Excel (node --test)
```

## Tests

```bash
npm test
```
