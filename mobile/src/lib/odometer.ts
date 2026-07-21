// Client-side mileage engine (Signal-parity D5). Odometer readings are E2EE
// content, so everything the server used to derive from them — monotonic
// validation, avg km/day, remaining-km / estimated-date enrichment, and the
// mileage tasks' estimated nextDueDate refresh — now runs here over the
// decrypted logs, using the same shared @household/calendar helpers.

import { avgKmPerDay, estimateDateFromKm } from '@household/calendar';
import { odometerApi, itemsApi, tasksApi, Item, OdometerLog } from '../api';
import { openRecord, sealNew, sealUpdate } from './e2ee';
import { TASK_ENC, ITEM_ENC, ODOMETER_ENC } from './encSubsets';

export interface MileageTaskStatus {
  _id: string;
  title?: string;
  intervalKm?: number;
  lastServiceKm?: number | null;
  nextDueKm?: number | null;
  remainingKm: number | null;
  estimatedDate: Date | null;
  priority?: string;
}

export interface OdometerData {
  logs: OdometerLog[];          // decrypted, newest first
  currentKm: number | null;
  kmPerDay: number | null;      // rounded, or null without enough history
  mileageTasks: MileageTaskStatus[];
}

// Fetch + decrypt the raw rows and derive everything the old server GET
// returned (currentKm, kmPerDay, per-task remaining/estimates).
export async function loadOdometerData(itemId: string): Promise<OdometerData> {
  const { data } = await odometerApi.get(itemId);
  const logs = await Promise.all((data.logs ?? []).map((l) => openRecord('OdometerLog', l)));
  logs.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  const tasks = await Promise.all((data.mileageTasks ?? []).map((t) => openRecord('MaintenanceTask', t)));

  const withReadings = logs.filter((l) => l.reading != null) as Array<OdometerLog & { reading: number }>;
  const kmPerDay = avgKmPerDay(withReadings);
  const currentKm = withReadings[0]?.reading ?? null;

  const mileageTasks: MileageTaskStatus[] = tasks
    .map((t) => {
      // A never-completed task has no nextDueKm: estimate the next interval
      // boundary above the current reading (implied last service one below it).
      let nextDueKm = t.nextDueKm ?? null;
      let lastServiceKm = t.lastServiceKm ?? null;
      if (nextDueKm == null && t.intervalKm && currentKm != null) {
        nextDueKm = Math.ceil(currentKm / t.intervalKm) * t.intervalKm;
        lastServiceKm = nextDueKm - t.intervalKm;
      }
      const remainingKm = nextDueKm != null && currentKm != null ? nextDueKm - currentKm : null;
      const estimatedDate = nextDueKm != null && currentKm != null && kmPerDay
        ? estimateDateFromKm(nextDueKm, currentKm, kmPerDay)
        : null;
      return {
        _id: t._id, title: t.title, intervalKm: t.intervalKm,
        lastServiceKm, nextDueKm, remainingKm, estimatedDate,
        priority: t.priority,
      };
    })
    .sort((a, b) => (a.remainingKm ?? Infinity) - (b.remainingKm ?? Infinity));

  return { logs, currentKm, kmPerDay: kmPerDay ? Math.round(kmPerDay) : null, mileageTasks };
}

// Log a reading: validate against the last decrypted reading (the old server
// check), create the sealed log, refresh the mileage tasks' estimated due
// dates, and sync the item's odometer custom field — all client-side.
// `data` is a pre-loaded loadOdometerData result for the same item.
export async function logOdometerReading(
  itemId: string,
  reading: number,
  data: OdometerData,
  notes?: string,
): Promise<void> {
  if (reading == null || isNaN(reading)) throw new Error('A reading (km) is required.');
  const latest = data.currentKm;
  if (latest != null && reading < latest) {
    throw new Error(`Reading must be greater than the last recorded value (${latest.toLocaleString()} km)`);
  }

  const payload = { reading: Number(reading), notes: notes || undefined, recordedAt: new Date().toISOString() };
  await odometerApi.log(itemId, await sealNew('OdometerLog', payload, ODOMETER_ENC(payload)));

  // Re-estimate each completed mileage task's due date from the new rate.
  const kmPerDay = avgKmPerDay([
    ...data.logs.filter((l) => l.reading != null),
    { reading: Number(reading), recordedAt: new Date() },
  ] as Array<{ reading: number; recordedAt: Date | string }>);
  if (kmPerDay) {
    for (const t of data.mileageTasks) {
      // Only tasks with a REAL stored nextDueKm (not the implied boundary — the
      // old server matched `nextDueKm: { $exists: true }` the same way).
      const raw = (await tasksApi.get(t._id)).data;
      const task = await openRecord('MaintenanceTask', raw);
      if (task.nextDueKm == null) continue;
      const est = estimateDateFromKm(task.nextDueKm, Number(reading), kmPerDay);
      if (!est) continue;
      const updates: Record<string, unknown> = { nextDueDate: est.toISOString() };
      const content = TASK_ENC({ ...task, ...updates });
      await tasksApi.update(t._id, await sealUpdate('MaintenanceTask', t._id, updates, content));
    }
  }

  // Keep the item's "Odometer (km)" custom field in sync (customFields are
  // sealed item content, so this must happen on-device too).
  try {
    const item = await openRecord('Item', (await itemsApi.get(itemId)).data as Item & { _id: string });
    const fields = [...((item.customFields as Array<{ key: string; value: string }>) ?? [])];
    const idx = fields.findIndex((f) => f.key === 'Odometer (km)');
    const value = String(Math.round(reading));
    if (idx >= 0) fields[idx] = { ...fields[idx], value };
    else fields.push({ key: 'Odometer (km)', value });
    const updates = { customFields: fields };
    await itemsApi.update(itemId, await sealUpdate('Item', itemId, updates, ITEM_ENC({ ...item, ...updates })));
  } catch {
    // Best-effort — the detail card just shows the previous value until edited.
  }
}
