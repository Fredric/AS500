# Hierarchical RAG MCP — Implementation TODO

Companion to [Hierarchical RAG MCP Specification.md](./Hierarchical%20RAG%20MCP%20Specification.md).

This file splits the work into **small, testable phases**. Complete phases in order. Each phase has a **done-when** gate before moving on.

**Test harness:** one Playwright file — `tests/hierarchical-rag-ingest.spec.ts` — grows with the phases. Run:

```bash
npm test -- --grep "Hierarchical RAG"
```

**Fixture PDF:** place a minimal 1–2 page PDF at `tests/fixtures/simple.pdf` (plain text, e.g. "Hello RAG test page 1"). You prepare this once; tests seed a `document_items` row pointing at it.

**External repos:** `../as500-docs` (ingest worker), `../as500-agent` (chat). Phases 0–3 stay in AS500 + as500-docs only.

---

## Status overview

> **Active branch:** `documents` in all three repos (AS500, as500-docs, as500-agent).
> as500-docs containers must be rebuilt after code changes: `docker compose up -d --build` in `../as500-docs`.

| Phase | Name | Repo(s) | Status |
|-------|------|---------|--------|
| 0 | Foundations — schema & fixtures | AS500 | ✅ |
| 1 | Ingest plumbing — job queue + HTTP trigger | AS500 + as500-docs | ✅ |
| 2 | Docling ingest — worker completes one PDF | as500-docs | ⬜ |
| 3 | End-to-end ingest test (upload → worker → chunks) | AS500 + as500-docs | ⬜ |
| 4 | Search — hybrid retrieval on `document_chunks` | as500-docs | ⬜ |
| 5 | MCP `knowledge_*` tools | AS500 | ⬜ |
| 6 | Agent cutover — remove legacy manual RAG | AS500 + as500-agent | ⬜ |
| 7 | Polish — auto-ingest on upload, re-ingest, folder embeddings | AS500 + as500-docs | ⬜ |

---

## Dev prerequisites (all ingest phases)

Keep this checklist handy; ingest tests **fail fast** if any item is missing.

```txt
[ ] AS500 Postgres up          docker compose up -d postgres   (localhost:5433)
[ ] pgvector extension         CREATE EXTENSION IF NOT EXISTS vector;
[ ] vLLM running               granite-docling-258M on :8000
[ ] Ollama running             nomic-embed-text pulled
[ ] as500-docs .env            USE_VLM=true, DATABASE_URL, VLM_API_URL, OLLAMA_BASE_URL
[ ] as500-docs worker up       docker compose up -d   (in ../as500-docs)
[ ] check-vlm passes           python -m as500_docs.cli check-vlm
```

`tests/hierarchical-rag-ingest.spec.ts` should include a `beforeAll` helper `assertIngestPrerequisites()` that checks Postgres + optional HTTP health (`GET http://localhost:8080/healthz`) and **skips** ingest tests with a clear message when vLLM/Ollama/worker are down (so CI without GPU does not flake).

---

## Phase 0 — Foundations (AS500)

**Goal:** Database and test fixture ready; no ingestion yet.

### Tasks

- [x] **0.1** Confirm `server/src/app/db/schema.ts` exports `documentFolders`, `documentItems`, `documentChunks` with RAG columns (768-dim `embeddingVector`, `ingest_status`, etc.) — already in repo; verify against spec.
- [x] **0.2** Generate Drizzle migration `0011_*` from schema diff:
  ```bash
  cd server && npm run db:generate && npm run db:migrate
  ```
- [x] **0.3** Hand-edit `0011_*.sql`:
  - Prepend `CREATE EXTENSION IF NOT EXISTS vector;`
  - Add HNSW index on `document_chunks.embedding` (see spec § Drizzle schema and migrations)
  - Add `document_chunks` table + RAG columns on folders/items if not emitted cleanly
- [x] **0.4** Add `tests/fixtures/simple.pdf` (user-provided minimal PDF).
- [x] **0.5** Create `tests/hierarchical-rag-ingest.spec.ts` with:
  - DB pool helper (reuse pattern from `tests/testSetup.ts`)
  - `seedDocumentItem(userId, pdfPath)` — inserts `document_items` row + copies file to `server/data/documents/{userId}/`
  - Teardown: delete test rows (`document_items`, `document_chunks`, folders) by sentinel name prefix `E2E_RAG_`

### Done when

- [x] Server starts; `\d document_chunks` shows `embedding vector(768)`
- [x] Test **0.A** passes: `seedDocumentItem` creates row with `ingest_status = 'pending'` and file on disk

### Test cases (file section: `Phase 0 — schema`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 0.A | `document_items row seeds with pending status` | Row exists, `storage_path` readable, `ingest_status` is `pending` |
| 0.B | `document_chunks table exists` | `SELECT 1 FROM document_chunks LIMIT 0` succeeds |

---

## Phase 1 — Ingest plumbing (AS500 + as500-docs)

**Goal:** AS500 can enqueue an ingest job; as500-docs worker can claim it — **no Docling yet** (stub handler OK for 1.B only).

### as500-docs tasks

- [x] **1.1** Alembic migration: `document_pages`, `document_images`, `document_tables`, `document_ingestion_jobs` (spec data model).
- [x] **1.2** ORM models for `document_items`, `document_ingestion_jobs` (read AS500 tables; do not duplicate folder/chunk tables if owned by Drizzle).
- [x] **1.3** `POST /ingest` body: `{ document_item_id: number, user_id: number }` — inserts job `state = 'queued'`.
- [x] **1.4** `worker.py`: claim job payload `{ document_item_id, user_id }` (replace motorcycle metadata).
- [x] **1.5** Service auth: shared secret header (e.g. `X-Docs-Ingest-Key`) — AS500 and as500-docs `.env` must match.

### AS500 tasks

- [x] **1.6** `documentService.enqueueIngest(documentItemId, userId)` — `POST ${DOCS_API_URL}/ingest`.
- [x] **1.7** Set `ingest_status = 'processing'` when enqueue succeeds (keep `pending` on failure).
- [x] **1.8** `DOCS_API_URL` in `server/.env.local` / `.env.example` (default `http://localhost:8080` for host dev).

### Done when

- [x] Test **1.A** passes: POST /ingest creates `document_ingestion_jobs` row in `queued` state
- [x] Test **1.B** passes: worker picks job, sets `state = 'processing'` (stub: immediately `completed` + `ingest_status = 'ready'` without chunks — proves queue only)

### Test cases (file section: `Phase 1 — job queue`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 1.A | `POST /ingest enqueues job` | HTTP 202/200; job row `queued` |
| 1.B | `worker claims queued job` | Within 30s job → `completed`; `document_items.ingest_status` updated |

---

## Phase 2 — Docling ingest via worker (as500-docs) ★ core milestone

**Goal:** Worker runs real pipeline for one `document_item_id`: Docling (vLLM) → chunk → Ollama embed → Postgres.

### Implementation entry point (critical for agent resumption)

The worker (`worker.py`) already calls `ingest_document_item` via:

```python
from as500_docs.ingestion import ingest_document_item
await ingest_document_item(document_item_id=..., user_id=...)
```

This import currently raises `ImportError` (caught by a try/except stub that marks the item `ready`). **Phase 2 = implement `async def ingest_document_item(document_item_id, user_id)` in `ingestion.py`.** The existing `ingest_pdf()` function is the manual-pipeline reference; adapt it for the document pipeline.

> **Fixture PDF:** `tests/fixtures/simple.pdf` is a minimal hand-crafted 681-byte PDF. Docling's VLM pipeline renders page images — this file likely produces no extractable content. **Replace it with a real 1-2 page PDF** (e.g. copy any small PDF into `tests/fixtures/simple.pdf`) before running Phase 2 tests.

### Tasks

- [ ] **2.1** `ingestion.py`: implement `async def ingest_document_item(document_item_id: int, user_id: int)` — read `document_items.storage_path` from Postgres, run full pipeline.
- [ ] **2.2** Run `docling_pipeline.py` (`USE_VLM=true`) — pages, images, tables extraction unchanged.
- [ ] **2.3** `chunker.py` → write `document_chunks` with denormalized fields (`node_path`, `document_title`, `page_number`, …). `node_path` = folder breadcrumb (query `document_folders` chain via `folder_id`).
- [ ] **2.4** `embeddings/ollama.py` — 768-dim vectors into `document_chunks.embedding`.
- [ ] **2.5** Write auxiliary rows: `document_pages`, `document_images`, `document_tables`.
- [ ] **2.6** Set `document_items.content_hash` (SHA256), `ai_summary` (Ollama), `ingest_status = 'ready'` on success; `'failed'` + job `error` on failure.
- [ ] **2.7** `storage.py`: extracted assets under `storage/documents/{userId}/{itemId}/`.
- [ ] **2.8** CLI parity: `python -m as500_docs.cli ingest --item-id <id>` calls same code path as worker (manual debug path).

### Done when

- [ ] Test **2.A** passes against `tests/fixtures/simple.pdf` (replace with real PDF first)
- [ ] `check-vlm` + Ollama were running during test
- [ ] At least one `document_chunks` row with non-null `embedding` and `text` containing fixture content

### Test cases (file section: `Phase 2 — docling ingest`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 2.A | `worker ingests simple PDF into document_chunks` | `ingest_status = 'ready'`; `COUNT(*) >= 1` chunks; embedding not null |
| 2.B | `document_pages populated` | `COUNT(*) >= 1` pages for item |
| 2.C | `ingest is idempotent by content_hash` | Re-run job skips re-extract if hash unchanged (or replaces chunks cleanly) |
| 2.D | `failed ingest sets ingest_status failed` | Point item at missing file → `failed` + job error message |

---

## Phase 3 — End-to-end via My Documents (AS500 + as500-docs)

**Goal:** Full path without CLI: seed/upload → enqueue → worker → searchable chunks.

### Tasks

- [ ] **3.0** Add `DOCS_API_URL: http://as500-docs:8080` to the `server` service environment in `docker-compose.yml` — the server container currently has no `DOCS_API_URL`, so `enqueueIngest()` is a silent no-op inside Docker.
- [ ] **3.1** Wire `documentsUpload.ts` / `saveUploadedFile`: after PDF save, call `enqueueIngest` (PDF + image only).
- [ ] **3.2** Optional: poll helper in test — wait for `ingest_status = 'ready'` (timeout 120s for simple PDF).
- [ ] **3.3** Verify `getBreadcrumbPath` metadata lands on chunks (`node_path` matches folder hierarchy).

### Done when

- [ ] Test **3.A** passes: upload API or UI path → chunks without manual CLI

### Test cases (file section: `Phase 3 — e2e upload`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 3.A | `upload PDF triggers ingest and produces chunks` | Upload → poll ready → chunks exist |
| 3.B | `chunk node_path reflects folder breadcrumb` | Folder `/E2E_RAG_Test/` → path prefix correct |

---

## Phase 4 — Search (as500-docs)

**Goal:** Query ingested content via HTTP before MCP exists.

### Tasks

- [ ] **4.1** Retarget `search.py` SQL to `document_chunks` + `user_id` filter.
- [ ] **4.2** `find_relevant_nodes()` on `document_folders.*_embedding`.
- [ ] **4.3** Hybrid vector + BM25 + `reranker.py` (reuse).
- [ ] **4.4** `GET /search?query=...&user_id=...&folder_id=...` (or POST body).

### Done when

- [ ] Test **4.A** passes: search returns chunk from Phase 2/3 fixture with score above `DOCS_MIN_SCORE`

### Test cases (file section: `Phase 4 — search`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 4.A | `search returns fixture text` | Result `text` matches PDF content; `document_title` set |
| 4.B | `search scoped to user_id` | Other user's chunks not returned |

---

## Phase 5 — MCP knowledge tools (AS500)

**Goal:** Agent-retrievable tools; no chat changes yet.

### Tasks

- [ ] **5.1** New `server/src/app/mcp/knowledgeTools.ts` — register `knowledge_search`, `knowledge_find_nodes`, `knowledge_describe_node`, `knowledge_get_document`, `knowledge_get_chunk`.
- [ ] **5.2** Import in `server/src/app/index.ts`.
- [ ] **5.3** Handlers call as500-docs HTTP or Postgres (per spec); `injectFromAuth: 'userId'`; require `documents:read`.
- [ ] **5.4** Extend `tests/hierarchical-rag-ingest.spec.ts` OR add MCP section: `tools/list` includes `knowledge_search`; `tools/call` returns chunks.

### Done when

- [ ] Test **5.A** passes via MCP HTTP (`localhost:3002/mcp`) with FREDRIC token

### Test cases (file section: `Phase 5 — MCP`)

| ID | Test name | Asserts |
|----|-----------|---------|
| 5.A | `knowledge_search returns ingested chunk` | Tool result contains fixture text + citation fields |
| 5.B | `knowledge_get_document shows ready status` | `ingest_status: ready` |
| 5.C | `knowledge_* denied without documents:read` | `permission_denied` for restricted user |

---

## Phase 6 — Agent cutover (AS500 + as500-agent)

**Goal:** Chat uses MCP tools only; legacy manual injection removed.

### Tasks

- [ ] **6.1** Remove `fetchDocsContext()` from `chatService.ts`.
- [ ] **6.2** Update `agent_runner.py` system prompt (knowledge workflow — spec § as500-agent).
- [ ] **6.3** Deprecate `docsClient.ts`; retarget `/docs-pages/` proxy to `documentItemId`.
- [ ] **6.4** Drop `manuals*` tables (as500-docs Alembic) after backup.

### Done when

- [ ] Manual chat smoke: document question triggers `knowledge_search` in agent trace
- [ ] Test **6.A** (optional in same file, tagged `@slow`): MCP tool list from delegated token includes all five `knowledge_*` tools

---

## Phase 7 — Polish (later iterations)

Not blocking first ingest milestone. Track as follow-ups:

- [ ] Folder create/update → Ollama `ai_summary` + folder embeddings
- [ ] Re-ingest on file replace, folder move (update `folder_id` + `node_path` on chunks)
- [ ] Image ingest path (single chunk + caption)
- [ ] Translation + `reembed-document` CLI
- [ ] `ManualSourcePanel` phase 2 citations
- [ ] Production: worker on VPS with vLLM reachable or ingest-only on dev GPU host

---

## Single test file layout

Create `tests/hierarchical-rag-ingest.spec.ts` with this structure:

```typescript
// tests/hierarchical-rag-ingest.spec.ts
//
// One file, serial describe blocks per phase.
// Prerequisites gate skips GPU phases when vLLM/Ollama/worker unavailable.

import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import path from 'path';
import pkg from 'pg';

const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'simple.pdf');
const DOCS_API = process.env.DOCS_API_URL ?? 'http://localhost:8080';
const SENTINEL = 'E2E_RAG_';

test.describe.configure({ mode: 'serial' });

test.describe('Hierarchical RAG — Phase 0 — schema', () => { /* 0.A, 0.B */ });
test.describe('Hierarchical RAG — Phase 1 — job queue', () => { /* 1.A, 1.B — skip until POST /ingest */ });
test.describe('Hierarchical RAG — Phase 2 — docling ingest', () => { /* 2.A–2.D — skip without GPU stack */ });
test.describe('Hierarchical RAG — Phase 3 — e2e upload', () => { /* 3.A, 3.B */ });
test.describe('Hierarchical RAG — Phase 4 — search', () => { /* 4.A, 4.B */ });
test.describe('Hierarchical RAG — Phase 5 — MCP', () => { /* 5.A–5.C */ });
```

**Conventions:**

- Use user **FREDRIC** (`documents:read`) for ingest/search tests; avoid KALLE collision with other E2E suites.
- `beforeAll`: connect pool, resolve `userId`, call `assertIngestPrerequisites()` for phases ≥ 2.
- `afterAll`: delete `E2E_RAG_*` folders/items/chunks/jobs.
- Long-running ingest: `test.setTimeout(180_000)` on Phase 2+.

---

## Suggested iteration order (minimum viable ingest)

Work in this order until **Phase 2 test 2.A** is green — that is the first real milestone:

```txt
1. Phase 0.2–0.5   migration + test skeleton + simple.pdf
2. as500-docs 1.1–1.5 + 2.1–2.8   worker ingests by item id
3. Phase 2.A       one PDF → document_chunks (proves Docling + Ollama + worker)
4. Phase 1.6–1.8   AS500 enqueue (can swap before 3 if you prefer API-first)
5. Phase 3.A       upload trigger
6. Phase 4+        search, MCP, agent
```

---

## Quick manual smoke (before automating 2.A)

```powershell
# Terminal 1 — vLLM
cd C:\Users\fredr\code\vLLM-5090
.\run-d.bat

# Terminal 2 — Ollama + worker
cd C:\Users\fredr\code\as500-docs
docker compose up -d
python -m as500_docs.cli check-vlm

# Terminal 3 — AS500 DB + seed item (or upload via My Documents)
cd C:\Users\fredr\code\AS500
docker compose up -d postgres

# Enqueue (after Phase 1) or CLI (after Phase 2.8):
curl -X POST http://localhost:8080/ingest -H "Content-Type: application/json" -d "{\"document_item_id\": 1, \"user_id\": 1}"

# Verify
psql postgresql://as500:as500@localhost:5433/as500 -c "SELECT id, ingest_status FROM document_items WHERE id = 1;"
psql postgresql://as500:as500@localhost:5433/as500 -c "SELECT COUNT(*) FROM document_chunks WHERE document_item_id = 1;"
```

---

## References

- Spec: [Hierarchical RAG MCP Specification.md](./Hierarchical%20RAG%20MCP%20Specification.md)
- AS500 schema: `server/src/app/db/schema.ts`
- My Documents: `server/src/app/configs/documentsConfig.ts`, `server/src/app/services/documentService.ts`
- as500-docs modules to reuse: `docling_pipeline.py`, `chunker.py`, `worker.py`, `embeddings/ollama.py`
- Legacy runbook (replace): `DOCS/MANUAL_RAG.md`
