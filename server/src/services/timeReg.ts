// Time Registration Service
// CRUD operations for days and time entries

import pool from '../db/index.js';

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

/**
 * Calculate hours between start and end time
 * @param start - "HH:MM" format
 * @param end - "HH:MM" format
 * @returns Hours as decimal (e.g., 3.5 for 3h 30m)
 */
export function calculateHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
    return 0;
  }

  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  // Handle crossing midnight (end < start)
  const diffMinutes = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : (24 * 60 - startMinutes) + endMinutes;

  return Math.round((diffMinutes / 60) * 100) / 100; // Round to 2 decimals
}

/**
 * Format hours as string (e.g., 3.5 → "3.50")
 */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}

/**
 * Normalize shorthand time formats to HH:MM format
 * @param time - Input time in various formats (8, 800, 0800, 120, 2330, 08:00, etc.)
 * @returns Normalized time in HH:MM format, or original if already valid
 * 
 * Examples:
 * - "8" → "08:00"
 * - "800" → "08:00"
 * - "0800" → "08:00"
 * - "120" → "01:20"
 * - "2330" → "23:30"
 * - "08:00" → "08:00" (already valid)
 */
export function normalizeTime(time: string): string {
  // Remove whitespace
  const trimmed = time.trim();
  
  // If already in HH:MM format, return as-is
  if (trimmed.includes(':')) {
    return trimmed;
  }
  
  // Remove leading zeros for parsing
  const digits = trimmed.replace(/^0+/, '') || '0';
  
  // Parse based on digit count
  if (digits.length <= 2) {
    // Single or double digit: treat as hours (8 → 08:00, 23 → 23:00)
    const hours = parseInt(digits, 10);
    return `${String(hours).padStart(2, '0')}:00`;
  } else if (digits.length === 3) {
    // Three digits: first digit is hours, last two are minutes (800 → 08:00, 120 → 01:20)
    const hours = parseInt(digits[0], 10);
    const minutes = parseInt(digits.slice(1), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } else if (digits.length === 4) {
    // Four digits: first two are hours, last two are minutes (0800 → 08:00, 2330 → 23:30)
    const hours = parseInt(digits.slice(0, 2), 10);
    const minutes = parseInt(digits.slice(2), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } else {
    // More than 4 digits, handle as 4-digit (take last 4)
    const lastFour = digits.slice(-4);
    const hours = parseInt(lastFour.slice(0, 2), 10);
    const minutes = parseInt(lastFour.slice(2), 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}

/**
 * Validate time format (HH:MM)
 */
export function isValidTime(time: string): boolean {
  const match = time.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
  return match !== null;
}

/**
 * Get day name for a date
 */
export function getDayName(dateStr: string): string {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()] || 'Unknown';
}

/**
 * Get previous day (for navigation)
 * Uses date-only math to avoid timezone issues
 */
export function getPreviousDay(userId: number, currentDate: string): string {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  date.setDate(date.getDate() - 1);

  // Format back to YYYY-MM-DD
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get next day (for navigation)
 * Uses date-only math to avoid timezone issues
 */
export function getNextDay(currentDate: string): string {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = currentDate.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  date.setDate(date.getDate() + 1);

  // Format back to YYYY-MM-DD
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================
// Day Operations (Async)
// ============================================

/**
 * Get or create a day record for a user and date
 */
export async function getOrCreateDay(userId: number, workday: string): Promise<Day> {
  // Try to find existing
  const existing = await pool.query<Day>(
    'SELECT * FROM days WHERE user_id = $1 AND workday = $2',
    [userId, workday]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const workdayValue = row.workday as unknown;
    return {
      ...row,
      daysum: parseFloat(String(row.daysum)),
      workday: typeof workdayValue === 'string' ? workdayValue : (workdayValue as Date).toISOString().split('T')[0],
    };
  }

  // Create new day
  const result = await pool.query<Day>(
    `INSERT INTO days (user_id, workday, daysum) VALUES ($1, $2, 0) RETURNING *`,
    [userId, workday]
  );

  const row = result.rows[0];
  const workdayValue = row.workday as unknown;
  return {
    ...row,
    daysum: parseFloat(String(row.daysum)),
    workday: typeof workdayValue === 'string' ? workdayValue : (workdayValue as Date).toISOString().split('T')[0],
  };
}

/**
 * Get day by ID
 */
export async function getDayById(dayId: number): Promise<Day | undefined> {
  const result = await pool.query<Day>(
    'SELECT * FROM days WHERE id = $1',
    [dayId]
  );

  if (!result.rows[0]) {
    return undefined;
  }

  const row = result.rows[0];
  const workdayValue = row.workday as unknown;
  return {
    ...row,
    daysum: parseFloat(String(row.daysum)),
    workday: typeof workdayValue === 'string' ? workdayValue : (workdayValue as Date).toISOString().split('T')[0],
  };
}

/**
 * Update day sum based on items
 */
export async function updateDaySum(dayId: number): Promise<void> {
  const items = await getDayItems(dayId);
  const total = items.reduce((sum, item) => sum + item.rowsum, 0);

  await pool.query(
    'UPDATE days SET daysum = $1 WHERE id = $2',
    [total, dayId]
  );
}

// ============================================
// Day Item Operations (Async)
// ============================================

/**
 * Get all items for a day, sorted by start_hour
 */
export async function getDayItems(dayId: number): Promise<DayItem[]> {
  const result = await pool.query<DayItem>(
    'SELECT * FROM day_items WHERE day_id = $1 ORDER BY start_hour',
    [dayId]
  );

  return result.rows.map(row => ({
    ...row,
    rowsum: parseFloat(String(row.rowsum)),
  }));
}

/**
 * Get a single item by ID
 */
export async function getDayItem(itemId: number): Promise<DayItem | undefined> {
  const result = await pool.query<DayItem>(
    'SELECT * FROM day_items WHERE id = $1',
    [itemId]
  );

  if (!result.rows[0]) {
    return undefined;
  }

  const row = result.rows[0];
  return {
    ...row,
    rowsum: parseFloat(String(row.rowsum)),
  };
}

/**
 * Create a new time entry
 */
export async function createDayItem(
  dayId: number,
  startHour: string,
  endHour: string,
  jiratask: string | null,
  description: string | null
): Promise<DayItem> {
  const rowsum = calculateHours(startHour, endHour);

  // Get max sort order
  const maxResult = await pool.query<{ max: number | null }>(
    'SELECT MAX(sort_order) as max FROM day_items WHERE day_id = $1',
    [dayId]
  );

  const sortOrder = (maxResult.rows[0]?.max ?? 0) + 1;

  const result = await pool.query<DayItem>(
    `INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [dayId, startHour, endHour, jiratask, description, rowsum, sortOrder]
  );

  // Update day total
  await updateDaySum(dayId);

  const row = result.rows[0];
  return {
    ...row,
    rowsum: parseFloat(String(row.rowsum)),
  };
}

/**
 * Update an existing time entry
 */
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

  const result = await pool.query<DayItem>(
    `UPDATE day_items
     SET start_hour = $1, end_hour = $2, jiratask = $3, description = $4, rowsum = $5
     WHERE id = $6 RETURNING *`,
    [startHour, endHour, jiratask, description, rowsum, itemId]
  );

  // Update day total
  await updateDaySum(existing.day_id);

  const row = result.rows[0];
  return {
    ...row,
    rowsum: parseFloat(String(row.rowsum)),
  };
}

/**
 * Delete a time entry
 */
export async function deleteDayItem(itemId: number): Promise<boolean> {
  const existing = await getDayItem(itemId);
  if (!existing) return false;

  await pool.query('DELETE FROM day_items WHERE id = $1', [itemId]);

  // Update day total
  await updateDaySum(existing.day_id);

  return true;
}
