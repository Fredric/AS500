// Header Component
// Standard screen header with system name, title, date/time, and user

import type { HeaderElement } from '../types.js';

export interface HeaderOptions {
  system?: string;
  title?: string;
  showDateTime?: boolean;
  showUser?: boolean;
}

/**
 * Create a standard screen header
 * The header renders as:
 * Row 0: "  SYSTEM NAME                                    YYYY-MM-DD  HH:MM"
 * Row 1: "═══════════════════════════════════════════════════════════════════════════════"
 * Row 2: (blank)
 * Row 3: "                          TITLE                          User: USERNAME"
 * 
 * @param options - Header configuration
 */
export function header(options: HeaderOptions = {}): HeaderElement {
  return {
    kind: 'header',
    system: options.system ?? 'AS500 SYSTEM',
    title: options.title,
    showDateTime: options.showDateTime ?? true,
    showUser: options.showUser ?? true,
  };
}

/**
 * Get current date/time formatted for header
 * Returns "YYYY-MM-DD  HH:MM"
 */
export function getDateTime(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);
  return `${date}  ${time}`;
}

/**
 * Render header element to rows
 * Called by the main renderer
 */
export function renderHeader(
  element: HeaderElement,
  context: { user?: string }
): { rows: Array<{ row: number; col: number; content: string }> } {
  const result: Array<{ row: number; col: number; content: string }> = [];
  
  // Row 0: System name + date/time
  let row0 = `  ${element.system || 'AS500 SYSTEM'}`;
  if (element.showDateTime) {
    const dateTime = getDateTime();
    // Pad to position date/time at the right
    const padding = 80 - row0.length - dateTime.length;
    row0 = row0 + ' '.repeat(Math.max(1, padding)) + dateTime;
  }
  result.push({ row: 0, col: 0, content: row0 });
  
  // Row 1: Separator line
  result.push({ row: 1, col: 0, content: '═'.repeat(80) });
  
  // Row 3: Title + User (if provided)
  if (element.title || element.showUser) {
    let row3Content = '';
    
    if (element.title) {
      // Center the title
      const titlePadding = Math.floor((80 - element.title.length) / 2);
      row3Content = ' '.repeat(titlePadding) + element.title;
    }
    
    if (element.showUser && context.user) {
      const userText = `User: ${context.user}`;
      // Position user info at the right side
      const currentLength = row3Content.length;
      const padding = 80 - currentLength - userText.length;
      if (padding > 0) {
        row3Content = row3Content + ' '.repeat(padding) + userText;
      }
    }
    
    if (row3Content) {
      result.push({ row: 3, col: 0, content: row3Content });
    }
  }
 console.log(result);
  return { rows: result };
}
