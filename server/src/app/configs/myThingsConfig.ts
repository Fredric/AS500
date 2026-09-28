// My Things CRUDTable Config
//
// A Thing is a real-world object the user photographed. The source photo is
// sent to a local-GPU Qwen worker which returns an isometric sprite on a
// transparent background, so the object can later stand in the virtual office.
//
// The green screen cannot show the images; it manages the metadata and shows
// how far along a generation is. The pictures are for the phone, the office
// and any other graphical surface.
//
// Things can be organized into folders — a separate tree from My Documents'
// (see documentsConfig.ts, whose folder browser this mirrors). Folders are
// organizational only for now; nothing renders them yet. The single `create`
// operation is dedicated to folders, exactly as it is in documentsConfig: a
// Thing itself is only ever created via the phone's photo upload, never
// through this generic create form.

import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import type { Session } from '../../core/types/index.js';
import * as thingService from '../services/thingService.js';
import { McpToolError } from '../../core/mcp/errors.js';

function toStringOrNull(s: string | undefined): string | null {
  if (!s || s.trim() === '') return null;
  return s.trim();
}

function displayName(_ctx: unknown, record: Record<string, unknown>): string {
  if (record.kind === 'parent') return '← ..';
  if (record.kind === 'folder') return `[Folder] ${String(record.name ?? '')}`;
  return String(record.name ?? '');
}

export const myThingsConfig: CRUDTableConfig = {
  id: 'my_things',
  title: 'My Things',
  requireAuth: true,
  requirePermission: 'things:read',

  services: {
    list: {
      service: thingService as unknown as Record<string, Function>,
      method: 'listThingFolderContents',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        folderId: (ctx.input.folderId as number | null | undefined) ?? null,
      }),
    },
    read: {
      service: thingService as unknown as Record<string, Function>,
      method: 'readThingEntry',
      params: (ctx) => {
        // Same shape as documentsConfig.read: the REST layer's own pre-fetch
        // has nothing but the scope param to source `kind` from on first call.
        const kind = (ctx.editRecord?.kind ?? ctx.input.kind) as
          | thingService.ThingEntryKind
          | undefined;
        if (kind !== 'folder' && kind !== 'thing') {
          throw new McpToolError(
            'validation_failed',
            "Query param 'kind' must be 'folder' or 'thing'.",
          );
        }
        return {
          userId: ctx.input.userId as number,
          kind,
          id: (ctx.editRecord?.id ?? ctx.input.id) as number,
        };
      },
    },
    create: {
      service: thingService as unknown as Record<string, Function>,
      method: 'createThingFolder',
      requirePermission: 'things:write',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        folderId: (ctx.input.folderId as number | null | undefined) ?? null,
        name: ctx.values.name?.trim() || '',
      }),
    },
    update: {
      service: thingService as unknown as Record<string, Function>,
      method: 'updateThingEntry',
      requirePermission: 'things:write',
      params: (ctx) => {
        const kind = ctx.editRecord!.kind as thingService.ThingEntryKind;
        if (kind === 'folder') {
          return {
            userId: ctx.input.userId as number,
            kind,
            id: ctx.editRecord!.id as number,
            name: ctx.values.name?.trim() || '',
          };
        }
        // The field is named parentFolderId to match the key readThingEntry
        // and listThingFolderContents already return, so the terminal
        // pre-selects the Thing's current folder without extra mapping.
        // undefined = field not rendered (leave alone); '' = "No folder"
        // (move to root); a numeric string = move into that folder.
        const folderRaw = ctx.values.parentFolderId;
        return {
          userId: ctx.input.userId as number,
          kind,
          id: ctx.editRecord!.id as number,
          name: ctx.values.name?.trim() || '',
          description: toStringOrNull(ctx.values.description),
          category: toStringOrNull(ctx.values.category),
          ...(folderRaw === undefined
            ? {}
            : { folderId: folderRaw === '' ? null : Number(folderRaw) }),
        };
      },
    },
    delete: {
      service: thingService as unknown as Record<string, Function>,
      method: 'deleteThingEntry',
      requirePermission: 'things:write',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        kind: ctx.selection[0].kind as thingService.ThingEntryKind,
        id: ctx.selection[0].id as number,
      }),
    },
  },

  fieldConfigs: {
    name: {
      field: 'name',
      label: 'Name',
      length: 30,
      form: { required: true, hint: '(what is it)' },
      column: { width: 22, cellRenderer: displayName },
    },
    description: {
      field: 'description',
      label: 'Description',
      length: 60,
      form: {
        hint: '(typed on the phone)',
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'thing',
      },
      column: { width: 28 },
    },
    category: {
      field: 'category',
      label: 'Category',
      length: 20,
      form: {
        hint: '(tool, part, furniture)',
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'thing',
      },
      column: { width: 12 },
    },
    parentFolderId: {
      field: 'parentFolderId',
      label: 'Folder',
      length: 30,
      form: {
        hint: '(move to another folder)',
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'thing',
      },
      datasource: {
        service: thingService as unknown as Record<string, Function>,
        method: 'listThingFolderPaths',
        params: (ctx) => ({ userId: ctx.input.userId as number }),
        valueField: 'id',
        displayField: 'path',
      },
    },
    status: {
      field: 'status',
      label: 'Status',
      length: 10,
      column: { width: 10 },
    },
    // Reads as one column: "ready", "processing 40%", or why it is stuck.
    progress_text: {
      field: 'progress_text',
      label: 'Progress',
      length: 20,
      column: {
        width: 14,
        cellRenderer: (_ctx, r) => {
          if (r.kind && r.kind !== 'thing') return '';
          if (r.blockedReason) return String(r.blockedReason);
          const stage = r.stage ? String(r.stage) : '';
          const pct = r.progress === null || r.progress === undefined ? '' : `${r.progress}%`;
          return [stage, pct].filter(Boolean).join(' ').slice(0, 14);
        },
      },
    },
  },

  columnBuilder: ['name', 'category', 'status', 'progress_text', 'description'],
  formBuilder: ['name', 'category', 'description', 'parentFolderId'],

  navigation: {
    primaryAction: 'open',
    shortcuts: [{ key: 'c', option: '2', label: 'Edit' }],
  },

  listStatusHints: ['C=Edit/Move', 'N=New folder'],

  listContextKey: (ctx) => String(ctx.input.folderId ?? 'root'),

  onListBack: async (_session, ctx) => {
    const folderId = (ctx.input.folderId as number | null | undefined) ?? null;
    if (folderId === null) return 'pop';
    ctx.input.folderId = await thingService.getParentThingFolderId({
      userId: ctx.input.userId as number,
      folderId,
    });
    ctx.pageOffset = 0;
    return 'handled';
  },

  openUI: {
    id: 'my_things',
    mapContext: (ctx) => {
      const rec = ctx.selection[0];
      if (!rec || rec.kind === 'thing') {
        return {
          input: ctx.input,
          skipNavigation: true,
          navigationMessage: rec ? 'Thing selected — C to edit or move it' : undefined,
        };
      }

      if (rec.kind === 'parent') {
        return {
          input: { ...ctx.input, folderId: (rec.parentFolderId as number | null | undefined) ?? null },
          pageOffset: 0,
        };
      }

      if (rec.kind === 'folder') {
        return {
          input: { ...ctx.input, folderId: rec.id as number },
          pageOffset: 0,
        };
      }

      return { input: ctx.input, skipNavigation: true };
    },
  },

  listHeader: (ctx) => {
    const path = String(ctx.input.breadcrumbPath ?? '/');
    const truncated = path.length > 72 ? `...${path.slice(-69)}` : path;
    const records = ctx.records;
    const things = records.filter((r) => r.kind === 'thing');
    const ready = things.filter((r) => r.status === 'ready').length;
    const working = things.filter((r) => r.status === 'processing').length;
    const failed = things.filter((r) => r.status === 'failed').length;
    return [
      { row: 4, col: 2, content: `Path: ${truncated}` },
      {
        row: 5,
        col: 2,
        content: `${things.length} things  (${ready} ready, ${working} processing, ${failed} failed)`,
      },
    ];
  },

  onBeforeListRender: async (_session, ctx) => {
    ctx.input.breadcrumbPath = await thingService.getThingBreadcrumbPath({
      userId: ctx.input.userId as number,
      folderId: (ctx.input.folderId as number | null | undefined) ?? null,
    });
  },

  mcp: {
    name: 'my_things',
    description:
      'Real-world objects the user photographed, each with an optional generated ' +
      'isometric sprite, organized into folders. Only the authenticated user\'s own ' +
      'things and folders are accessible. Images are not returned here; this is the ' +
      'metadata surface. `create` makes a folder, not a Thing — Things are only ' +
      "created via the phone's photo upload.",
    operations: { list: true, read: true, create: true, update: true, delete: true },
    scope: [
      {
        name: 'userId',
        type: 'number' as const,
        required: true,
        description: 'Injected from the OAuth token — never a tool input.',
        injectFromAuth: 'userId' as const,
      },
      {
        name: 'folderId',
        type: 'number' as const,
        required: false,
        description: 'Folder to list the contents of. Omit for the root folder.',
      },
      {
        name: 'kind',
        type: 'string' as const,
        required: false,
        description:
          "'folder' or 'thing'. Required for read/update/delete — the value from the listing that produced this id.",
      },
    ],
  },

  api: {
    name: 'my_things',
    description: 'Photographed objects, folders, and their generated sprites, for the authenticated user.',
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
        name: 'folderId',
        type: 'number' as const,
        required: false,
        description: 'Folder to list the contents of. Omit for the root folder.',
      },
      {
        name: 'kind',
        type: 'string' as const,
        required: false,
        description:
          "'folder' or 'thing'. Required for read/update/delete — the value from the listing that produced this id.",
      },
    ],
  },
};

/** Initialize CRUDContext for My Things. Called from the menu runtime. */
export function initMyThingsContext(session: Session): void {
  session.context.crud_my_things_input = {
    userId: session.viserId,
    folderId: null,
  };
  session.context.crud_my_things_pageOffset = 0;
}
