// TIME_REG Screen - Time Registration Subfile
// Shows time entries for a day with options to add/edit/delete

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { mainMenuScreen } from './mainMenu.js';
import { buildTimeEntryScreen } from './timeEntry.js';
import { timeRegHelpScreen } from './timeRegHelp.js';
import {
  defineScreen,
  render,
  header,
  text,
  subfile,
  field,
} from '../dsl/index.js';
import {
  getOrCreateDay,
  getDayItems,
  deleteDayItem,
  getDayName,
  formatHours,
  getPreviousDay,
  getNextDay,
  type Day,
  type DayItem,
} from '../services/timeReg.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const TIME_REG_SCREEN = defineScreen('TIME_REG', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'TIME REGISTRATION', showDateTime: true, showUser: true }),

    // Date display line (row 5)
    text(5, 2, 'Date:'),
    // Date value and day name will be rendered dynamically

    // Subfile for time entries
    subfile('entries', 7, 10, [
      { header: 'Opt', field: 'opt', width: 3, type: 'alpha' },
      { header: 'Start', key: 'start_hour', width: 5 },
      { header: 'End', key: 'end_hour', width: 5 },
      { header: 'Hours', key: 'rowsum', width: 5, align: 'right' },
      { header: 'Task', key: 'jiratask', width: 11 },
      { header: 'Description', key: 'description', width: 30 },
    ]),
  ],
  statusLine: 'F3=Exit  F6=Add  F7=Prev  F8=Next  PageUp/PageDn=Scroll  F12=Cancel  F1=Help',
  defaultCursor: 'opt_0',
});

// ============================================
// Screen Builder
// ============================================

export async function buildTimeRegScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const userId = session.viserId!;

  // Get current date from context or use today
  const currentDate = (session.context.timeRegDate as string) || new Date().toISOString().split('T')[0];

  // Get or create day record
  const day = await getOrCreateDay(userId, currentDate);

  // Get time entries
  const items = await getDayItems(day.id);

  // Store day info in context
  session.context.timeRegDate = currentDate;
  session.context.timeRegDayId = day.id;

  // Get page offset from context (default to 0)
  const pageOffset = (session.context.timeRegPageOffset as number) || 0;

  // Format items for subfile display
  const entries = items.map((item, index) => ({
    id: item.id,
    start_hour: item.start_hour,
    end_hour: item.end_hour,
    rowsum: formatHours(item.rowsum),
    jiratask: item.jiratask || '',
    description: item.description || '',
  }));

  // Render the screen with context (including page offset)
  const result = render(TIME_REG_SCREEN, { entries, entries_offset: pageOffset }, {
    message,
    messageType,
    user: session.username || 'UNKNOWN'
  });

  // Add dynamic date info to the rendered rows
  const dayName = getDayName(currentDate);
  const dayTotal = formatHours(day.daysum);

  // Modify row 5 to include date and total
  const dateInfo = `Date: ${currentDate}  ${dayName}`;
  const totalInfo = `Day total: ${dayTotal} hrs`;

  // Build the date line
  let row5 = result.rows[5].split('');
  // Write date info starting at col 2
  for (let i = 0; i < dateInfo.length && i + 2 < 80; i++) {
    row5[i + 2] = dateInfo[i];
  }
  // Write total info at right side (col 55)
  for (let i = 0; i < totalInfo.length && i + 55 < 80; i++) {
    row5[i + 55] = totalInfo[i];
  }
  result.rows[5] = row5.join('');

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
  };
}

// ============================================
// Screen Handler
// ============================================

export async function handleTimeReg(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // F3 - Exit to main menu
  if (request.key === 'F3') {
    session.currentScreen = 'MAIN_MENU';
    session.screenStack = session.screenStack.filter(s => s !== 'TIME_REG');
    // Clear time reg context
    delete session.context.timeRegDate;
    delete session.context.timeRegDayId;
    delete session.context.editItemId;
    delete session.context.timeRegPageOffset;

    return {
      ...mainMenuScreen(session),
      ...base,
    };
  }

  // F12 - Cancel (same as F3 for this screen)
  if (request.key === 'F12') {
    session.currentScreen = 'MAIN_MENU';
    session.screenStack = session.screenStack.filter(s => s !== 'TIME_REG');
    delete session.context.timeRegDate;
    delete session.context.timeRegDayId;
    delete session.context.editItemId;
    delete session.context.timeRegPageOffset;

    return {
      ...mainMenuScreen(session),
      ...base,
    };
  }

  // F6 - Add new entry
  if (request.key === 'F6') {
    session.screenStack.push('TIME_REG');
    session.currentScreen = 'TIME_ENTRY';
    session.context.editItemId = null; // New entry mode

    return {
      ...(await buildTimeEntryScreen(session)),
      ...base,
    };
  }

  // F7 - Previous day
  if (request.key === 'F7') {
    const currentDate = session.context.timeRegDate as string;
    session.context.timeRegDate = getPreviousDay(session.viserId!, currentDate);
    session.context.timeRegPageOffset = 0; // Reset to first page

    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // F8 - Next day
  if (request.key === 'F8') {
    const currentDate = session.context.timeRegDate as string;
    session.context.timeRegDate = getNextDay(currentDate);
    session.context.timeRegPageOffset = 0; // Reset to first page

    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // F1 - Help
  if (request.key === 'F1') {
    return {
      ...timeRegHelpScreen(session),
      ...base,
    };
  }

  // PAGEDOWN - Scroll down in subfile
  if (request.key === 'PAGEDOWN') {
    const dayId = session.context.timeRegDayId as number;
    const items = await getDayItems(dayId);
    const pageSize = 10; // Match the subfile pageSize
    const currentOffset = (session.context.timeRegPageOffset as number) || 0;
    const maxOffset = Math.max(0, items.length - pageSize);
    
    // Move to next page (don't go beyond the last page)
    session.context.timeRegPageOffset = Math.min(currentOffset + pageSize, maxOffset);

    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // PAGEUP - Scroll up in subfile
  if (request.key === 'PAGEUP') {
    const currentOffset = (session.context.timeRegPageOffset as number) || 0;
    const pageSize = 10; // Match the subfile pageSize
    
    // Move to previous page (don't go below 0)
    session.context.timeRegPageOffset = Math.max(0, currentOffset - pageSize);

    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // ENTER - Process option selections
  if (request.key === 'ENTER') {
    const dayId = session.context.timeRegDayId as number;
    const items = await getDayItems(dayId);

    // Check each opt field for input
    for (let i = 0; i < items.length; i++) {
      const opt = request.input[`opt_${i}`]?.trim();

      if (opt === '2') {
        // Edit - go to TIME_ENTRY with item ID
        session.screenStack.push('TIME_REG');
        session.currentScreen = 'TIME_ENTRY';
        session.context.editItemId = items[i].id;

        return {
          ...(await buildTimeEntryScreen(session)),
          ...base,
        };
      }

      if (opt === '4') {
        // Delete entry
        const deleted = await deleteDayItem(items[i].id);

        if (deleted) {
          return {
            ...(await buildTimeRegScreen(session, 'Entry deleted', 'info')),
            ...base,
            fieldValues: {}, // Clear all field values after successful deletion
          };
        } else {
          return {
            ...(await buildTimeRegScreen(session, 'Failed to delete entry', 'error')),
            ...base,
            // Keep field values on failure so user can see what they tried
          };
        }
      }



      if (opt && opt !== '') {
        // Invalid option
        return {
          ...(await buildTimeRegScreen(session, `Invalid option '${opt}'. Use 2=Edit, 4=Delete`, 'error')),
          ...base,
        };
      }
    }

    // No option entered - just refresh
    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // Default - show screen
  return {
    ...(await buildTimeRegScreen(session)),
    ...base,
  };
}
