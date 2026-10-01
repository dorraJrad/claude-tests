// Formulaires de création / modification réutilisés par plusieurs vues.
import { api } from './api.js';
import { LABELS, options, openForm, toast, confirmAction, today } from './ui.js';

function saveHandler(resource, record, label, onDone, feminine = false) {
  const e = feminine ? 'e' : '';
  return async (data) => {
    const saved = record?.id
      ? await api.update(resource, record.id, data)
      : await api.create(resource, { ...record, ...data }); // conserve les champs cachés (ex. project_id)
    toast(record?.id ? `${label} mis${e} à jour` : `${label} créé${e}`, 'success');
    await onDone?.(saved);
  };
}

function deleteHandler(resource, record, message, onDone) {
  if (!record?.id) return undefined;
  return async () => {
    if (!confirmAction(message)) return false;
    await api.remove(resource, record.id);
    toast('Élément supprimé', 'success');
    await onDone?.(null);
    return true;
  };
}

const contributorOptions = (contributors) => contributors.map((c) => [c.id, c.role ? `${c.name} — ${c.role}` : c.name]);

export function projectForm(project, onDone) {
  openForm({
    title: project?.id ? 'Modifier le projet' : 'Nouveau projet',
    values: project ?? { status: 'planned', start_date: today() },
    fields: [
      { name: 'name', label: 'Nom du projet', required: true, full: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'status', label: 'Statut', type: 'select', required: true, options: options(LABELS.projectStatus) },
      { name: 'budget', label: 'Budget global (€)', type: 'number', min: 0, step: 'any' },
      { name: 'start_date', label: 'Date de début', type: 'date' },
      { name: 'end_date', label: 'Date de fin prévue', type: 'date' },
    ],
    onSubmit: saveHandler('projects', project, 'Projet', onDone),
    onDelete: deleteHandler('projects', project,
      'Supprimer ce projet ainsi que toutes ses tâches, jalons, postes budgétaires et engagements ?', onDone),
  });
}

export function taskForm(task, { projects, contributors }, onDone) {
  openForm({
    title: task?.id ? 'Modifier la tâche' : 'Nouvelle tâche',
    values: { status: 'todo', priority: 'medium', ...task },
    fields: [
      { name: 'title', label: 'Titre', required: true, full: true },
      ...(projects ? [{ name: 'project_id', label: 'Projet', type: 'select', required: true, full: true, options: projects.map((p) => [p.id, p.name]) }] : []),
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'status', label: 'Statut', type: 'select', required: true, options: options(LABELS.taskStatus) },
      { name: 'priority', label: 'Priorité', type: 'select', required: true, options: options(LABELS.priority) },
      { name: 'assignee_id', label: 'Responsable', type: 'select', placeholder: 'Non assigné', options: contributorOptions(contributors) },
      { name: 'estimated_hours', label: 'Charge estimée (heures)', type: 'number', min: 0, step: 'any' },
      { name: 'start_date', label: 'Début', type: 'date' },
      { name: 'due_date', label: 'Échéance', type: 'date' },
    ],
    onSubmit: saveHandler('tasks', task, 'Tâche', onDone, true),
    onDelete: deleteHandler('tasks', task, 'Supprimer cette tâche ?', onDone),
  });
}

export function milestoneForm(milestone, onDone) {
  openForm({
    title: milestone?.id ? 'Modifier le jalon' : 'Nouveau jalon',
    values: milestone,
    fields: [
      { name: 'name', label: 'Nom du jalon', required: true, full: true },
      { name: 'due_date', label: 'Date', type: 'date', required: true },
      { name: 'done', label: 'Atteint', type: 'checkbox' },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
    ],
    onSubmit: saveHandler('milestones', milestone, 'Jalon', onDone),
    onDelete: deleteHandler('milestones', milestone, 'Supprimer ce jalon ?', onDone),
  });
}

export function budgetLineForm(line, onDone) {
  openForm({
    title: line?.id ? 'Modifier le poste budgétaire' : 'Nouveau poste budgétaire',
    values: { category: 'autre', ...line },
    fields: [
      { name: 'name', label: 'Poste', required: true, full: true, placeholder: 'ex. Prestations de développement' },
      { name: 'category', label: 'Nature', type: 'select', required: true, options: options(LABELS.category) },
      { name: 'amount', label: 'Budget prévu (€)', type: 'number', min: 0, step: 'any' },
      { name: 'notes', label: 'Commentaire', type: 'textarea', full: true },
    ],
    onSubmit: saveHandler('budget_lines', line, 'Poste', onDone),
    onDelete: deleteHandler('budget_lines', line,
      'Supprimer ce poste ? Ses engagements resteront dans le projet, sans poste.', onDone),
  });
}

/**
 * Engagement (commande, contrat, bon de commande) ou dépense directe.
 * Montant engagé = montant commandé ; montant réalisé = part déjà facturée / payée.
 */
export function expenseForm(expense, { tasks, contributors, lines }, onDone) {
  openForm({
    title: expense?.id ? "Modifier l'engagement" : 'Nouvel engagement / dépense',
    values: { date: today(), amount_invoiced: 0, ...expense },
    fields: [
      { name: 'label', label: 'Libellé', required: true, full: true, placeholder: 'ex. Bon de commande lot 2' },
      { name: 'budget_line_id', label: 'Poste budgétaire', type: 'select', placeholder: 'Non affecté', full: true, options: lines.map((l) => [l.id, l.name]) },
      { name: 'amount_committed', label: 'Montant engagé (€)', type: 'number', min: 0, step: 'any', required: true,
        hint: 'Montant commandé ou signé' },
      { name: 'amount_invoiced', label: 'Montant réalisé (€)', type: 'number', min: 0, step: 'any',
        hint: 'Part déjà facturée / payée', fill: { from: 'amount_committed', label: 'Tout est réalisé' } },
      { name: 'supplier', label: 'Fournisseur' },
      { name: 'reference', label: 'Référence', placeholder: 'N° de commande ou de facture' },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'contributor_id', label: 'Contributeur', type: 'select', placeholder: 'Aucun', options: contributorOptions(contributors) },
      { name: 'task_id', label: 'Tâche liée', type: 'select', placeholder: 'Aucune', full: true, options: tasks.map((t) => [t.id, t.title]) },
    ],
    onSubmit: saveHandler('expenses', expense, 'Engagement', onDone),
    onDelete: deleteHandler('expenses', expense, 'Supprimer cet engagement ?', onDone),
  });
}

export function contributorForm(contributor, onDone) {
  openForm({
    title: contributor?.id ? 'Modifier le contributeur' : 'Nouveau contributeur',
    values: contributor,
    fields: [
      { name: 'name', label: 'Nom complet', required: true, full: true },
      { name: 'role', label: 'Rôle', placeholder: 'ex. Développeur, Designer…' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'daily_rate', label: 'Taux journalier (€)', type: 'number', min: 0, step: 'any' },
    ],
    onSubmit: saveHandler('contributors', contributor, 'Contributeur', onDone),
    onDelete: deleteHandler('contributors', contributor,
      'Supprimer ce contributeur ? Ses tâches deviendront non assignées.', onDone),
  });
}
