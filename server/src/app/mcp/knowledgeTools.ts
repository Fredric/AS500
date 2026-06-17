// MCP knowledge tools — hierarchical document RAG surface.
//
// All tools require the `documents:read` permission.
// `userId` is always injected from the Bearer token — agents cannot override it.
//
// Tool names on the wire:
//   knowledge_search          — hybrid vector+BM25 chunk search
//   knowledge_find_nodes      — find relevant document folders by semantic similarity
//   knowledge_describe_node   — full metadata for a single folder
//   knowledge_get_document    — ingest status + metadata for a document item
//   knowledge_get_chunk       — full text + metadata for a single chunk

import { eq, and } from 'drizzle-orm';
import { db } from '../../core/db/index.js';
import { documentFolders, documentItems } from '../db/schema.js';
import { registerMcpTools } from '../../core/mcp/toolRegistry.js';
import { PERMISSIONS } from '../../core/services/access.js';

const DOCS_API_URL = (process.env.DOCS_API_URL ?? '').replace(/\/$/, '');

async function docsPost(path: string, body: unknown): Promise<unknown> {
  if (!DOCS_API_URL) {
    throw new Error('DOCS_API_URL is not configured — document search unavailable.');
  }
  const res = await fetch(`${DOCS_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`as500-docs ${path} returned ${res.status}: ${text}`);
  }
  return res.json();
}

async function docsGet(path: string): Promise<unknown> {
  if (!DOCS_API_URL) {
    throw new Error('DOCS_API_URL is not configured — document search unavailable.');
  }
  const res = await fetch(`${DOCS_API_URL}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`as500-docs ${path} returned ${res.status}: ${text}`);
  }
  return res.json();
}

registerMcpTools({
  id: 'knowledge',
  name: 'Knowledge Base',
  description:
    'Retrieve information from the user\'s ingested document library. ' +
    'Use knowledge_search for general queries. Use knowledge_find_nodes to locate ' +
    'relevant folders first, then knowledge_search with folder_id to narrow results. ' +
    'Use knowledge_get_document to check ingest status before searching a specific file.',
  requirePermission: PERMISSIONS.DOCUMENTS_READ,

  tools: [
    {
      name: 'search',
      description:
        'Hybrid vector + keyword search across the user\'s ingested document chunks. ' +
        'Returns ranked chunks with source document title, folder path, page number, and text. ' +
        'Optionally scope to a single folder with folder_id.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Injected from auth token — not a tool input.',
          injectFromAuth: 'userId',
        },
        {
          name: 'query',
          type: 'string',
          required: true,
          description: 'Natural language question or keywords to search for.',
        },
        {
          name: 'folder_id',
          type: 'number',
          required: false,
          description: 'Restrict search to chunks from this folder (and its children). Omit to search all.',
        },
        {
          name: 'top_k',
          type: 'number',
          required: false,
          description: 'Maximum number of chunks to return (1–50, default 10).',
        },
      ],
      handler: async ({ userId, query, folder_id, top_k }) => {
        const data = await docsPost('/search/documents', {
          query,
          user_id: userId,
          folder_id: folder_id ?? null,
          top_k: top_k ?? 10,
        }) as { total: number; answer_context_blocks: string[] };
        // Return only the formatted context blocks — omitting the raw `results` array
        // (which duplicates the text with score fields) keeps MCP tool responses lean.
        return {
          total: data.total,
          chunks: data.answer_context_blocks,
        };
      },
    },

    {
      name: 'find_nodes',
      description:
        'Find document folders whose AI summary best matches the query. ' +
        'Use this to discover which folder likely contains relevant documents ' +
        'before calling knowledge_search with a specific folder_id.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Injected from auth token — not a tool input.',
          injectFromAuth: 'userId',
        },
        {
          name: 'query',
          type: 'string',
          required: true,
          description: 'Query describing the topic you are looking for.',
        },
        {
          name: 'top_k',
          type: 'number',
          required: false,
          description: 'Maximum number of folders to return (default 10).',
        },
      ],
      handler: async ({ userId, query, top_k }) => {
        const k = (top_k as number | undefined) ?? 10;
        return docsGet(`/search/nodes?query=${encodeURIComponent(query as string)}&user_id=${userId}&top_k=${k}`);
      },
    },

    {
      name: 'describe_node',
      description:
        'Return full metadata for a document folder: name, description, AI summary, ' +
        'and folder path. Use this after knowledge_find_nodes to inspect a folder before searching.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Injected from auth token — not a tool input.',
          injectFromAuth: 'userId',
        },
        {
          name: 'folder_id',
          type: 'number',
          required: true,
          description: 'ID of the folder to describe.',
        },
      ],
      handler: async ({ userId, folder_id }) => {
        const rows = await db
          .select({
            id: documentFolders.id,
            name: documentFolders.name,
            description: documentFolders.description,
            ai_summary: documentFolders.ai_summary,
            parent_id: documentFolders.parent_id,
          })
          .from(documentFolders)
          .where(and(eq(documentFolders.id, folder_id as number), eq(documentFolders.user_id, userId as number)));

        if (!rows[0]) return { error: 'Folder not found.' };
        return { folder: rows[0] };
      },
    },

    {
      name: 'get_document',
      description:
        'Return metadata and ingest status for a specific document item. ' +
        'Check ingest_status is "ready" before searching. ' +
        'Returns name, file type, size, ai_summary, and ingest_status.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Injected from auth token — not a tool input.',
          injectFromAuth: 'userId',
        },
        {
          name: 'document_item_id',
          type: 'number',
          required: true,
          description: 'ID of the document item to inspect.',
        },
      ],
      handler: async ({ userId, document_item_id }) => {
        const rows = await db
          .select({
            id: documentItems.id,
            name: documentItems.name,
            file_type: documentItems.file_type,
            size_bytes: documentItems.size_bytes,
            ingest_status: documentItems.ingest_status,
            ai_summary: documentItems.ai_summary,
            folder_id: documentItems.folder_id,
            updated_at: documentItems.updated_at,
          })
          .from(documentItems)
          .where(and(eq(documentItems.id, document_item_id as number), eq(documentItems.user_id, userId as number)));

        if (!rows[0]) return { error: 'Document not found.' };
        return { document: rows[0] };
      },
    },

    {
      name: 'get_chunk',
      description:
        'Fetch the full text and metadata for a single document chunk by its id. ' +
        'Use this when knowledge_search returns a relevant chunk and you need the complete text.',
      params: [
        {
          name: 'userId',
          type: 'number',
          required: true,
          description: 'Injected from auth token — not a tool input.',
          injectFromAuth: 'userId',
        },
        {
          name: 'chunk_id',
          type: 'number',
          required: true,
          description: 'ID of the chunk to retrieve.',
        },
      ],
      handler: async ({ userId, chunk_id }) => {
        // Direct SQL to avoid importing the full documentChunks table type
        const { sql } = await import('drizzle-orm');
        const rows = await db.execute(sql`
          SELECT id, document_item_id, folder_id, text, node_path,
                 document_title, document_description, page_number, section_title,
                 content_type, created_at
          FROM document_chunks
          WHERE id = ${chunk_id as number} AND user_id = ${userId as number}
        `);
        if (!rows.rows[0]) return { error: 'Chunk not found.' };
        return { chunk: rows.rows[0] };
      },
    },
  ],
});
