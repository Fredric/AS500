import type { CRUDTableConfig } from '../../core/crudtable/types.js';
import type { Session } from '../../core/types/index.js';
import * as documentService from '../services/documentService.js';
import { PERMISSIONS } from '../../core/services/access.js';

function formatSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function displayName(_ctx: unknown, record: Record<string, unknown>): string {
  if (record.kind === 'parent') return '← ..';
  if (record.kind === 'folder') return `[Folder] ${String(record.name ?? '')}`;
  return String(record.name ?? '');
}

export const documentsConfig: CRUDTableConfig = {
  id: 'documents',
  title: 'My Documents',
  requireAuth: true,
  requirePermission: PERMISSIONS.DOCUMENTS_READ,

  services: {
    list: {
      service: documentService as unknown as Record<string, Function>,
      method: 'listFolderContents',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        folderId: (ctx.input.folderId as number | null | undefined) ?? null,
      }),
    },
    read: {
      service: documentService as unknown as Record<string, Function>,
      method: 'readDocumentEntry',
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        kind: ctx.editRecord!.kind as documentService.DocumentEntryKind,
        id: ctx.editRecord!.id as number,
      }),
    },
    create: {
      service: documentService as unknown as Record<string, Function>,
      method: 'createFolder',
      requirePermission: PERMISSIONS.DOCUMENTS_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        folderId: (ctx.input.folderId as number | null | undefined) ?? null,
        name: ctx.values.name?.trim() || '',
      }),
    },
    update: {
      service: documentService as unknown as Record<string, Function>,
      method: 'updateFolder',
      requirePermission: PERMISSIONS.DOCUMENTS_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        kind: ctx.editRecord!.kind as documentService.DocumentEntryKind,
        id: ctx.editRecord!.id as number,
        name: ctx.values.name?.trim() || '',
      }),
    },
    delete: {
      service: documentService as unknown as Record<string, Function>,
      method: 'deleteDocumentEntry',
      requirePermission: PERMISSIONS.DOCUMENTS_WRITE,
      params: (ctx) => ({
        userId: ctx.input.userId as number,
        kind: ctx.selection[0].kind as documentService.DocumentEntryKind,
        id: ctx.selection[0].id as number,
      }),
    },
  },

  fieldConfigs: {
    name: {
      field: 'name',
      label: 'Name',
      length: 40,
      form: {
        required: true,
        visible: (ctx) => ctx.formMode === 'create' || ctx.editRecord?.kind === 'folder',
        disabled: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'file',
      },
      column: {
        width: 40,
        cellRenderer: displayName,
      },
    },
    entryType: {
      field: 'entryType',
      label: 'Type',
      length: 8,
      form: {
        disabled: true,
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'file',
      },
      column: { width: 8 },
    },
    fileType: {
      field: 'fileType',
      label: 'File Type',
      length: 8,
      form: {
        disabled: true,
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'file',
      },
      column: { width: 0 },
    },
    sizeBytes: {
      field: 'sizeBytes',
      label: 'Size',
      length: 10,
      form: {
        disabled: true,
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'file',
        formValue: (_ctx, raw) => formatSize(raw),
      },
      column: {
        width: 10,
        align: 'right',
        cellRenderer: (_ctx, record) => formatSize(record.sizeBytes),
      },
    },
    modifiedAt: {
      field: 'modifiedAt',
      label: 'Modified',
      length: 16,
      form: {
        disabled: true,
        visible: (ctx) => ctx.formMode === 'edit' && ctx.editRecord?.kind === 'file',
      },
      column: { width: 16 },
    },
  },

  columnBuilder: ['name', 'entryType', 'sizeBytes', 'modifiedAt'],
  formBuilder: ['name', 'entryType', 'sizeBytes', 'modifiedAt'],

  navigation: {
    primaryAction: 'open',
  },

  listStatusHints: ['U=Upload'],

  listContextKey: (ctx) => String(ctx.input.folderId ?? 'root'),

  onListBack: async (_session, ctx) => {
    const folderId = (ctx.input.folderId as number | null | undefined) ?? null;
    if (folderId === null) return 'pop';
    ctx.input.folderId = await documentService.getParentFolderId({
      userId: ctx.input.userId as number,
      folderId,
    });
    ctx.pageOffset = 0;
    return 'handled';
  },

  openUI: {
    id: 'documents',
    mapContext: (ctx) => {
      const rec = ctx.selection[0];
      if (!rec || rec.kind === 'file') {
        return {
          input: ctx.input,
          skipNavigation: true,
          navigationMessage: 'File selected — actions coming soon',
        };
      }

      if (rec.kind === 'parent') {
        return {
          input: {
            ...ctx.input,
            folderId: (rec.parentFolderId as number | null | undefined) ?? null,
          },
          pageOffset: 0,
        };
      }

      if (rec.kind === 'folder') {
        return {
          input: {
            ...ctx.input,
            folderId: rec.id as number,
          },
          pageOffset: 0,
        };
      }

      return { input: ctx.input, skipNavigation: true };
    },
  },

  listHeader: (ctx) => {
    const path = String(ctx.input.breadcrumbPath ?? '/');
    const truncated = path.length > 72 ? `...${path.slice(-69)}` : path;
    const folderId = (ctx.input.folderId as number | null | undefined) ?? null;
    const atRoot = folderId === null;
    const onlyParentRow = !atRoot && ctx.records.length === 1 && ctx.records[0]?.kind === 'parent';
    const hintLine = onlyParentRow
      ? 'Folder is empty — U=Upload   N=New folder   Enter=Back (..)'
      : 'Enter=Open folder/file   U=Upload   N=New folder';
    return [
      { row: 4, col: 2, content: `Path: ${truncated}` },
      { row: 5, col: 2, content: hintLine },
    ];
  },

  onBeforeListRender: async (_session, ctx) => {
    ctx.input.breadcrumbPath = await documentService.getBreadcrumbPath({
      userId: ctx.input.userId as number,
      folderId: (ctx.input.folderId as number | null | undefined) ?? null,
    });
  },
};

export async function initDocumentsContext(session: Session): Promise<void> {
  session.context.crud_documents_input = {
    userId: session.viserId,
    folderId: null,
  };
  session.context.crud_documents_pageOffset = 0;
}
