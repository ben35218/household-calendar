// Client-side task/chore instantiation (Signal-parity D4). The server's
// /from-template and /manuals/:id/create-tasks routes are gone — they minted
// plaintext records with no `enc` and computed nextDueDate server-side. The
// builders here produce the exact same payloads (anchorRecurrence + seedDueDate
// from the shared engine), sealed on-device via the ordinary create endpoints.

import { anchorRecurrence, seedDueDate } from '@household/calendar';
import { tasksApi, choresApi, Task, Chore, TaskTemplate, ChoreTemplate, Recurrence, Category, ExtractedTask } from '../api';
import { sealNew } from './e2ee';
import { loadCategories } from './categories';
import { TASK_ENC, CHORE_ENC } from './encSubsets';

const isoDate = (d: Date | null) => (d ? d.toISOString() : undefined);

// Mirror of the old server tasks.js /from-template body (per selection). When
// no categoryId is given, the template's defaultCategoryName is resolved over
// the DECRYPTED category list (names are sealed content — D5); pass
// `categories` when creating in bulk to avoid refetching per task.
export async function createTaskFromTemplate(
  tpl: TaskTemplate,
  opts: { itemId?: string; categoryId?: string; categories?: Category[] } = {},
): Promise<Task> {
  const recurrence = anchorRecurrence(tpl.recurrence as Recurrence | undefined);
  let categoryId = opts.categoryId;
  if (!categoryId && tpl.defaultCategoryName) {
    const cats = opts.categories ?? (await loadCategories().catch(() => [] as Category[]));
    categoryId = cats.find((c) => c.name === tpl.defaultCategoryName)?._id;
  }
  const payload: Record<string, unknown> = {
    title: tpl.title,
    icon: tpl.icon,
    description: (tpl as { description?: string }).description,
    recurrence,
    priority: tpl.priority || 'medium',
    estimatedDurationMins: tpl.estimatedDurationMins,
    estimatedCost: tpl.estimatedCost,
    intervalKm: tpl.intervalKm,
    templateId: tpl.id,
    nextDueDate: isoDate(seedDueDate(recurrence)),
  };
  if (opts.itemId) payload.itemId = opts.itemId;
  if (categoryId) payload.categoryId = categoryId;
  return (await tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)))).data;
}

// Mirror of the old server chores.js /from-template body.
export async function createChoreFromTemplate(tpl: ChoreTemplate): Promise<Chore> {
  const recurrence = anchorRecurrence(tpl.recurrence as Recurrence | undefined);
  const payload: Record<string, unknown> = {
    title: tpl.title,
    instructions: (tpl as { description?: string }).description,
    icon: tpl.icon || 'mdi-broom',
    recurrence,
    templateId: tpl.id,
    nextDueDate: isoDate(seedDueDate(recurrence)),
  };
  return (await choresApi.create(await sealNew('Chore', payload, CHORE_ENC(payload)))).data;
}

// Mirror of the old server manuals.js /create-tasks body: description+notes
// join, anchored recurrence, mileage boundary seeding from the current reading.
export async function createTaskFromManualExtract(
  t: ExtractedTask,
  opts: { itemId?: string; categoryId?: string; currentKm?: number | null } = {},
): Promise<Task> {
  const recurrence = t.recurrence?.type ? anchorRecurrence(t.recurrence) : undefined;
  const payload: Record<string, unknown> = {
    title: t.title,
    description: [t.description, t.notes].filter(Boolean).join(' — ') || undefined,
    priority: t.priority || 'medium',
    recurrence,
    estimatedDurationMins: t.estimatedDurationMins || undefined,
    estimatedCost: t.estimatedCost || undefined,
  };
  if (opts.itemId) payload.itemId = opts.itemId;
  if (opts.categoryId) payload.categoryId = opts.categoryId;

  if (t.intervalKm && opts.currentKm != null) {
    const intervalKm = Number(t.intervalKm);
    payload.intervalKm = intervalKm;
    // Next boundary above the current odometer; implied last service one below.
    const nextDueKm = Math.ceil(Number(opts.currentKm) / intervalKm) * intervalKm;
    payload.nextDueKm = nextDueKm;
    payload.lastServiceKm = nextDueKm - intervalKm;
  } else if (t.intervalKm) {
    payload.intervalKm = Number(t.intervalKm);
  }

  if (recurrence?.type) payload.nextDueDate = isoDate(seedDueDate(recurrence));
  return (await tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)))).data;
}
