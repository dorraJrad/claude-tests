# Pilotage de projets

Application web pour chef de projet : suivi des **tâches**, des **budgets**, des **échéances** et des **contributeurs**.

- Aucune dépendance à installer : Node.js ≥ 22.13 suffit (serveur HTTP et base SQLite intégrés à Node).
- Interface en français, responsive, avec thème clair/sombre automatique.

## Démarrage

```bash
npm run seed   # (optionnel) charge un jeu de données de démonstration
npm start      # http://127.0.0.1:3000
```

Variables d'environnement :

| Variable  | Défaut             | Rôle                          |
|-----------|--------------------|-------------------------------|
| `PORT`    | `3000`             | Port d'écoute                 |
| `HOST`    | `127.0.0.1`        | Interface d'écoute            |
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

Indicateurs : `GET /api/dashboard`, `GET /api/projects/:id/summary`,
`GET /api/deadlines?project_id=&until=AAAA-MM-JJ`, `GET /api/workload`.

Les erreurs de validation renvoient `400` avec le détail par champ : `{ "error": "...", "details": { "champ": "message" } }`.

## Structure

```
src/        serveur (index.js, server.js, api.js, resources.js, db.js, seed.js)
public/     interface (index.html, styles.css, js/…)
test/       tests d'API (node --test)
```

## Tests

```bash
npm test
```
