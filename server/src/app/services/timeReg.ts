// Time Registration Service
// CRUD operations for days and time entries

import { eq, and, max, sql } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { days, dayItems } from '../db/schema.js';

// Types
export interface Day {
  id: number;
  user_id: number;
  workday: string;
  daysum: number;
  created_at: Date;
}

export interface DayItem {
  id: number;
  day_id: number;
  start_hour: string;
  end_hour: string;
  jiratask: string | null;
  description: string | null;
  rowsum: number;
  sort_order: number;
}

// ============================================
// Hour Calculations (Pure functions - no async needed)
// ============================================

export function calculateHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
    return 0;
  }

  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  const diffMinutes = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : (24 * 60 - startMinutes) + endMinutes;

  return Math.round((diffMinutes / 60) * 100) / 100;
}

export function formatHours(hours: number): string {
  return hours.toFixed(2);
}

export function normalizeTime(time: string): string {
  const trimmed = time.trim();

  if (trimmed.includes(':')) {
    return trimmed;
  }

  const digits = trimmed.replace(/^0+/, '') || '0';

  if (digits.length <= 2) {
    const hours = parseInt(digits, 10);
    return `${String(hours).padStart(2, '0')}:00`;
  } else if (digits.length === 3) {
    const hours = parseInt(digits[0], 10);
    const minutes = parseInt(digits.slice(1), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } else if (digits.length === 4) {
    const hours = parseInt(digits.slice(0, 2), 10);
    const minutes = parseInt(digits.slice(2), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } else {
    const lastFour = digits.slice(-4);
    const hours = parseInt(lastFour.slice(0, 2), 10);
    const minutes = parseInt(lastFour.slice(2), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}

export function isValidTime(time: string): boolean {
  const match = time.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
  return match !== null;
}

export function getDayName(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return dayNames[date.getDay()] || 'Unknown';
}

export function getPreviousDay(userId: number, currentDate: string): string {
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getNextDay(currentDate: string): string {
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================
// Day Operations (Async)
// ============================================

export async function getOrCreateDay(userId: number, workday: string): Promise<Day> {
  const existing = await db
    .select()
    .from(days)
    .where(and(eq(days.user_id, userId), eq(days.workday, workday)));

  if (existing[0]) {
    const row = existing[0];
    return { ...row, daysum: parseFloat(row.daysum) };
  }

  const inserted = await db
    .insert(days)
    .values({ user_id: userId, workday, daysum: '0' })
    .returning();

  const row = inserted[0];
  return { ...row, daysum: parseFloat(row.daysum) };
}

export async function getDayById(dayId: number): Promise<Day | undefined> {
  const rows = await db.select().from(days).where(eq(days.id, dayId));
  if (!rows[0]) return undefined;
  const row = rows[0];
  return { ...row, daysum: parseFloat(row.daysum) };
}

export async function updateDaySum(dayId: number): Promise<void> {
  const items = await getDayItems(dayId);
  const total = items.reduce((sum, item) => sum + item.rowsum, 0);

  await db.update(days).set({ daysum: String(total) }).where(eq(days.id, dayId));
}

// ============================================
// Day Item Operations (Async)
// ============================================

export async function getDayItems(dayId: number): Promise<DayItem[]> {
  const rows = await db
    .select()
    .from(dayItems)
    .where(eq(dayItems.day_id, dayId))
    .orderBy(dayItems.start_hour);

  return rows.map(row => ({ ...row, rowsum: parseFloat(row.rowsum) }));
}

export async function getDayItem(itemId: number): Promise<DayItem | undefined> {
  const rows = await db.select().from(dayItems).where(eq(dayItems.id, itemId));
  if (!rows[0]) return undefined;
  const row = rows[0];
  return { ...row, rowsum: parseFloat(row.rowsum) };
}

export async function createDayItem(
  dayId: number,
  startHour: string,
  endHour: string,
  jiratask: string | null,
  description: string | null
): Promise<DayItem> {
  const rowsum = calculateHours(startHour, endHour);

  const maxResult = await db
    .select({ max: max(dayItems.sort_order) })
    .from(dayItems)
    .where(eq(dayItems.day_id, dayId));

  const sortOrder = (maxResult[0]?.max ?? 0) + 1;

  const inserted = await db
    .insert(dayItems)
    .values({
      day_id: dayId,
      start_hour: startHour,
      end_hour: endHour,
      jiratask,
      description,
      rowsum: String(rowsum),
      sort_order: sortOrder,
    })
    .returning();

  await updateDaySum(dayId);

  const row = inserted[0];
  return { ...row, rowsum: parseFloat(row.rowsum) };
}

export async function updateDayItem(
  itemId: number,
  startHour: string,
  endHour: string,
  jiratask: string | null,
  description: string | null
): Promise<DayItem | undefined> {
  const existing = await getDayItem(itemId);
  if (!existing) return undefined;

  const rowsum = calculateHours(startHour, endHour);

  const updated = await db
    .update(dayItems)
    .set({ start_hour: startHour, end_hour: endHour, jiratask, description, rowsum: String(rowsum) })
    .where(eq(dayItems.id, itemId))
    .returning();

  await updateDaySum(existing.day_id);

  const row = updated[0];
  return { ...row, rowsum: parseFloat(row.rowsum) };
}

export async function deleteDayItem(itemId: number): Promise<boolean> {
  const existing = await getDayItem(itemId);
  if (!existing) return false;

  await db.delete(dayItems).where(eq(dayItems.id, itemId));
  await updateDaySum(existing.day_id);

  return true;
}
