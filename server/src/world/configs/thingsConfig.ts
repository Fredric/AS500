/**
 * Office Layout — objects in a space.
 *
 * This is where the loop closes. The same list both *places* an object and
 * *opens* it:
 *
 *   Enter on a bound object  → jumps into the config its binding names,
 *                              scoped exactly as the binding says.
 *   Enter on a container     → descends into that object's contents
 *                              (the furniture tree), in place.
 *   Esc                      → back up the furniture tree, then out.
 *
 * Both behaviours come from one `openUI` with a per-row target. The folder
 * descent is modelled directly on `app/configs/documentsConfig.ts`, which does
 * the same trick for `document_folders`.
 */

import type { CRUDContext, CRUDTableConfig } from '../../core/crudtable/types.js';
import type { Session } from '../../core/types/index.js';
import { PERMISSIONS } from '../../core/services/access.js';
import * as worldService from '../services/worldService.js';
import * as bindingPickers from '../bindingPickers.js';
import { THING_BINDING_KINDS, THING_TYPES, type ThingBinding } from '../types.js';

const svc = worldService as unknown as Record<string, Function>;
const pickers = bindingPickers as unknown as Record<string, Function>;

/** The binding stored on a list row. `listThings` returns it verbatim. */
function bindingOf(record: Record<string, unknown> | undefined): ThingBinding | null {
  if (!record) return null;
  return (record.binding as ThingBinding | null) ?? null;
}

export const thingsConfig: CRUDTableConfig = {
  id: 'world_things',
  title: 'Office Layout - Objects',
  requireAuth: true,
  requirePermission: PERMISSIONS.WORLD_READ,

  services: {
    list: {
      service: svc,
      method: 'listThings',
      params: (ctx) => ({
        spaceId: Number(ctx.input.spaceId),
        parentThingId: (ctx.input.parentThingId as number | null | undefined) ?? null,
      }),
    },
    read: {
      service: svc,
      method: 'readThing',
      params: (ctx) => ({ id: Number(ctx.editRecord?.id ?? ctx.input.id) }),
    },
    create: {
      service: svc,
      method: 'createThing',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        ...formToThingParams(ctx),
        spaceId: Number(ctx.input.spaceId),
        parentThingId: (ctx.input.parentThingId as number | null | undefined) ?? null,
      }),
    },
    update: {
      service: svc,
      method: 'updateThing',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({
        ...formToThingParams(ctx),
        id: ctx.editRecord!.id as number,
        spaceId: Number(ctx.input.spaceId),
        parentThingId: (ctx.input.parentThingId as number | null | undefined) ?? null,
      }),
    },
    delete: {
      service: svc,
      method: 'deleteThing',
      requirePermission: PERMISSIONS.WORLD_WRITE,
      params: (ctx) => ({ id: ctx.selection[0].id as number }),
    },
  },

  fieldConfigs: {
    label: {
      field: 'label',
      label: 'Label',
      length: 40,
      form: { required: true, hint: '(e.g. Invoices 2024)' },
      column: { width: 24 },
    },
    type: {
      field: 'type',
      label: 'Type',
      length: 14,
      staticOptions: THING_TYPES.map((t) => ({ value: t, display: t })),
      form: {
        required: true,
        hint: `(${THING_TYPES.slice(0, 6).join(', ')}, ...)`,
        // A 'bookshelf' may only bind to documents — cross-field, so it lives
        // here rather than on bindingKind, and it always runs because Type is
        // always visible.
        validators: [
          (ctx) => worldService.validateShelfBinding(
            ctx.values.type ?? '',
            ctx.values.bindingKind ?? 'none',
            ctx.values.bindingTarget ?? '',
          ),
          (ctx) => worldService.validateNoteBinding(
            ctx.values.type ?? '',
            ctx.values.bindingKind ?? 'none',
          ),
          (ctx) => worldService.validateDoorBinding(
            ctx.values.type ?? '',
            ctx.values.bindingKind ?? 'none',
          ),
        ],
      },
      column: { width: 11 },
    },
    zone: {
      field: 'zone',
      label: 'Zone',
      length: 20,
      form: { hint: '(e.g. north_east, server_room)' },
      column: { width: 12 },
    },
    slot: {
      field: 'slot',
      label: 'Slot',
      length: 20,
      form: { hint: '(position inside its parent, e.g. drawer_1)' },
    },
    x: {
      field: 'x',
      label: 'X',
      length: 6,
      type: 'numeric',
      form: { hint: '(renderer hint only)' },
    },
    y: {
      field: 'y',
      label: 'Y',
      length: 6,
      type: 'numeric',
      form: { hint: '(renderer hint only)' },
    },

    // ---- binding ----
    //
    // Three always-visible fields, never conditionally hidden. `form.visible`
    // cannot work here: the terminal only re-evaluates visibility on a server
    // round trip, so a field revealed by the value you are currently typing can
    // never appear. `Source` therefore carries whichever identifier the chosen
    // kind needs, and its dropdown tags each choice with the `Shows` value it
    // belongs to.
    //
    // Read it as a sentence:  Shows [a list of records]  Source [My Documents]
    //                         Filter [folder /ENTENCE/Contracts]
    //
    // The labels are plain words, but the field NAMES (bindingKind,
    // bindingTarget, bindingScope) and the kind values (crud, record, ...) are
    // unchanged: they are the REST/MCP contract, and the MCP tool schema is
    // generated from them (staticOptions become its enum). Hints are kept short
    // because the form is 80 columns wide and anything past that is cut off.
    bindingKind: {
      field: 'bindingKind',
      label: 'Shows',
      length: 12,
      // value = the stored kind; display = the kind plus what it means.
      staticOptions: THING_BINDING_KINDS.map((k) => ({
        value: k,
        display: `${k} - ${bindingPickers.BINDING_KIND_HELP[k]}`,
      })),
      form: {
        required: true,
        hint: '(what this object is a view of)',
        // Validated here rather than per-field: the rule spans Shows, Source
        // and Filter together, and this field is always visible so the check
        // always runs.
        validators: [
          (ctx) => worldService.validateBinding({
            bindingKind: ctx.values.bindingKind ?? 'none',
            bindingTarget: ctx.values.bindingTarget ?? '',
            bindingScope: ctx.values.bindingScope ?? '',
          }),
        ],
      },
      mcp: {
        description:
          'What the object is a view of: crud (a list of records), record (one ' +
          'record), service, workstation, agent, door (to another space) or none.',
      },
    },
    bindingTarget: {
      field: 'bindingTarget',
      label: 'Source',
      length: 24,
      datasource: {
        service: pickers,
        method: 'listBindingSources',
        valueField: 'id',
        displayField: 'title',
      },
      form: {
        hint: '(which one, see Shows)',
      },
      mcp: {
        description:
          'Which one the object points at: a config id (crud/record), a service ' +
          'key (service), an agent\'s user id (agent) or a space key (door).',
      },
    },
    bindingScope: {
      field: 'bindingScope',
      label: 'Filter',
      length: 32,
      datasource: {
        service: pickers,
        method: 'listBindingFilters',
        // The person editing the layout — a binding's scope can never name
        // another user's data.
        params: (ctx) => ({ userId: Number(ctx.input.userId) }),
        valueField: 'id',
        displayField: 'title',
      },
      form: {
        hint: '(blank = all)',
      },
      mcp: {
        description:
          'Narrows a crud list, e.g. "folderId=42" (a My Documents folder) or ' +
          '"motorcycleId=3"; for kind record it is the record id. Blank otherwise.',
      },
    },

    // ---- display-only ----
    boundTo: {
      field: 'boundTo',
      label: 'Bound to',
      length: 26,
      column: { width: 24 },
    },
    childCount: {
      field: 'childCount',
      label: 'Holds',
      length: 5,
      column: { width: 5, align: 'right' },
    },
  },

  columnBuilder: ['label', 'type', 'zone', 'boundTo', 'childCount'],
  formBuilder: [
    'label', 'type', 'zone', 'slot', 'x', 'y',
    'bindingKind', 'bindingTarget', 'bindingScope',
  ],

  getInitialValues: () => ({ type: 'box', bindingKind: 'none' }),

  // Source and Filter list live data (spaces, agents, folders, motorcycles), but
  // a datasource is cached in the session context for as long as the screen
  // stays open. Dropping them on every list render means a folder made a minute
  // ago is in the next form you open; the loader refills them straight after.
  onBeforeListRender: async (_session, ctx) => {
    delete ctx.datasources.bindingTarget;
    delete ctx.datasources.bindingScope;
  },

  navigation: {
    primaryAction: 'open',
    shortcuts: [{ key: 'c', option: '2', label: 'Change' }],
  },

  listStatusHints: ['Enter=Open', 'C=Change'],

  /**
   * Enter resolves per row:
   *   bound to a config → open that config, scoped by the binding
   *   anything else     → descend into this object's contents, in place
   */
  openUI: {
    id: (ctx) => {
      const rec = ctx.selection[0];
      const b = bindingOf(rec);
      if (b && (b.kind === 'crud' || b.kind === 'record')) return b.configId;
      // A postit/board owns its own text (Phase 2) rather than binding to a
      // config — it has no children to descend into either, so it opens its
      // note record directly instead of falling through to "descend".
      if (rec && (rec.type === 'postit' || rec.type === 'board')) return 'world_notes';
      return 'world_things';
    },

    mapContext: (ctx) => {
      const rec = ctx.selection[0];
      if (!rec) return { input: ctx.input, skipNavigation: true };

      const b = bindingOf(rec);

      // --- open the owned note ---
      if (rec.type === 'postit' || rec.type === 'board') {
        return { input: { thingId: rec.id, userId: ctx.input.userId }, pageOffset: 0 };
      }

      // --- open the binding ---
      if (b && b.kind === 'crud') {
        // userId is NOT taken from the binding: the resolver and the terminal
        // must agree that scope can never name another user's data.
        return { input: { ...(b.scope ?? {}), userId: ctx.input.userId }, pageOffset: 0 };
      }

      if (b && b.kind === 'record') {
        return { input: { id: b.recordId, userId: ctx.input.userId }, pageOffset: 0 };
      }

      // --- walk through a door (same screen, space change) ---
      //
      // A door doesn't leave this screen, it re-scopes it — exactly like
      // descending into a container does, just one level higher (spaces
      // instead of the furniture tree within one). `spaceStack` remembers
      // where you came from so Esc (onListBack, below) can climb back out
      // the same way it already climbs the furniture tree.
      if (b && b.kind === 'door') {
        const stack = Array.isArray(ctx.input.spaceStack) ? (ctx.input.spaceStack as unknown[]) : [];
        return {
          input: {
            ...ctx.input,
            spaceId: b.spaceId,
            spaceLabel: b.spaceName,
            parentThingId: null,
            parentLabel: '',
            spaceStack: [...stack, { spaceId: ctx.input.spaceId, spaceLabel: ctx.input.spaceLabel }],
          },
          pageOffset: 0,
        };
      }

      // --- descend into contents (same screen, scope change) ---
      return {
        input: {
          ...ctx.input,
          parentThingId: rec.id as number,
          parentLabel: String(rec.label ?? ''),
        },
        pageOffset: 0,
      };
    },
  },

  /**
   * Esc walks back up the furniture tree first, then back out through any
   * doors walked through to get here, and only then leaves the screen —
   * the two stacks nest in that order because a door re-scopes the SAME
   * screen a furniture descent does, one level higher.
   */
  onListBack: async (_session, ctx) => {
    const parentThingId = (ctx.input.parentThingId as number | null | undefined) ?? null;
    if (parentThingId !== null) {
      const parent = await worldService.getThing(parentThingId);
      ctx.input.parentThingId = parent?.parentThingId ?? null;
      ctx.input.parentLabel = '';
      ctx.pageOffset = 0;
      return 'handled';
    }

    const stack = Array.isArray(ctx.input.spaceStack)
      ? (ctx.input.spaceStack as Array<{ spaceId: number; spaceLabel: string }>)
      : [];
    if (stack.length > 0) {
      const previous = stack[stack.length - 1];
      ctx.input.spaceId = previous.spaceId;
      ctx.input.spaceLabel = previous.spaceLabel;
      ctx.input.spaceStack = stack.slice(0, -1);
      ctx.input.parentThingId = null;
      ctx.input.parentLabel = '';
      ctx.pageOffset = 0;
      return 'handled';
    }

    return 'pop';
  },

  /** Changes when the caller descends, so the client resets row focus. */
  listContextKey: (ctx) => `${ctx.input.spaceId}:${ctx.input.parentThingId ?? 'root'}`,

  listHeader: (ctx) => {
    const space = String(ctx.input.spaceLabel ?? '');
    const parent = String(ctx.input.parentLabel ?? '');
    const where = parent ? `${space} / ${parent}` : space || '(space)';
    return [{ row: 5, col: 2, content: `In: ${where.slice(0, 70)}` }];
  },

  mcp: {
    name: 'world_things',
    description:
      'Objects placed in a room of the AS500 virtual office — desks, cabinets, ' +
      'drawers, boxes, racks, boards. Each object may carry a binding saying ' +
      'what AS500 data it is a view of: bindingKind "crud" with bindingTarget set to ' +
      'a config id and bindingScope to that list\'s scope (e.g. "folderId=42") makes ' +
      'the object a window onto that list. bindingTarget also carries the service ' +
      'key for kind "service", the user id for kind "agent", and the destination ' +
      'space\'s key for kind "door". Objects nest via parentThingId, which is the ' +
      'furniture tree, NOT the data hierarchy. Placing an object never copies data. ' +
      'A type "bookshelf" must bind to the "documents" config — it shows one book ' +
      'per subfolder, derived live, never stored as separate objects. Types "postit" ' +
      'and "board" are the exception: they must have bindingKind "none" and instead ' +
      'own their own text via the world_notes tool, scoped by this object\'s own id ' +
      'as thingId. A type "door" must have bindingKind "door" (and only a "door" ' +
      'may) — entering it re-scopes this same tool\'s spaceId to the target space, ' +
      'the same way descending into a container re-scopes parentThingId.',
    operations: { list: true, read: true, create: true, update: true, delete: true },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the OAuth token — not a tool input.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'spaceId',
        type: 'number' as const,
        required: true,
        description: 'Id of the space whose objects to operate on (see world_spaces).',
      },
      {
        name: 'parentThingId',
        type: 'number' as const,
        required: false,
        description: 'Id of the containing object. Omit for the top level of the space.',
      },
    ],
  },

  api: {
    name: 'world_things',
    description: 'Objects placed in a room of the AS500 virtual office.',
    operations: { list: true, read: true, create: true, update: true, delete: true },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the Bearer token — never a request param.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'spaceId',
        type: 'number' as const,
        required: true,
        description: 'Id of the space — pass as ?spaceId=…',
      },
      {
        name: 'parentThingId',
        type: 'number' as const,
        required: false,
        description: 'Containing object id — pass as ?parentThingId=…',
      },
    ],
  },
};

/** Collect the binding + placement fields the service expects from the form. */
function formToThingParams(ctx: CRUDContext) {
  return {
    userId: ctx.input.userId as number,
    type: ctx.values.type ?? '',
    label: ctx.values.label ?? '',
    slot: ctx.values.slot ?? '',
    zone: ctx.values.zone ?? '',
    x: ctx.values.x ?? '',
    y: ctx.values.y ?? '',
    bindingKind: ctx.values.bindingKind ?? 'none',
    bindingTarget: ctx.values.bindingTarget ?? '',
    bindingScope: ctx.values.bindingScope ?? '',
  };
}

export function initThingsContext(session: Session): void {
  session.context.crud_world_things_input = {
    userId: session.viserId,
    spaceId: null,
    parentThingId: null,
  };
  session.context.crud_world_things_pageOffset = 0;
}
