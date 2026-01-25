// TIME_ENTRY Screen - Add/Edit Time Entry Form
// Form for entering or modifying a single time entry

import type { Session, ClientRequest, ScreenResponse } from '../types/index.js';
import { buildTimeRegScreen } from './timeReg.js';
import {
  defineScreen,
  render,
  header,
  text,
  form,
  field,
} from '../dsl/index.js';
import {
  getDayItem,
  createDayItem,
  updateDayItem,
  isValidTime,
  getDayName,
  type DayItem,
} from '../services/timeReg.js';

// ============================================
// Screen Definition (Logical)
// ============================================

const TIME_ENTRY_SCREEN = defineScreen('TIME_ENTRY', {
  elements: [
    header({ system: 'AS500 SYSTEM', title: 'TIME ENTRY', showDateTime: true, showUser: true }),

    // Date display (row 5) - will be populated dynamically
    text(5, 2, 'Date:'),

    // Entry form
    form(8, [
      ['Start time . . :', field('start_hour', 5, 'alpha', { required: true })],
      ['End time . . . :', field('end_hour', 5, 'alpha', { required: true })],
      ['Task ID  . . . :', field('jiratask', 11, 'alpha', { uppercase: true })],
      ['Description  . :', field('description', 30, 'alpha')],
    ], {
      labelCol: 8,
      fieldCol: 27,
    }),

    // Format hints
    text(8, 34, '(HH:MM)'),
    text(9, 34, '(HH:MM)'),
  ],
  statusLine: 'F3=Exit  F12=Cancel',
  defaultCursor: 'start_hour',
});

// ============================================
// Screen Builder
// ============================================

export async function buildTimeEntryScreen(
  session: Session,
  message: string | null = null,
  messageType: 'info' | 'warning' | 'error' | null = null
): Promise<Omit<ScreenResponse, 'sessionId'>> {
  const currentDate = session.context.timeRegDate as string;
  const editItemId = session.context.editItemId as number | null;

  // Get existing item data if editing
  let contextData: Record<string, string> = {};

  if (editItemId) {
    const item = await getDayItem(editItemId);
    if (item) {
      contextData = {
        start_hour: item.start_hour,
        end_hour: item.end_hour,
        jiratask: item.jiratask || '',
        description: item.description || '',
      };
    }
  }

  // Render the screen
  const result = render(TIME_ENTRY_SCREEN, contextData, {
    message,
    messageType,
    user: session.username || 'UNKNOWN',
  });

  // Add dynamic date info to row 5
  const dayName = getDayName(currentDate);
  const dateInfo = `Date: ${currentDate}  ${dayName}`;

  let row5 = result.rows[5].split('');
  for (let i = 0; i < dateInfo.length && i + 2 < 80; i++) {
    row5[i + 2] = dateInfo[i];
  }
  result.rows[5] = row5.join('');

  // Update title for edit mode
  if (editItemId) {
    const titleRow = 3;
    const editTitle = 'EDIT TIME ENTRY';
    const titleStart = Math.floor((80 - editTitle.length) / 2);
    let row3 = result.rows[titleRow].split('');
    for (let i = 0; i < editTitle.length; i++) {
      row3[titleStart + i] = editTitle[i];
    }
    result.rows[titleRow] = row3.join('');
  }

  return {
    screenId: result.screenId,
    cursor: result.cursor,
    rows: result.rows,
    fields: result.fields,
    fieldValues: Object.keys(contextData).length > 0 ? contextData : undefined,
    message: result.message,
    messageType: result.messageType,
    statusLine: result.statusLine,
    bell: result.bell,
  };
}

// ============================================
// Screen Handler
// ============================================

export async function handleTimeEntry(
  session: Session,
  request: ClientRequest
): Promise<ScreenResponse> {
  const base = { sessionId: session.id };

  // F3 or F12 - Cancel and return to TIME_REG
  if (request.key === 'F3' || request.key === 'F12') {
    session.currentScreen = 'TIME_REG';
    session.screenStack = session.screenStack.filter(s => s !== 'TIME_ENTRY');
    delete session.context.editItemId;

    return {
      ...(await buildTimeRegScreen(session)),
      ...base,
    };
  }

  // ENTER - Save entry
  if (request.key === 'ENTER') {
    const startHour = request.input['start_hour']?.trim() || '';
    const endHour = request.input['end_hour']?.trim() || '';
    const jiratask = request.input['jiratask']?.trim() || null;
    const description = request.input['description']?.trim() || null;

    // Validate required fields
    if (!startHour) {
      return {
        ...(await buildTimeEntryScreen(session, 'Start time is required', 'error')),
        ...base,
      };
    }

    if (!endHour) {
      return {
        ...(await buildTimeEntryScreen(session, 'End time is required', 'error')),
        ...base,
      };
    }

    // Validate time format
    if (!isValidTime(startHour)) {
      return {
        ...(await buildTimeEntryScreen(session, 'Invalid start time format. Use HH:MM', 'error')),
        ...base,
      };
    }

    if (!isValidTime(endHour)) {
      return {
        ...(await buildTimeEntryScreen(session, 'Invalid end time format. Use HH:MM', 'error')),
        ...base,
      };
    }

    // Validate end > start (simple check, doesn't handle midnight crossing)
    if (endHour <= startHour) {
      return {
        ...(await buildTimeEntryScreen(session, 'End time must be after start time', 'error')),
        ...base,
      };
    }

    const dayId = session.context.timeRegDayId as number;
    const editItemId = session.context.editItemId as number | null;

    try {
      if (editItemId) {
        // Update existing
        await updateDayItem(editItemId, startHour, endHour, jiratask, description);
      } else {
        // Create new
        await createDayItem(dayId, startHour, endHour, jiratask, description);
      }

      // Return to TIME_REG with success message
      session.currentScreen = 'TIME_REG';
      session.screenStack = session.screenStack.filter(s => s !== 'TIME_ENTRY');
      delete session.context.editItemId;

      const msg = editItemId ? 'Entry updated' : 'Entry added';

      return {
        ...(await buildTimeRegScreen(session, msg, 'info')),
        ...base,
      };
    } catch (error) {
      console.error('Error saving time entry:', error);
      return {
        ...(await buildTimeEntryScreen(session, 'Error saving entry', 'error')),
        ...base,
      };
    }
  }

  // Default - show screen
  return {
    ...(await buildTimeEntryScreen(session)),
    ...base,
  };
}
