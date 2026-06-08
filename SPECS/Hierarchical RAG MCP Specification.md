# Hierarchical RAG MCP Specification

## Goal

Build a hierarchical knowledge system with unlimited depth using the existing **My Documents** CRUDTable app in AS500 (`documentsConfig`, `documentService`).

Each folder node contains:

- Title (folder name)
- Description
- Child folders
- Documents (uploaded files)
- Images (files with `file_type = 'image'`)
- Notes (free-form text on the folder)

The hierarchy acts as a semantic routing layer for retrieval. All content is scoped per user (`user_id`).

This specification **replaces** the legacy workshop-manual RAG approach (`manuals` tables, `docsClient.ts` pre-injection, motorcycle keyword scoping). The **as500-agent** retrieves knowledge exclusively through **AS500 MCP tools** — not through server-side context injection.

---

## System Architecture

### Target (full My Documents integration)

```
User uploads PDF/image in My Documents (AS500 CRUDTable)
       │
       ▼
document_items row + file on disk (server/data/documents/{userId}/)
       │
       ▼
AS500 triggers as500-docs ingestion job (HTTP POST /ingest)     ← not built yet
       │
       ▼
as500-docs worker (../as500-docs)
  ├── Docling VlmPipeline → vLLM granite-docling-258M  (must be running)
  ├── Structure-aware chunking (HybridChunker)
  ├── Page/image/table extraction → auxiliary tables
  ├── Ollama embeddings (nomic-embed-text, 768-dim)
  ├── Ollama summaries (folder + document ai_summary)
  └── Writes document_chunks + folder embeddings → shared Postgres
       │
       ▼
AS500 MCP server (:3002) — knowledge_* tools + existing CRUDTable tools
       │
       ▼
as500-agent — calls MCP tools under user's RBAC token
       │
       ▼
Answer + citations (node path, page, document title)
```

### Today (ingestion via CLI only)

Until the My Documents upload → `/ingest` trigger is implemented, **all ingestion is done exclusively through the as500-docs CLI** on a dev machine with GPU + vLLM. The operator uploads files into My Documents (or places them on disk), then runs the CLI to ingest against a `document_item_id`.

```
My Documents upload (AS500) — stores file + document_items row only
       │
       ▼
Operator runs: as500-docs CLI ingest --item-id <id>   ← current sole ingest path
       │
       ▼
as500-docs (CLI blocks until job completes, or worker via docker compose)
  ├── requires vLLM running (USE_VLM=true)
  ├── requires Ollama running (embeddings)
  └── writes document_chunks + auxiliary tables
```

### Services and repos


| Component       | Location                | Role                                                                                                         |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| **AS500**       | this repo               | My Documents UI, `document_`* schema, MCP tool handlers; upload trigger **TBD**                              |
| **as500-docs**  | `../as500-docs`         | Docling ingestion (CLI today), worker, hybrid search, HTTP API                                               |
| **as500-agent** | separate repo           | LLM orchestration; calls AS500 MCP — no direct DB or docs HTTP                                               |
| **Ollama**      | AS500 VPS (or dev host) | Embeddings, summaries, translation, query rewrite — **not** PDF parsing                                      |
| **vLLM**        | dev GPU host (`:8000`)  | **Required for ingest** — Docling `VlmPipeline` via `granite-docling-258M`; must be up before any PDF ingest |


Both AS500 and as500-docs share the **same Postgres database** (`as500`). as500-docs attaches to the AS500 Docker network (`as500_default`) with alias `as500-docs`.

**Ingest prerequisites (every PDF ingest):** vLLM server running **and** Ollama running **and** as500-docs worker or CLI process. Search/retrieval at answer time uses Ollama + Postgres only — vLLM is not involved after ingest completes.

---

## as500-docs — Reuse and Migration

The existing **as500-docs** Python service (`../as500-docs`) is the ingestion and search engine. It already implements the core pipeline this spec needs:


| Capability                  | as500-docs module                  | Status                                |
| --------------------------- | ---------------------------------- | ------------------------------------- |
| Docling PDF parse           | `docling_pipeline.py`              | **Reuse as-is**                       |
| Structure-aware chunking    | `chunker.py`                       | **Reuse as-is**                       |
| Postgres job queue          | `worker.py`, `ingestion_jobs`      | **Adapt** job payload                 |
| Hybrid vector + BM25 search | `search.py`                        | **Retarget** SQL to `document_chunks` |
| Cross-encoder rerank        | `reranker.py`                      | **Reuse as-is**                       |
| Ollama embeddings           | `embeddings/ollama.py`             | **Reuse** — mandatory backend         |
| Ollama RAG answers          | `rag.py`                           | **Reuse** — generalize prompts        |
| Ollama translation          | `translator.py`                    | **Reuse** — optional per document     |
| Ollama query rewrite        | `query_rewriter.py`                | **Reuse** — generalize prompts        |
| Page/image preview API      | `api/routes/pages.py`, `images.py` | **Retarget** to `document_item_id`    |
| Idempotency by content hash | `ingestion.py`                     | **Adapt** — hash on `document_items`  |


### What is manual-specific today (must change)


| Area              | Current                                                        | Target                                                                                                       |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Root entity       | `manuals` (UUID, manufacturer/model/year)                      | `document_items` (serial id, `folder_id`, `user_id`)                                                         |
| Hierarchy         | none                                                           | `document_folders` tree                                                                                      |
| User isolation    | global manuals                                                 | `user_id` on every query and ingest job                                                                      |
| Ingest trigger    | **CLI only** — `ingest <file>` + motorcycle prompts            | **CLI** `ingest --item-id` (interim), then **HTTP** `POST /ingest` from AS500 upload (target)                |
| Search filters    | `manufacturer`, `model`, `year`, `manual_id`                   | `user_id`, `folder_id`, `document_item_id`                                                                   |
| Chunk storage     | `manual_chunks` + `chunk_embeddings` (768-dim, separate table) | `document_chunks` (inline `embedding`)                                                                       |
| Storage paths     | `storage/manuals/{uuid}/`                                      | read from AS500 `document_items.storage_path`; extracted assets under `storage/documents/{userId}/{itemId}/` |
| AS500 integration | `docsClient.ts` HTTP `/search` + manual keyword detection      | AS500 MCP tools; agent-driven retrieval                                                                      |
| Prompts           | motorcycle/workshop manual wording                             | domain-neutral knowledge-base wording                                                                        |


### Legacy tables to drop

No data migration from the old manual pipeline. Existing ingested manuals are **not** carried over — users re-upload PDFs through **My Documents** and as500-docs re-ingests them into `document_`* tables.

After cutover, drop these as500-docs tables (backup first if desired, then discard):

```txt
manuals, manual_pages, manual_chunks, manual_images, manual_tables, chunk_embeddings
```

Repurpose `ingestion_jobs` or replace with `document_ingestion_jobs`.

---

## vLLM — Required for PDF Ingestion

PDF text/layout extraction uses Docling's `**VlmPipeline**` backed by `**ibm-granite/granite-docling-258M**` served over OpenAI-compatible HTTP on a **vLLM** instance. This is the default and intended ingest path (`USE_VLM=true` in `as500-docs/.env`).

**vLLM must be running before starting any ingest.** If vLLM is down, Docling conversion fails and the job ends in `failed` / `ingest_status = 'failed'`.

### What vLLM does vs Ollama


| Stage                                 | Runtime                         | When        |
| ------------------------------------- | ------------------------------- | ----------- |
| PDF → pages, tables, images, markdown | **vLLM** (Docling VLM)          | Ingest only |
| Chunk embeddings                      | **Ollama** (`nomic-embed-text`) | Ingest      |
| Folder/document summaries             | **Ollama**                      | Ingest      |
| Optional translation                  | **Ollama**                      | Ingest      |
| Hybrid search / query rewrite         | **Ollama**                      | Query time  |
| as500-agent answers                   | **Ollama** or local LLM         | Chat time   |


vLLM runs on the **dev GPU machine** (e.g. RTX 5090), not on the AS500 VPS. as500-docs reaches it via `VLM_API_URL` (default `http://host.docker.internal:8000/v1` from Docker, or `http://127.0.0.1:8000/v1` from host CLI).

### as500-docs env (Docling / vLLM)

```bash
USE_VLM=true                                    # required for production-quality ingest
VLM_API_URL=http://host.docker.internal:8000/v1 # or http://127.0.0.1:8000/v1 for host CLI
VLM_MODEL=ibm-granite/granite-docling-258M
DOCLING_CONCURRENCY=64                          # tune per GPU VRAM
```

`USE_VLM=false` falls back to pdfminer + RapidOCR (no vLLM). That path exists for Chinese/scanned PDFs but is **not** the standard workflow for this project.

### Start vLLM before ingest (dev)

```powershell
# 1. Start vLLM serving granite-docling (project-specific script)
cd C:\Users\fredr\code\vLLM-5090
.\run-d.bat

# 2. Verify from as500-docs repo
cd C:\Users\fredr\code\as500-docs
python -m as500_docs.cli check-vlm
# → "OK ibm-granite/granite-docling-258M is loaded"

# 3. Start Ollama (embeddings) — separate process
# e.g. C:\Users\fredr\code\as500-agent\scripts\start-ollama.ps1

# 4. Run ingest (see Ingestion — CLI workflow below)
```

The as500-docs worker container and host CLI both call the same `docling_pipeline.py`; both require vLLM reachable at `VLM_API_URL`.

### Health check

- CLI: `python -m as500_docs.cli check-vlm`
- API: `GET http://localhost:8080/healthz` reports `vlm_server` status (error expected if vLLM is only on dev host and API runs elsewhere)

---

## Ingestion — CLI workflow (current)

**Until the My Documents auto-trigger is built, ingestion is exclusively via the as500-docs CLI.** No HTTP `/ingest` call from AS500 exists in production today; the legacy path prompted for manufacturer/model/year and wrote to `manuals`*.

### Prerequisites (checklist)

- [ ] AS500 Postgres up (`docker compose up -d postgres` in AS500 repo)
- [ ] **vLLM running** with `granite-docling-258M` (`check-vlm` passes)
- [ ] **Ollama running** with `nomic-embed-text` pulled
- [ ] as500-docs `.env` present (`USE_VLM=true`, `DATABASE_URL`, `OLLAMA_BASE_URL`)
- [ ] Drizzle migration applied (`document_`* RAG tables exist)
- [ ] PDF uploaded to My Documents (or `document_items` row + file on `storage_path` exists)

### Target CLI command (after as500-docs retarget)

```powershell
cd C:\Users\fredr\code\as500-docs

# Ingest one My Documents file by document_items.id
python -m as500_docs.cli ingest --item-id 10
```

The CLI reads `document_items.storage_path`, runs Docling via vLLM, writes `document_chunks` and auxiliary tables, sets `ingest_status = 'ready'`.

### Legacy CLI (today's manual pipeline — deprecated)

```powershell
python -m as500_docs.cli ingest "path\to\manual.pdf"
# prompts: Manufacturer, Model, Year, Title → writes to manuals* tables
```

Replace with `ingest --item-id` once as500-docs is retargeted to `document_items`.

### Supporting CLI commands


| Command                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `check-vlm`                      | Verify vLLM is up before ingest                 |
| `migrate`                        | Run as500-docs Alembic migrations               |
| `translate-document --item-id N` | Ollama translation (non-English PDFs)           |
| `reembed-document --item-id N`   | Re-run Ollama embeddings after translation      |
| `search "query"`                 | Test hybrid search                              |
| `list-documents`                 | List ingested `document_items` (after retarget) |


### Worker mode (alternative to blocking CLI)

```powershell
cd C:\Users\fredr\code\as500-docs
docker compose up -d   # api + worker; worker claims ingestion_jobs
```

Worker jobs still require vLLM + Ollama. For My Documents cutover, job payload becomes `{ document_item_id, user_id }` instead of motorcycle metadata.

---

## Ollama — Mandatory AI Backend (post-Docling)

**All embedding, summary, translation, and query-time AI must use Ollama** on the AS500 VPS (or dev host during ingest). No cloud LLM or embedding APIs in production. Ollama does **not** replace vLLM for PDF parsing — both run during ingest.


| Function                  | Ollama model (env var)                              | Used by                                     |
| ------------------------- | --------------------------------------------------- | ------------------------------------------- |
| Embeddings                | `nomic-embed-text` (`EMBEDDING_MODEL`)              | Chunk + folder embedding generation         |
| Document/folder summaries | configurable (`SUMMARY_MODEL`, default same as RAG) | Ingestion pipeline                          |
| RAG answer generation     | `RAG_MODEL` (e.g. `gemma4:31b-it-q4_K_M`)           | `/ask` endpoint (if retained for debugging) |
| Query rewriting           | `QUERY_REWRITE_MODEL`                               | Search preprocessing                        |
| Translation               | `TRANSLATE_MODEL`                                   | Optional non-English document ingest        |


### Required configuration

**as500-docs `.env` (production VPS):**

```bash
EMBEDDING_BACKEND=ollama          # never openai in production
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIM=768                 # must match document_chunks.embedding dimension
OLLAMA_BASE_URL=http://127.0.0.1:11434   # Ollama on the VPS host

RAG_MODEL=<local-model>
TRANSLATE_BACKEND=ollama
TRANSLATE_MODEL=<local-model>
QUERY_REWRITE_ENABLED=true
QUERY_REWRITE_MODEL=<local-model>
```

**AS500 `server/.env.local` / production `.env`:**

```bash
DOCS_API_URL=http://as500-docs:8080   # ingestion trigger + page/image proxy only
DOCS_MIN_SCORE=0.25                   # used by MCP search_knowledge handler
OLLAMA_BASE_URL=http://127.0.0.1:11434  # if AS500 generates summaries directly
```

> **Embedding dimension:** `document_chunks.embedding` and `document_folders.*_embedding` must use **768 dimensions** to match `nomic-embed-text`. Update the Drizzle `embeddingVector` default in `schema.ts` from 1536 → 768.

> **vLLM is mandatory for ingest** in this project (`USE_VLM=true`). See **vLLM — Required for PDF Ingestion** above. Ollama alone cannot parse PDFs.

---

## Data Model

Maps directly to app tables in `server/src/app/db/schema.ts`, plus auxiliary tables managed by as500-docs Alembic migrations.

### Node → `document_folders`

A folder row is a node in the knowledge tree.

```ts
DocumentFolder {
  id: number
  user_id: number
  parent_id: number | null
  name: string              // node title
  description: string | null
  notes: string | null      // free-form notes / text on the folder
  ai_summary: string | null // generated at ingest via Ollama
  title_embedding: vector(768) | null
  description_embedding: vector(768) | null
  ai_summary_embedding: vector(768) | null
  created_at: timestamp
  updated_at: timestamp
}
```

**Path** is not stored. It is computed at query time from the `parent_id` chain (same logic as `documentService.getBreadcrumbPath`).

Example path:

```txt
/Motorcycles/CFMOTO 450MT/Engine
```

Child nodes are other `document_folders` rows where `parent_id = folder.id`.

### Document → `document_items`

A file row is a document attached to a folder node.

```ts
DocumentItem {
  id: number
  user_id: number
  folder_id: number | null  // parent node; null = user root
  name: string              // document title
  description: string | null
  file_type: string         // 'pdf' | 'image' | 'other'
  mime_type: string | null
  extension: string | null
  storage_path: string      // absolute path to source file on disk
  original_filename: string
  size_bytes: number
  ai_summary: string | null // generated at ingest via Ollama
  content_hash: string | null // SHA256 for ingest idempotency
  ingest_status: string | null  // 'pending' | 'processing' | 'ready' | 'failed'
  created_at: timestamp
  updated_at: timestamp
}
```

Images are `document_items` where `file_type = 'image'`. PDFs are `file_type = 'pdf'`.

### Chunk → `document_chunks`

Derived search index; one row per text chunk extracted from a `document_items` file.

```ts
DocumentChunk {
  id: number
  user_id: number
  document_item_id: number
  folder_id: number | null

  text: string
  embedding: vector(768)

  node_path: string
  node_description: string | null
  document_title: string
  document_description: string | null

  page_number: number | null
  page_end: number | null
  section_title: string | null
  content_type: string | null  // 'text' | 'table' | 'image_caption' | 'mixed'

  created_at: timestamp
}
```

Denormalized metadata is copied onto every chunk at ingest so retrieval results carry full citation context without extra joins.

### Auxiliary tables (as500-docs, preserve existing functionality)

These tables mirror the current `manual_pages`, `manual_images`, `manual_tables` pattern but key off `document_item_id`:

```ts
DocumentPage {
  id: number
  document_item_id: number
  page_number: number
  raw_text: string | null
  markdown: string | null
}

DocumentImage {
  id: number
  document_item_id: number
  page_number: number | null
  file_path: string
  caption: string | null
  linked_chunk_id: number | null
}

DocumentTable {
  id: number
  document_item_id: number
  page_number: number | null
  table_markdown: string
  linked_chunk_id: number | null
}

DocumentIngestionJob {
  id: uuid
  document_item_id: number
  user_id: number
  state: 'queued' | 'processing' | 'completed' | 'failed'
  error: string | null
  attempts: number
  created_at: timestamp
  finished_at: timestamp | null
}
```

Page preview and image proxy routes in AS500 (`/docs-pages/*`, `/docs-images/*`) are retargeted from `manual_id` to `document_item_id`.

---

## CRUDTable Integration

The **My Documents** screen (`CRUD_DOCUMENTS`) is the user-facing source of truth:


| UI concept      | Table              | Service                                                 |
| --------------- | ------------------ | ------------------------------------------------------- |
| Folder (node)   | `document_folders` | `createFolder`, `renameDocumentEntry` (kind=`folder`)   |
| File (document) | `document_items`   | `saveUploadedFile`, `renameDocumentEntry` (kind=`file`) |
| Breadcrumb path | computed           | `getBreadcrumbPath`                                     |
| List contents   | both tables        | `listFolderContents`                                    |


### Upload today vs auto-ingest (target)

**Today:** `documentsUpload.ts` → `saveUploadedFile` only stores the file and inserts a `document_items` row. **No ingest runs automatically.** The operator must run the as500-docs CLI (`ingest --item-id`) with vLLM + Ollama up.

**Target:** when a PDF or image is uploaded:

1. Insert `document_items` row with `ingest_status = 'pending'`
2. `POST ${DOCS_API_URL}/ingest` with `{ document_item_id, user_id }`
3. as500-docs worker claims job, reads `storage_path`, runs Docling **VlmPipeline** (vLLM must be reachable from worker)
4. On success: `ingest_status = 'ready'`; on failure: `ingest_status = 'failed'`

Re-ingest triggers (target): file replace, description change (re-embed metadata), folder move (update `folder_id` + `node_path` on chunks), delete (cascade chunks + auxiliary rows). Until auto-trigger exists, re-ingest = re-run CLI.

Folder changes (rename, description, notes) trigger folder `ai_summary` + embedding refresh via as500-docs (CLI or worker).

---

## Ingestion Pipeline (as500-docs)

Triggered by **CLI** today; **HTTP worker** target. Every PDF run requires **vLLM** (Docling) then **Ollama** (embed/summarize).

For each `document_items` row (PDF):

1. Read file from `document_items.storage_path`
2. **Docling `VlmPipeline`** → vLLM `granite-docling-258M` — extract text, pages, images, tables (`docling_pipeline.py`, `doc.tables`, `doc.pictures`)
3. Store pages → `document_pages`, images → `document_images`, tables → `document_tables`
4. **Chunk** with `HybridChunker` (`chunker.py`)
5. Optional **Ollama translation** (`translator.py`) for non-English content
6. **Ollama embed** each chunk → `document_chunks.embedding`
7. **Ollama summarize** → `document_items.ai_summary`
8. Denormalize folder metadata (`node_path`, `node_description`, `document_title`) onto every chunk
9. Refresh parent folder `ai_summary` + embeddings

For each `document_items` row (image):

1. Store image metadata; optionally OCR/extract caption via Docling
2. Embed description + any extracted text as a single chunk

For each `document_folders` row (on create/update of description or notes):

1. **Ollama summarize** → `document_folders.ai_summary`
2. **Ollama embed** `name`, `description`, `ai_summary` → `*_embedding` columns

Idempotency: skip re-extraction if `content_hash` unchanged; re-embed if only metadata changed.

---

## Retrieval Strategy

All queries are scoped to the authenticated user's `user_id`.

### Step 1 — Folder routing

Search folder embeddings first.

```txt
find_relevant_nodes(query, userId)
```

Searches `document_folders.title_embedding`, `description_embedding`, and `ai_summary_embedding` (cosine similarity via pgvector).

Return top matching folders. Implemented in as500-docs `search.py` (new function) or AS500 MCP handler calling shared SQL.

### Step 2 — Chunk search within folders

```txt
vector search on document_chunks.embedding
+
keyword search (tsvector / BM25) on document_chunks.text
+
cross-encoder reranking (reranker.py)
```

Filter: `document_chunks.folder_id IN (selected folder ids)` AND `document_chunks.user_id = userId`.

### Step 3 — Return

- chunk text
- score
- document title (`document_title`)
- node path (`node_path`)
- citation metadata (`page_number`, `section_title`)
- linked image refs (from `document_images`)

---

## MCP Tools (AS500)

Registered via `registerMcpTools()` in `server/src/app/mcp/knowledgeTools.ts`. Tool names on the wire: `knowledge_{name}`.

All tools inject `userId` from the MCP Bearer token (`injectFromAuth: 'userId'`). Require `documents:read` permission.

Handlers call as500-docs HTTP API (`DOCS_API_URL`) or query Postgres directly — implementation choice left to build phase; the MCP contract is stable.

### `knowledge_search`

Primary tool. Replaces legacy `docsClient.fetchDocsContext` injection.

```ts
knowledge_search({
  query: string,
  folderId?: number,
  topK?: number
})
```

Two-step retrieval: `find_relevant_nodes` → chunk search in selected folders. Returns ranked chunks with citations.

### `knowledge_find_nodes`

```ts
knowledge_find_nodes({
  query: string
})
```

Searches folder descriptions and `ai_summary` only. Use when subject area is unclear.

### `knowledge_describe_node`

```ts
knowledge_describe_node({
  folderId: number
})
```

Returns folder metadata, child folders, and documents in that folder.

### `knowledge_get_document`

```ts
knowledge_get_document({
  documentItemId: number
})
```

Returns `document_items` metadata + ingest status.

### `knowledge_get_chunk`

```ts
knowledge_get_chunk({
  chunkId: number
})
```

Returns full chunk text and citation information.

### MCP tool guidance (agent system prompt)


| Tool                      | When to use                                      |
| ------------------------- | ------------------------------------------------ |
| `knowledge_search`        | Answering user questions about their documents   |
| `knowledge_find_nodes`    | Subject area unclear; explore what folders exist |
| `knowledge_describe_node` | Inspect a folder before searching inside it      |
| `knowledge_get_document`  | Document-level metadata or ingest status         |
| `knowledge_get_chunk`     | Exact source text required for citation          |


---

## as500-agent Integration

The **as500-agent** (`../as500-agent`) is the Python FastAPI service behind the AS500 chat panel (✦). It already connects to the AS500 MCP server on every chat turn using the delegated user JWT (`metadata.mcpAccessToken` from `chatService.ts`). It dynamically discovers **all** MCP tools — existing CRUDTable tools (`timereg_v2.list`, `motorcycles.read`, …) **plus** the new `knowledge_`* tools — with no hard-coded tool list.

Knowledge retrieval moves from server-side pre-injection to **agent-initiated MCP tool calls**.

### Current flow (deprecated manual RAG)

```
Browser → WebSocket AI_CHAT_SEND
    → AS500 chatService.ts
        ├── fetchDocsContext() → as500-docs /search + /ask (manual keyword scoping)
        ├── inject "WORKSHOP MANUAL CONTEXT" as system message
        ├── mintMcpAccessTokenForUser()
        └── POST /v1/chat/completions → as500-agent
            → LLM answers using pre-injected manual excerpts + CRUD MCP tools
```

Problems: manual-specific keyword detection, no hierarchy, agent cannot choose when to search, user cannot query My Documents.

### Target flow

```
Browser → WebSocket AI_CHAT_SEND
    → AS500 chatService.ts
        ├── buildScreenContext() only (no fetchDocsContext)
        ├── mintMcpAccessTokenForUser()
        └── POST /v1/chat/completions → as500-agent
            → open_session_with_token(jwt)
            → list_tools()  ← includes knowledge_* + all CRUD tools
            → LLM decides: knowledge_find_nodes → knowledge_search → answer
            → citations in answer text from tool results
```

The agent uses the **same MCP session** for both CRUD operations and knowledge search. RBAC on the delegated token applies to all tools (`documents:read` required for `knowledge_`*).

### What does NOT need to change in as500-agent


| File                                       | Why unchanged                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `mcp_client.py`                            | Already discovers tools via `session.list_tools()` — new `knowledge_*` tools appear automatically when AS500 registers them |
| `api_chat.py`                              | Already opens MCP with `open_session_with_token(token)` and passes all tools to the runner                                  |
| `api_app.py`, `api_auth.py`                | HTTP contract unchanged                                                                                                     |
| Tool bridge (`_mcp_tool_as_function_tool`) | Generic — wraps any MCP tool as an OpenAI Agents `FunctionTool`                                                             |


No new env vars, no new HTTP endpoints, no manual tool registration list in the agent.

### Required changes in as500-agent

#### 1. System prompt — `agent/src/as500_agent/agent_runner.py`

Expand `SYSTEM_PROMPT` to cover knowledge tools alongside existing CRUD guidance. The agent must know **when** and **how** to use the hierarchical retrieval workflow.

Add instructions along these lines:

```text
KNOWLEDGE BASE (My Documents):
The user may have uploaded PDFs and images organized in a folder hierarchy.
Five MCP tools provide access (names prefixed knowledge_):

  knowledge_find_nodes   — locate relevant folders when the topic is unclear
  knowledge_search       — search document chunks (primary Q&A tool)
  knowledge_describe_node — inspect a folder's contents before searching
  knowledge_get_document — document metadata and ingest status
  knowledge_get_chunk    — exact source text for citations

Retrieval workflow for document questions:
  1. If the user asks about their documents/files/manuals/content:
     call knowledge_find_nodes OR knowledge_search directly.
  2. If the subject folder is unclear, call knowledge_find_nodes first,
     then knowledge_search with folderId from the results.
  3. If the user is on the My Documents screen (system context mentions it),
     prefer searching within the current folder when folderId is inferable.
  4. Answer ONLY from tool results. If nothing relevant is found, say so.
  5. Always cite sources: {node_path} / {document_title} p.{page_number}

Do not use general knowledge to fill gaps in retrieved document content.
If knowledge_* tools return permission_denied, tell the user they lack document access.

CRUD tools (timereg_v2.*, motorcycles.*, documents.*, etc.) remain available
for reading and writing AS500 app data. Use knowledge_* for document content
questions; use CRUD tools for listing/editing records.
```

Remove any wording that assumes manual excerpts arrive pre-injected in system messages.

#### 2. `run_messages` comment cleanup — `agent_runner.py`

Update the comment at lines 225–227 that says system messages carry "RAG excerpts" / "retrieved manual content". After cutover, system messages from AS500 carry **only** `buildScreenContext()` (current screen position) — not document content.

No logic change required: `run_messages` already forwards system messages to the prompt. Once AS500 stops injecting manual context, the agent naturally falls back to MCP tools.

#### 3. Optional: tool-call logging — `trace_log.py`

Add trace events when `knowledge_`* tools are invoked (tool name + arg summary, not full chunk text) so operators can verify the agent is searching rather than hallucinating. Useful during migration; not blocking.

#### 4. Optional (phase 2): structured citations in stream

Today the agent returns plain text; AS500 `ManualSourcePanel` expects structured `DocsSource[]` from `fetchDocsContext`. Phase 1: citations live in the answer prose only. Phase 2 options:

- **A)** MCP `knowledge_search` returns a `citations[]` array; agent echoes them in a JSON footer the AS500 client parses
- **B)** AS500 `chatService.ts` calls `knowledge_search` in parallel for the sources panel (hybrid — partially reverts agent-only model)
- **C)** New WebSocket event `AI_CHAT_SOURCES` emitted if agent metadata includes citation refs

Recommend **phase 1 = prose citations only**; revisit panel UX in phase 2.

#### 5. Documentation — `INTEGRATION_SPEC.md`, `README.md`

- Update scope: RAG is in scope via MCP `knowledge_`* tools (remove "Advanced memory / RAG systems" from non-goals or qualify it)
- Add knowledge tool workflow to agent README tool-usage section
- Note `documents:read` permission requirement for knowledge search

### AS500-side changes (feeds the agent)


| File                                          | Change                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/app/mcp/knowledgeTools.ts`        | **New** — register `knowledge_`* tool group (see MCP Tools section above)                                                                    |
| `server/src/app/index.ts`                     | `import './mcp/knowledgeTools.js'`                                                                                                           |
| `server/src/core/ai/chatService.ts`           | Remove `fetchDocsContext()` import and call; remove `docsResult.sources` yield; keep `buildScreenContext()` and `mcpAccessToken` in metadata |
| `server/src/index.ts`                         | Retarget `/docs-pages/` proxy from `manualId` to `documentItemId`                                                                            |
| `client/src/components/ManualSourcePanel.tsx` | Phase 1: panel stays empty (no sources event); phase 2: retarget to document citations                                                       |


### Permission matrix


| User role            | CRUD MCP tools    | `knowledge_*` tools                        |
| -------------------- | ----------------- | ------------------------------------------ |
| Has `documents:read` | per existing RBAC | all knowledge tools                        |
| No `documents:read`  | per existing RBAC | `permission_denied` — agent should explain |


The delegated MCP token (`client_id: 'as500-ai'`) carries the same permission set as the terminal session. Users without My Documents access cannot search their knowledge base.

### Chat turn sequence (detailed)

```txt
1. User types question in AiChatPanel
2. AS500 chatService:
   - screen context system message (e.g. "viewing My Documents list")
   - NO document content injection
   - mint MCP JWT for userId
   - POST as500-agent /v1/chat/completions { messages, metadata: { mcpAccessToken } }
3. as500-agent api_chat._run_agent:
   - open_session_with_token(jwt)
   - list_tools → [timereg_v2.list, motorcycles.list, knowledge_search, knowledge_find_nodes, …]
   - Runner.run with all tools as FunctionTools
4. LLM tool loop (OpenAI Agents SDK):
   - optional: knowledge_find_nodes({ query })
   - knowledge_search({ query, folderId?, topK? })
   - optional: knowledge_get_chunk({ chunkId }) for exact quote
   - compose answer with citations
5. Answer streamed back → AS500 WebSocket → AiChatPanel
```

### Example agent tool calls

**User:** "What is the torque spec for the cylinder head bolts on my CFMOTO?"

```txt
→ knowledge_find_nodes({ query: "CFMOTO cylinder head torque" })
← [{ folderId: 3, name: "Engine", path: "/Motorcycles/CFMOTO 450MT/Engine", score: 0.82 }]

→ knowledge_search({ query: "cylinder head bolt torque", folderId: 3, topK: 4 })
← [{ chunkId: 891, text: "...", node_path: "/Motorcycles/CFMOTO 450MT/Engine",
     document_title: "Bosch_motor.pdf", page_number: 47, score: 0.91 }]

→ (LLM composes answer citing the chunk)
```

**User:** "Add 2 hours on TASK-101 today" — agent uses `timereg_v2.`* CRUD tools, not knowledge tools.

**User:** (on My Documents screen, inside `/Motorcycles/CFMOTO 450MT/Engine`) "Summarize the PDFs here"

```txt
→ knowledge_describe_node({ folderId: 3 })
← { documents: [{ id: 10, name: "Bosch_motor.pdf", ingest_status: "ready" }] }
→ knowledge_search({ query: "summary", folderId: 3 })
```

### Testing checklist (as500-agent)

- [ ] `list_tools` includes all five `knowledge_*` tools when AS500 registers them
- [ ] Agent calls `knowledge_search` for a document question (not CRUD `documents.list`)
- [ ] Agent does **not** call knowledge tools for pure time-reg / motorcycle CRUD questions
- [ ] `permission_denied` on knowledge tools produces a clear user-facing message
- [ ] Answer includes `node_path` / `document_title` / page citations from tool results
- [ ] Chat works when user has no uploaded documents (empty knowledge base — agent says so)
- [ ] Existing CRUD MCP tools still work on the same turn (no regression)

### Smoke test command

From `as500-agent` with AS500 MCP running and knowledge tools registered:

```powershell
# CLI path — OAuth or set token manually
as500-agent "What documents do I have about engine maintenance?"
# Expect: knowledge_find_nodes or knowledge_search tool calls in trace log
```

---

## as500-docs — Required Code Changes

### Schema / models


| File                | Change                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models.py`         | Add ORM for `document_folders`, `document_items`, `document_chunks`, `document_pages`, `document_images`, `document_tables`, `document_ingestion_jobs`; deprecate `Manual*` models |
| `alembic/versions/` | New migration: auxiliary tables + `content_hash`/`ingest_status` on `document_items`; drop `manuals*` tables (no row migration — re-ingest via My Documents)                       |


### Ingestion


| File                   | Change                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion.py`         | Read `document_items.storage_path`; write `document_chunks` with denormalized metadata; update `ingest_status`; hash on `content_hash` |
| `worker.py`            | Job payload: `{ document_item_id, user_id }` instead of manufacturer/model/year                                                        |
| `api/routes/ingest.py` | Accept `document_item_id` (+ service auth header); remove motorcycle form fields                                                       |
| `storage.py`           | Extracted assets under `storage/documents/{userId}/{itemId}/`; source file read from AS500 path                                        |


### Search / RAG


| File                   | Change                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `search.py`            | SQL on `document_chunks` + `user_id` + optional `folder_id IN (...)`; folder embedding search on `document_folders` |
| `rag.py`               | Generalize system prompt (not motorcycle-specific); citations use `node_path`, `document_title`                     |
| `query_rewriter.py`    | Generalize rewrite prompt                                                                                           |
| `api/routes/ask.py`    | Accept `user_id`; scope all queries per user                                                                        |
| `api/routes/search.py` | Replace `manual_id` filter with `user_id` + `folder_id`                                                             |


### API routes (rename / retarget)


| Current                         | Target                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| `GET /manuals`                  | `GET /folders` or removed (MCP `knowledge_describe_node` replaces) |
| `GET /manuals/{id}`             | `GET /documents/{document_item_id}`                                |
| `GET /chunks/{id}`              | `GET /chunks/{id}` (integer id)                                    |
| `GET /pages/{manual_id}/{page}` | `GET /pages/{document_item_id}/{page}`                             |
| `GET /image-file/{id}`          | unchanged shape, `document_images` source                          |
| `POST /ingest`                  | `POST /ingest { document_item_id, user_id }`                       |


### CLI

**Ingestion is CLI-only until AS500 upload trigger ships.** Retarget CLI from `manuals` to `document_items`; keep `check-vlm` as the pre-flight gate.


| Current command                                                           | Target                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `ingest <file>` (interactive mfr/model/year) — **only ingest path today** | `ingest --item-id <id>` — **primary path** after retarget |
| `check-vlm`                                                               | unchanged — **run before every ingest**                   |
| `list-manuals`                                                            | `list-documents --user-id <id>`                           |
| `delete-manual <id>`                                                      | `delete-chunks --item-id <id>`                            |
| `translate-manual`                                                        | `translate-document --item-id <id>`                       |
| `reembed-manual`                                                          | `reembed-document --item-id <id>`                         |


### Unchanged (reuse as-is)

`docling_pipeline.py`, `chunker.py`, `embeddings/ollama.py`, `reranker.py`, `db.py`, `worker.py` queue pattern, `api/main.py` structure.

---

## AS500 — Required Code Changes


| File                                         | Change                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `server/src/app/db/schema.ts`                | RAG columns + `document_chunks` (done); run `npm run db:generate` — see **Drizzle schema and migrations** |
| `server/src/app/services/documentService.ts` | Today: upload only. Target: `ingest_status = 'pending'` + `POST /ingest` on upload                        |
| `server/src/app/mcp/knowledgeTools.ts`       | **New** — `registerMcpTools` group implementing `knowledge_`* handlers                                    |
| `server/src/app/index.ts`                    | Import `knowledgeTools.js`                                                                                |
| `server/src/core/ai/chatService.ts`          | Remove `fetchDocsContext()` pre-injection                                                                 |
| `server/src/app/services/docsClient.ts`      | **Deprecate** — replace with MCP tool handlers                                                            |
| `server/src/index.ts`                        | Update `/docs-pages/` and `/docs-images/` proxy paths to `document_item_id`                               |
| `DOCS/MANUAL_RAG.md`                         | Replace with hierarchical RAG runbook                                                                     |


---

## Database

```txt
PostgreSQL 16
+ pgvector extension
+ Ollama on VPS host (:11434)
```

### Who owns which tables


| Table                     | Owner      | Migration tool                                  |
| ------------------------- | ---------- | ----------------------------------------------- |
| `document_folders`        | AS500      | **Drizzle** — `server/src/app/db/schema.ts`     |
| `document_items`          | AS500      | **Drizzle**                                     |
| `document_chunks`         | AS500      | **Drizzle**                                     |
| `document_pages`          | as500-docs | **Alembic** — `../as500-docs/alembic/versions/` |
| `document_images`         | as500-docs | **Alembic**                                     |
| `document_tables`         | as500-docs | **Alembic**                                     |
| `document_ingestion_jobs` | as500-docs | **Alembic**                                     |


Core hierarchy + search index live in the AS500 app schema. Docling extraction artifacts (pages, images, tables, job queue) live in as500-docs Alembic migrations against the same Postgres database.

---

## Drizzle schema and migrations (AS500)

All My Documents + RAG core tables are defined in `**server/src/app/db/schema.ts`** (app layer). Drizzle merges this with core schema in `server/src/core/db/index.ts`. Migrations land in `**server/src/core/db/migrations/**` and are applied automatically at server startup via `migrate()`.

### Tables in `schema.ts` today


| Export            | SQL table          | Purpose                                 |
| ----------------- | ------------------ | --------------------------------------- |
| `embeddingVector` | (custom type)      | `vector(768)` columns for pgvector      |
| `documentFolders` | `document_folders` | Hierarchy nodes + RAG folder embeddings |
| `documentItems`   | `document_items`   | Uploaded files + ingest metadata        |
| `documentChunks`  | `document_chunks`  | Searchable chunks + embeddings          |


### Migration history (already applied)


| Migration                      | What it added                                       |
| ------------------------------ | --------------------------------------------------- |
| `0009_tense_supernaut.sql`     | `document_folders`, `document_items` (base columns) |
| `0010_mature_typhoid_mary.sql` | `description` on both tables                        |


### Migration still to generate (RAG columns)

`schema.ts` already defines the RAG additions below, but **no Drizzle migration file exists yet** for them. Generate and apply before enabling ingestion/search:

`**document_folders`** — add:

- `notes`, `ai_summary`
- `title_embedding`, `description_embedding`, `ai_summary_embedding` (`vector(768)`)

`**document_items**` — add:

- `ai_summary`, `content_hash`, `ingest_status` (default `'pending'`)
- index on `content_hash`

`**document_chunks**` — new table:

- FKs: `user_id`, `document_item_id`, `folder_id`
- `text`, `embedding vector(768) NOT NULL`
- denormalized citation fields: `node_path`, `node_description`, `document_title`, `document_description`
- `page_number`, `page_end`, `section_title`, `content_type`
- indexes on `user_id`, `folder_id`, `document_item_id`

### Step-by-step: generate and apply

From the **repo root** (or `server/`):

```bash
# 1. Ensure schema.ts matches this spec (already done in repo)

# 2. Generate migration SQL from schema diff
cd server
npm run db:generate
# → creates server/src/core/db/migrations/0011_<name>.sql + meta snapshot

# 3. Review the generated SQL, then hand-edit if needed (see pgvector note below)

# 4. Apply — either restart the server (auto-migrate on boot) or:
npm run db:migrate

# 5. Verify from repo root
npm run typecheck
```

### pgvector — manual migration edits

Drizzle generates `vector(768)` column types via the `embeddingVector` custom type, but it **does not** emit:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

or HNSW / GIN indexes. After `db:generate`, **edit the new migration file** to prepend/append:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- optional but recommended for search performance (as500-docs search.py):
CREATE INDEX idx_document_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX idx_document_folders_title_embedding ON document_folders
  USING hnsw (title_embedding vector_cosine_ops);
-- repeat for description_embedding, ai_summary_embedding
--> statement-breakpoint
-- BM25 support: generated tsvector column or GIN on to_tsvector('english', text)
-- (may be owned by as500-docs Alembic instead — align with search.py implementation)
```

Use the same Postgres image that supports pgvector in production (`pgvector/pgvector:pg16` or extension installed on the VPS Postgres instance).

### `embeddingVector` custom type

Defined at the top of `schema.ts`:

```typescript
export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: unknown) {
    const dimensions = (config as { dimensions?: number } | undefined)?.dimensions ?? 768;
    return `vector(${dimensions})`;
  },
  // ...
});
```

Default dimension **768** matches Ollama `nomic-embed-text`. Do not change without updating `EMBEDDING_DIM` in as500-docs.

### Services import path

App services use the merged Drizzle instance:

```typescript
import { db } from '../../core/db/index.js';
import { documentFolders, documentItems, documentChunks } from '../db/schema.js';
```

New RAG services and MCP handlers follow the same pattern as `documentService.ts`.

### Checklist before RAG cutover

- [ ] `schema.ts` exports `documentFolders`, `documentItems`, `documentChunks` with all RAG columns
- [ ] `npm run db:generate` run; `0011_*.sql` committed
- [ ] Migration includes `CREATE EXTENSION vector` + HNSW indexes (hand-edited)
- [ ] Server starts cleanly; `\d document_chunks` shows `embedding vector(768)` in psql
- [ ] as500-docs Alembic migrations applied for `document_pages`, `document_images`, `document_tables`, `document_ingestion_jobs`

### Indexes (target state)

```txt
document_folders:   user_id, parent_id, HNSW on *_embedding
document_items:     user_id, folder_id, content_hash
document_chunks:    user_id, folder_id, document_item_id, HNSW on embedding, GIN/tsvector on text
document_ingestion_jobs: state, created_at  (as500-docs Alembic)
```

---

## Deployment

### Production VPS (search + chat)

```bash
# Ollama on VPS — embeddings, summaries, agent LLM
ollama pull nomic-embed-text
ollama pull <RAG_MODEL>

# AS500 stack
cd /var/www/AS500
docker compose -f docker-compose.prod.yml up -d postgres app

# as500-docs API + worker (search; ingest jobs if worker can reach vLLM)
cd /var/www/as500-docs
docker compose up -d
```

`DOCS_API_URL=http://as500-docs:8080` in AS500 app container. `OLLAMA_BASE_URL` points at VPS Ollama.

### Dev machine (ingest — CLI)

Ingest is run from the **dev GPU host**, not the VPS, because vLLM requires the local GPU:

```powershell
# Terminal 1 — vLLM (required)
cd C:\Users\fredr\code\vLLM-5090
.\run-d.bat

# Terminal 2 — Ollama (required for embeddings)
.\scripts\start-ollama.ps1   # in as500-agent repo, or system Ollama

# Terminal 3 — verify + ingest
cd C:\Users\fredr\code\as500-docs
python -m as500_docs.cli check-vlm
python -m as500_docs.cli ingest --item-id <document_item_id>
```

`VLM_API_URL` in as500-docs `.env` must resolve from where the CLI/worker runs (`http://127.0.0.1:8000/v1` on host; `http://host.docker.internal:8000/v1` from Docker worker on Windows).

Postgres is the shared AS500 instance (`localhost:5433` host / `postgres:5432` Docker). Ingested `document_chunks` are immediately visible to VPS search once DB is shared.

---

## Agent Workflow

```txt
User Question
      ↓
knowledge_find_nodes()        — which folder(s) are relevant?
      ↓
knowledge_search()            — chunks inside those folders
      ↓
(optionally knowledge_get_chunk() for exact citation text)
      ↓
answer + citations
```

The MCP server is responsible for navigation, retrieval, filtering, and reranking. The agent should never directly query database structures.

---

## Cutover from Legacy Manuals

**No migration of existing `manuals`* data.** Workshop manuals already ingested under the old pipeline will be **re-uploaded** into My Documents (organized in the new folder hierarchy) and **re-ingested** by as500-docs into `document_`* tables. Chunk embeddings, pages, and images are rebuilt from the source PDFs on disk.

### Cutover steps

1. Deploy `document_*` schema + as500-docs changes targeting My Documents
2. Users upload PDFs via My Documents (create folders as needed, e.g. `/Motorcycles/CFMOTO 450MT/`)
3. **Start vLLM + Ollama** on dev GPU host; run `as500-docs cli ingest --item-id <id>` for each file (CLI-only until auto-trigger exists)
4. Register `knowledge_`* MCP tools on AS500; update as500-agent system prompt
5. Remove `fetchDocsContext` from `chatService.ts`
6. Deprecate legacy `ingest <file>` (manuals), `GET /manuals`, `docsClient.ts`, legacy `/search?manual_id=`
7. Drop `manuals*` tables after optional DB backup (no row copy required)
8. **Later:** wire `documentService.ts` → `POST /ingest` so upload triggers worker without CLI

There is **no parallel-run period** where legacy manuals stay searchable alongside the new system. Until a PDF is re-uploaded to My Documents **and ingested via CLI** (vLLM + Ollama running), it is not in the knowledge base.