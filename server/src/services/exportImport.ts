// Export/Import Service
// CSV export and import for days and day_items tables

import db from '../db/index.js';
import { getDayItems, getOrCreateDay, createDayItem, isValidTime as validateTime } from './timeReg.js';
import type { Day, DayItem } from './timeReg.js';

/**
 * Export days and day_items to CSV format
 * AS400-style format: simple, fixed structure
 * 
 * CSV structure:
 * Type,User_ID,Workday,Daysum,Start_Hour,End_Hour,Jiratask,Description,Rowsum
 * 
 * Type: DAY or ITEM
 * For DAY rows: User_ID, Workday, Daysum are populated
 * For ITEM rows: User_ID, Workday, Start_Hour, End_Hour, Jiratask, Description, Rowsum are populated
 */
export function exportTimeData(userId: number): string {
  const lines: string[] = [];
  
  // Header row
  lines.push('Type,User_ID,Workday,Daysum,Start_Hour,End_Hour,Jiratask,Description,Rowsum');
  
  // Get all days for user
  const days = db.prepare(`
    SELECT * FROM days WHERE user_id = ? ORDER BY workday
  `).all(userId) as Day[];
  
  // For each day, export day record and its items
  for (const day of days) {
    // Export day record
    lines.push(`DAY,${day.user_id},${day.workday},${day.daysum},,,,`);
    
    // Export day items
    const items = getDayItems(day.id);
    for (const item of items) {
      // Note: Commas in jiratask/description will break CSV parsing
      // In a real AS400 system, you'd use a different delimiter or proper CSV escaping
      const jiratask = (item.jiratask || '').replace(/,/g, ';');
      const description = (item.description || '').replace(/,/g, ';');
      lines.push(`ITEM,${day.user_id},${day.workday},,${item.start_hour},${item.end_hour},${jiratask},${description},${item.rowsum}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Import result type
 */
export interface ImportResult {
  success: boolean;
  daysImported: number;
  itemsImported: number;
  errors: string[];
}

/**
 * Parse and validate a CSV line
 */
function parseCSVLine(line: string): string[] {
  // Simple CSV parser - splits on comma
  // In AS400 style, we keep it simple - no quoted fields with embedded commas
  return line.split(',').map(s => s.trim());
}

/**
 * Validate date format YYYY-MM-DD
 */
function isValidDate(date: string): boolean {
  if (!date) return false;
  const match = date.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return false;
  
  // Check if it's a valid date
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Import days and day_items from CSV format
 * 
 * Import strategy:
 * - Skip header row
 * - For each DAY row: create or update day record
 * - For each ITEM row: create time entry for the corresponding day
 * - Validate all data before importing
 * 
 * Returns result with counts and any errors
 */
export function importTimeData(userId: number, csvContent: string): ImportResult {
  const result: ImportResult = {
    success: true,
    daysImported: 0,
    itemsImported: 0,
    errors: [],
  };
  
  // Handle different line endings (Windows \r\n, Unix \n, or mixed)
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length === 0) {
    result.success = false;
    result.errors.push('File is empty');
    return result;
  }
  
  // Skip header row
  const dataLines = lines.slice(1);
  
  if (dataLines.length === 0) {
    result.success = false;
    result.errors.push('No data rows found');
    return result;
  }
  
  // Process each line
  for (let i = 0; i < dataLines.length; i++) {
    const lineNum = i + 2; // Line number in file (1-indexed, +1 for header)
    const line = dataLines[i];
    const fields = parseCSVLine(line);
    
    if (fields.length < 9) {
      result.errors.push(`Line ${lineNum}: Invalid format - expected 9 fields`);
      continue;
    }
    
    const [type, userIdStr, workday, daysumStr, startHour, endHour, jiratask, description, rowsumStr] = fields;
    
    // Validate type
    if (type !== 'DAY' && type !== 'ITEM') {
      result.errors.push(`Line ${lineNum}: Invalid type '${type}' - must be DAY or ITEM`);
      continue;
    }
    
    // Validate workday
    if (!isValidDate(workday)) {
      result.errors.push(`Line ${lineNum}: Invalid date '${workday}' - must be YYYY-MM-DD`);
      continue;
    }
    
    // Process DAY records
    if (type === 'DAY') {
      try {
        // Get or create day for the user
        getOrCreateDay(userId, workday);
        result.daysImported++;
      } catch (error) {
        result.errors.push(`Line ${lineNum}: Failed to create day - ${error}`);
      }
    }
    
    // Process ITEM records
    if (type === 'ITEM') {
      // Validate times
      if (!validateTime(startHour)) {
        result.errors.push(`Line ${lineNum}: Invalid start time '${startHour}'`);
        continue;
      }
      
      if (!validateTime(endHour)) {
        result.errors.push(`Line ${lineNum}: Invalid end time '${endHour}'`);
        continue;
      }
      
      try {
        // Get or create day
        const day = getOrCreateDay(userId, workday);
        
        // Note: Semicolons in text fields were used to avoid CSV parsing issues
        // during export. We don't restore them as original data may not have had commas.
        // This is a limitation of the simple CSV format.
        
        // Create item
        createDayItem(
          day.id,
          startHour,
          endHour,
          jiratask || null,
          description || null
        );
        
        result.itemsImported++;
      } catch (error) {
        result.errors.push(`Line ${lineNum}: Failed to create item - ${error}`);
      }
    }
  }
  
  // Set success based on whether we had any errors
  result.success = result.errors.length === 0;
  
  return result;
}
