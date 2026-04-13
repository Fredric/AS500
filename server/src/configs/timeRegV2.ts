// Time Registration V2 - CRUDTable Config
// Equivalent to screens/timeReg.ts + screens/timeEntry.ts using the CRUDTable system

import type { CRUDTableConfig } from '../crudtable/types.js';
import type { Session } from '../types/index.js';
import * as timeRegCrud from '../services/timeRegCrud.js';

export const timeRegV2Config: CRUDTableConfig = {
  id: 'timereg_v2',
  title: 'Time Registration',
  requireAuth: true,
  requirePermission: 'time_reg:read',

  // ============================================
  // Services
  // ============================================

  services: {
    list: {
      service: timeRegCrud,
      method: 'listEntries',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        date: ctx.input.date as string,
      }),
    },

    create: {
      service: timeRegCrud,
      method: 'createEntry',
      requirePermission: 'time_reg:write',
      params: (ctx) => ({
        dayId: ctx.input.dayId as number,
        start_hour: ctx.values.start_hour,
        end_hour: ctx.values.end_hour,
        jiratask: ctx.values.jiratask || null,
        description: ctx.values.description || null,
      }),
    },

    update: {
      service: timeRegCrud,
      method: 'updateEntry',
      requirePermission: 'time_reg:write',
      params: (ctx) => ({
        itemId: ctx.editRecord!.id as number,
        start_hour: ctx.values.start_hour,
        end_hour: ctx.values.end_hour,
        jiratask: ctx.values.jiratask || null,
        description: ctx.values.description || null,
      }),
    },

    delete: {
      service: timeRegCrud,
      method: 'deleteEntry',
      requirePermission: 'time_reg:write',
      params: (ctx) => ctx.selection[0].id as number,
    },
  },

  // ============================================
  // Field Configs
  // ============================================

  fieldConfigs: {
    start_hour: {
      field: 'start_hour',
      label: 'Start',
      length: 5,
      form: {
        required: true,
        hint: '(HH:MM)',
      },
      column: { width: 5 },
    },

    end_hour: {
      field: 'end_hour',
      label: 'End',
      length: 5,
      form: {
        required: true,
        hint: '(HH:MM)',
      },
      column: { width: 5 },
    },

    rowsum: {
      field: 'rowsum',
      label: 'Hours',
      length: 5,
      column: { width: 5, align: 'right' },
    },

    jiratask: {
      field: 'jiratask',
      label: 'Task ID',
      length: 11,
      form: { uppercase: true },
      column: { width: 11 },
      datasource: {
        service: timeRegCrud,
        method: 'listJiraTasks',
        valueField: 'id',
        displayField: 'name',
      }
    },

    description: {
      field: 'description',
      label: 'Description',
      length: 30,
      column: { width: 30 },
    },
  },

  columnBuilder: ['start_hour', 'end_hour', 'rowsum', 'jiratask', 'description'],
  formBuilder: ['start_hour', 'end_hour', 'jiratask', 'description'],

  // ============================================
  // Dynamic List Header (date + day total)
  // ============================================

  listHeader: (ctx) => {
    const date = ctx.input.date as string;
    const dayName = timeRegCrud.getDayName(date);
    const records = ctx.records;
    const daysum = records.length > 0
      ? (records[0]._daysum as number) ?? 0
      : 0;

    return [
      { row: 5, col: 2, content: `Date: ${date}  ${dayName}` },
      { row: 5, col: 55, content: `Day total: ${timeRegCrud.formatHours(daysum)} hrs` },
    ];
  },

  // ============================================
  // Custom F-Keys (day navigation)
  // ============================================

  listKeys: {
    F7: {
      label: 'Prev',
      handler: async (ctx, session) => {
        const currentDate = ctx.input.date as string;
        const userId = ctx.input.userId as number;
        ctx.input.date = timeRegCrud.getPreviousDay(userId, currentDate);
        ctx.pageOffset = 0;

        // Update dayId for create
        const day = await timeRegCrud.getOrCreateDay(userId, ctx.input.date as string);
        ctx.input.dayId = day.id;
      },
    },

    F8: {
      label: 'Next',
      handler: async (ctx, session) => {
        const currentDate = ctx.input.date as string;
        const userId = ctx.input.userId as number;
        ctx.input.date = timeRegCrud.getNextDay(currentDate);
        ctx.pageOffset = 0;

        // Update dayId for create
        const day = await timeRegCrud.getOrCreateDay(userId, ctx.input.date as string);
        ctx.input.dayId = day.id;
      },
    },
  },
};

/**
 * Initialize the CRUDContext for time registration.
 * Call this when navigating to the CRUD_TIMEREG_V2 screen.
 */
export async function initTimeRegV2Context(session: Session): Promise<void> {
  const userId = session.viserId!;
  const date = new Date().toISOString().split('T')[0];
  const day = await timeRegCrud.getOrCreateDay(userId, date);

  session.context.crud_timereg_v2_input = {
    userId,
    date,
    dayId: day.id,
  };
}
