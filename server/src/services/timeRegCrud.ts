// Time Registration CRUD Adapter
// Wraps existing timeReg service functions for CRUDTable ServiceCall pattern

import {
  getOrCreateDay,
  getDayItems,
  createDayItem,
  updateDayItem,
  deleteDayItem,
  formatHours,
  normalizeTime,
  isValidTime,
  getDayName,
  getPreviousDay,
  getNextDay,
  type DayItem,
} from './timeReg.js';
import { getJiraTasks, jiraTask } from './jiraTasks.js';

export interface ListParams {
  userId: number;
  date: string;
}

export interface CreateParams {
  dayId: number;
  start_hour: string;
  end_hour: string;
  jiratask: string | null;
  description: string | null;
}

export interface UpdateParams {
  itemId: number;
  start_hour: string;
  end_hour: string;
  jiratask: string | null;
  description: string | null;
}

/**
 * List time entries for a user+date.
 * Returns display-ready records with the dayId and daysum attached to context via side-channel.
 */
export async function listEntries(params: ListParams): Promise<Record<string, unknown>[]> {
  const day = await getOrCreateDay(params.userId, params.date);
  const items = await getDayItems(day.id);

  // Return items with display formatting + raw data for edit
  return items.map((item) => ({
    id: item.id,
    day_id: day.id,
    start_hour: item.start_hour,
    end_hour: item.end_hour,
    rowsum: formatHours(item.rowsum),
    jiratask: item.jiratask || '',
    description: item.description || '',
    // Store raw daysum for header display
    _daysum: day.daysum,
    _dayId: day.id,
  }));
}

/**
 * Create a time entry with validation and time normalization.
 */
export async function createEntry(params: CreateParams): Promise<DayItem> {
  const startHour = normalizeTime(params.start_hour);
  const endHour = normalizeTime(params.end_hour);

  if (!isValidTime(startHour)) {
    throw new Error('Invalid start time. Use HH:MM or shorthand (8, 800, 0800)');
  }
  if (!isValidTime(endHour)) {
    throw new Error('Invalid end time. Use HH:MM or shorthand (8, 800, 0800)');
  }
  if (endHour <= startHour) {
    throw new Error('End time must be after start time');
  }

  return await createDayItem(
    params.dayId,
    startHour,
    endHour,
    params.jiratask,
    params.description
  );
}

/**
 * Update a time entry with validation and time normalization.
 */
export async function updateEntry(params: UpdateParams): Promise<DayItem | undefined> {
  const startHour = normalizeTime(params.start_hour);
  const endHour = normalizeTime(params.end_hour);

  if (!isValidTime(startHour)) {
    throw new Error('Invalid start time. Use HH:MM or shorthand (8, 800, 0800)');
  }
  if (!isValidTime(endHour)) {
    throw new Error('Invalid end time. Use HH:MM or shorthand (8, 800, 0800)');
  }
  if (endHour <= startHour) {
    throw new Error('End time must be after start time');
  }

  return await updateDayItem(
    params.itemId,
    startHour,
    endHour,
    params.jiratask,
    params.description
  );
}

export async function listJiraTasks(): Promise<jiraTask[]> {
  return await getJiraTasks();
}

/**
 * Delete a time entry by ID.
 */
export async function deleteEntry(itemId: number): Promise<boolean> {
  return await deleteDayItem(itemId);
}

// Re-export helpers the config needs
export { getDayName, getPreviousDay, getNextDay, formatHours, getOrCreateDay };
