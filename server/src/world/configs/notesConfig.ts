/**
 * The payload behind a `type: 'postit'`/`'board'` thing.
 *
 * Scoped by `thingId` exactly the way `documentsConfig` is scoped by
 * `folderId` — the list always returns 0 or 1 row (a note belongs to exactly
 * one thing), and create/update both resolve their target from
 * `ctx.input.thingId`, never from the row's own `id`, so this behaves as an
 * upsert regardless of whether a note exists yet.
 *
 * Reached only via `openUI` from a `postit`/`board` row in `thingsConfig` —
 * never listed in a menu of its own, the same way `documents` is only reached
 * through a bound drawer.
 */

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import { PERMISSIONS } from '../../core/services/access.js';
import * as notesService from '../services/notesService.js';

const svc = notesService as unknown as Record<string, Function>;

const COLOR_OPTIONS = ['yellow', 'pink', 'blue', 'green'].map((c) => ({ value: c, display: c }));

export const notesConfig: CRUDTableConfig = {
  id: 'world_notes',
  title: 'Office Layout - Note',
  requireAuth: true,
  requirePermission: PERMISSIONS.WORLD_READ,

  services: {
    list: {
      service: svc,
      method: 'listNotes',
      params: (ctx) => ({ thingId: Number(ctx.input.thingId) }),
    },
    read: {
      service: svc,
      method: 'readNote',
      params: (ctx) => ({ thingId: Number(ctx.input.thingId) }),
    },
    create: {
      // Deliberately updateNote, not createNote: the list is scoped by
      // thingId and shows 0 or 1 row, but nothing stops a user pressing F6
      // (Create) when a note already exists — most likely the seeded one on
      // a postit they haven't touched yet. createNote would hit thing_id's
      // unique constraint and surface a raw DB error; updateNote's
      // create-if-absent upsert makes F6 behave the same as editing the
      // existing row either way, which is what the user actually wants.
      service: svc,
      method: 'updateNote',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        thingId: Number(ctx.input.thingId),
        body: ctx.values.body ?? '',
        color: ctx.values.color ?? 'yellow',
      }),
    },
    update: {
      service: svc,
      method: 'updateNote',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        thingId: Number(ctx.input.thingId),
        body: ctx.values.body ?? '',
        color: ctx.values.color ?? 'yellow',
      }),
    },
  },

  fieldConfigs: {
    body: {
      field: 'body',
      label: 'Text',
      // The terminal's real ceiling — a longer note is typed in the
      // graphical client's textarea instead (SET_NOTE over the :3006 socket),
      // the same "terminal is the floor, browser is the ceiling" split the
      // bookshelf modal uses for arbitrary-depth browsing.
      length: 70,
      form: { hint: '(longer notes: edit from the office floorplan panel)' },
      column: { width: 40 },
    },
    color: {
      field: 'color',
      label: 'Color',
      length: 8,
      staticOptions: COLOR_OPTIONS,
      form: { hint: '(yellow, pink, blue, green)' },
      column: { width: 8 },
    },
  },

  columnBuilder: ['body', 'color'],
  formBuilder: ['body', 'color'],

  getInitialValues: () => ({ color: 'yellow' }),

  mcp: {
    name: 'world_notes',
    description:
      'The text on a postit or whiteboard placed in the AS500 virtual office. ' +
      'Scoped by thingId (see world_things) — each postit/board owns exactly one ' +
      'note, created the first time it is written to.',
    operations: { list: true, read: true, create: true, update: true, delete: false },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the OAuth token — not a tool input.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'thingId',
        type: 'number' as const,
        required: true,
        description: 'Id of the postit/board thing this note belongs to (see world_things).',
      },
    ],
  },

  api: {
    name: 'world_notes',
    description: 'The text on a postit or whiteboard in the AS500 virtual office.',
    operations: { list: true, read: true, create: true, update: true, delete: false },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the Bearer token — never a request param.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'thingId',
        type: 'number' as const,
        required: true,
        description: 'Id of the postit/board thing — pass as ?thingId=…',
      },
    ],
  },
};
