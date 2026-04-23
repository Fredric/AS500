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

    // Fetch a single entry by primary key. Used by the MCP runtime for
    // `timereg_v2.read`, and to resolve `editRecord` / `selection[0]` when
    // agents call update / delete. See `readEntry` in timeRegCrud.ts.
    read: {
      service: timeRegCrud,
      method: 'readEntry',
      params: (ctx) => ({ id: ctx.input.id as number }),
    },

    create: {
      service: timeRegCrud,
      method: 'createEntry',
      requirePermission: 'time_reg:write',
      params: async (ctx) => {
        const dayId =
          (ctx.input.dayId as number | undefined) ??
          (await timeRegCrud.getOrCreateDay(ctx.input.userId as number, ctx.input.date as string)).id;
        return {
          dayId,
          start_hour: ctx.values.start_hour,
          end_hour: ctx.values.end_hour,
          jiratask: ctx.values.jiratask || null,
          description: ctx.values.description || null,
        };
      },
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
      /*datasource: {
        service: timeRegCrud,
        method: 'listJiraTasks',
        valueField: 'id',
        displayField: 'name',
      }*/
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

  // ============================================
  // MCP (Model Context Protocol) exposure
  // ============================================
  //
  // Canonical reference config for remote MCP. Once the MCP server ships, this
  // surfaces five tools to authorized external agents:
  //
  //   timereg_v2.list     timereg_v2.read
  //   timereg_v2.create   timereg_v2.update   timereg_v2.delete
  //
  // Permission enforcement is inherited from the existing ServiceCall blocks
  // (`time_reg:read` at config level, `time_reg:write` on mutations) — the
  // MCP runtime re-checks them per call, bound to the OAuth'd user.
  //
  // `scope` carries the per-tool params that replace the in-process context
  // seeded by `initTimeRegV2Context`. Agents must pass `date`; `userId` is
  // automatically injected from the OAuth token so agents can only ever access
  // their own time entries. `dayId` is derived server-side inside the
  // synthesized context.

  mcp: {
    name: 'timereg',
    description:
      'Time registration entries for the authenticated user on a given workday. ' +
      'Each record is a single time slot (start_hour, end_hour) optionally tagged ' +
      'with a Jira task id and description. Hours are computed server-side.',
    operations: {
      list: true,
      read: true,
      create: true,
      update: true,
      delete: true,
    },
    scope: [
      {
        name: 'userId',
        type: 'number',
        required: true,
        description:
          'Automatically injected from the OAuth token — not a tool input. ' +
          'Always resolves to the authenticated user\'s own id.',
        injectFromAuth: 'userId',
      },
      {
        name: 'date',
        type: 'string',
        required: true,
        description: 'Workday in YYYY-MM-DD format. A day row is created on demand.',
      },
    ],
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
