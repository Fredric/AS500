// Time Registration CRUD Adapter
// Wraps existing timeReg service functions for CRUDTable ServiceCall pattern

import { and, gte, lte, eq } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { days, dayItems } from '../db/schema.js';
import {
  getOrCreateDay,
  getDayItem,
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

/**
 * Fetch a single time entry by ID. Matches the shape returned by
 * {@link listEntries} — including the formatted `rowsum` string — so that
 * consumers (CRUDTable's update/delete flows, MCP `<configId>.read`) see a
 * consistent record regardless of which call produced it.
 *
 * Returns `null` when the entry does not exist; never throws for not-found.
 */
export async function readEntry(params: { id: number }): Promise<Record<string, unknown> | null> {
  const item = await getDayItem(params.id);
  if (!item) return null;
  return {
    id: item.id,
    day_id: item.day_id,
    start_hour: item.start_hour,
    end_hour: item.end_hour,
    rowsum: formatHours(item.rowsum),
    jiratask: item.jiratask || '',
    description: item.description || '',
  };
}

// ============================================
// Range queries (used by MCP custom actions)
// ============================================

export interface SummarizeHoursParams {
  userId: number;
  startDate: string;
  endDate: string;
}

export interface SummarizeHoursResult {
  startDate: string;
  endDate: string;
  totalHours: number;
  workDays: number;
  byDate: { date: string; hours: number }[];
}

/**
 * Aggregate total hours worked between two dates (inclusive) for a user.
 *
 * Only days that already exist in the `days` table are counted — days with no
 * entries (i.e. never opened in the UI or created via the API) are ignored.
 * Returns a breakdown by date plus overall totals.
 */
export async function summarizeHours(params: SummarizeHoursParams): Promise<SummarizeHoursResult> {
  const rows = await db
    .select({ workday: days.workday, daysum: days.daysum })
    .from(days)
    .where(
      and(
        eq(days.user_id, params.userId),
        gte(days.workday, params.startDate),
        lte(days.workday, params.endDate)
      )
    )
    .orderBy(days.workday);

  const byDate = rows.map((r) => ({
    date: r.workday,
    hours: parseFloat(r.daysum),
  }));

  const totalHours = Math.round(byDate.reduce((sum, d) => sum + d.hours, 0) * 100) / 100;
  const workDays = byDate.filter((d) => d.hours > 0).length;

  return { startDate: params.startDate, endDate: params.endDate, totalHours, workDays, byDate };
}

export interface ListEntriesByRangeParams {
  userId: number;
  startDate: string;
  endDate: string;
}

export interface TimeEntryWithDate {
  id: number;
  date: string;
  start_hour: string;
  end_hour: string;
  hours: number;
  jiratask: string | null;
  description: string | null;
}

/**
 * Return all individual time entries between two dates (inclusive) for a user,
 * ordered by date and start time. Unlike `listEntries`, this spans multiple
 * days and does not require a specific date.
 */
export async function listEntriesByRange(params: ListEntriesByRangeParams): Promise<TimeEntryWithDate[]> {
  const rows = await db
    .select({
      id: dayItems.id,
      workday: days.workday,
      start_hour: dayItems.start_hour,
      end_hour: dayItems.end_hour,
      rowsum: dayItems.rowsum,
      jiratask: dayItems.jiratask,
      description: dayItems.description,
    })
    .from(dayItems)
    .innerJoin(days, eq(dayItems.day_id, days.id))
    .where(
      and(
        eq(days.user_id, params.userId),
        gte(days.workday, params.startDate),
        lte(days.workday, params.endDate)
      )
    )
    .orderBy(days.workday, dayItems.start_hour);

  return rows.map((r) => ({
    id: r.id,
    date: r.workday,
    start_hour: r.start_hour,
    end_hour: r.end_hour,
    hours: parseFloat(r.rowsum),
    jiratask: r.jiratask,
    description: r.description,
  }));
}

// Re-export helpers the config needs
export { getDayName, getPreviousDay, getNextDay, formatHours, getOrCreateDay };
