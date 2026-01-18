// Time Registration Service
// CRUD operations for days and time entries

import db from '../db/index.js';

// Types
export interface Day {
  id: number;
  user_id: number;
  workday: string;
  daysum: number;
  created_at: string;
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
// Hour Calculations
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

// ============================================
// Day Operations
// ============================================

/**
 * Get or create a day record for a user and date
 */
export function getOrCreateDay(userId: number, workday: string): Day {
  // Try to find existing
  let day = db.prepare(`
    SELECT * FROM days WHERE user_id = ? AND workday = ?
  `).get(userId, workday) as Day | undefined;
  
  if (!day) {
    // Create new day
    const result = db.prepare(`
      INSERT INTO days (user_id, workday, daysum) VALUES (?, ?, 0)
    `).run(userId, workday);
    
    day = {
      id: result.lastInsertRowid as number,
      user_id: userId,
      workday,
      daysum: 0,
      created_at: new Date().toISOString(),
    };
  }
  
  return day;
}

/**
 * Get day by ID
 */
export function getDayById(dayId: number): Day | undefined {
  return db.prepare('SELECT * FROM days WHERE id = ?').get(dayId) as Day | undefined;
}

/**
 * Update day sum based on items
 */
export function updateDaySum(dayId: number): void {
  const items = getDayItems(dayId);
  const total = items.reduce((sum, item) => sum + item.rowsum, 0);
  
  db.prepare('UPDATE days SET daysum = ? WHERE id = ?').run(total, dayId);
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
// Day Item Operations
// ============================================

/**
 * Get all items for a day, sorted by sort_order
 */
export function getDayItems(dayId: number): DayItem[] {
  return db.prepare(`
    SELECT * FROM day_items WHERE day_id = ? ORDER BY sort_order, start_hour
  `).all(dayId) as DayItem[];
}

/**
 * Get a single item by ID
 */
export function getDayItem(itemId: number): DayItem | undefined {
  return db.prepare('SELECT * FROM day_items WHERE id = ?').get(itemId) as DayItem | undefined;
}

/**
 * Create a new time entry
 */
export function createDayItem(
  dayId: number,
  startHour: string,
  endHour: string,
  jiratask: string | null,
  description: string | null
): DayItem {
  const rowsum = calculateHours(startHour, endHour);
  
  // Get max sort order
  const maxOrder = db.prepare(`
    SELECT MAX(sort_order) as max FROM day_items WHERE day_id = ?
  `).get(dayId) as { max: number | null };
  
  const sortOrder = (maxOrder.max ?? 0) + 1;
  
  const result = db.prepare(`
    INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(dayId, startHour, endHour, jiratask, description, rowsum, sortOrder);
  
  // Update day total
  updateDaySum(dayId);
  
  return {
    id: result.lastInsertRowid as number,
    day_id: dayId,
    start_hour: startHour,
    end_hour: endHour,
    jiratask,
    description,
    rowsum,
    sort_order: sortOrder,
  };
}

/**
 * Update an existing time entry
 */
export function updateDayItem(
  itemId: number,
  startHour: string,
  endHour: string,
  jiratask: string | null,
  description: string | null
): DayItem | undefined {
  const existing = getDayItem(itemId);
  if (!existing) return undefined;
  
  const rowsum = calculateHours(startHour, endHour);
  
  db.prepare(`
    UPDATE day_items 
    SET start_hour = ?, end_hour = ?, jiratask = ?, description = ?, rowsum = ?
    WHERE id = ?
  `).run(startHour, endHour, jiratask, description, rowsum, itemId);
  
  // Update day total
  updateDaySum(existing.day_id);
  
  return {
    ...existing,
    start_hour: startHour,
    end_hour: endHour,
    jiratask,
    description,
    rowsum,
  };
}

/**
 * Delete a time entry
 */
export function deleteDayItem(itemId: number): boolean {
  const existing = getDayItem(itemId);
  if (!existing) return false;
  
  db.prepare('DELETE FROM day_items WHERE id = ?').run(itemId);
  
  // Update day total
  updateDaySum(existing.day_id);
  
  return true;
}
