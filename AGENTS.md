# Agents Guide — AS500

This file is the neutral entry point for any AI coding agent working in this repo. It points to the canonical docs and skills; it does not duplicate their content.

## Read first

- **`CLAUDE.md`** — project overview, architecture, commands, conventions. Load this for every task.
- **`ACCESS.md`** — RBAC reference: roles, groups, permission keys, how access gating works in screens and services.

## Skills (task-specific, on-demand knowledge)

Skills are mirrored into each tool's native discovery path. The `SKILL.md` files under `.cursor/skills/` and `.claude/skills/` are byte-identical — edit one, mirror to the other. Copilot uses a trimmed, `applyTo`-scoped variant under `.github/instructions/`.

| Skill | Cursor | Claude Code | GitHub Copilot | Use when |
|---|---|---|---|---|
| **crudtable** | `.cursor/skills/crudtable/SKILL.md` | `.claude/skills/crudtable/SKILL.md` | `.github/instructions/crudtable.instructions.md` (auto-applied via `applyTo`) + pointer in `.github/copilot-instructions.md` | Building or modifying any CRUD screen (list + add/edit/delete) on top of the CRUDTable runtime in `server/src/crudtable/`. |

## Background docs

| Area | Entry point |
|---|---|
| CRUDTable — mental model | `DOCS/CRUDTABLE/5. CRUDTable Concept.md` |
| CRUDTable — field-by-field reference | `DOCS/CRUDTABLE/6. CRUDTable Reference.md` |
| CRUDTable — earlier design iterations (historical) | `DOCS/CRUDTABLE/1. Concept Specification and Idea.md`, `2. AdminUIConfig help.md`, `3. Communication between UI's.md`, `4. CRUDTable Runtime Implementation.md` |
| Production / deployment runbook | `Prod_hetzner.md` |

## Decision guide

When a user asks for a new screen or feature, use this quick triage:

- **A list + create/edit/delete on some entity?** → Load the `crudtable` skill and follow its fast-path recipe. Do not hand-roll a DSL screen.
- **A login, menu, help, dashboard, or wizard screen?** → Write a manual screen in `server/src/screens/` using the DSL, following the patterns in `CLAUDE.md` § "Screen System".
- **A new backend capability without UI?** → Write a plain service in `server/src/services/` using Drizzle (`db` from `../db/index.js`), plus a table in `server/src/db/schema.ts` and a migration via `npm run db:generate`.
- **Access-control change?** → Start from `ACCESS.md`; most CRUD-level gating belongs on the `CRUDTableConfig` (`requirePermission` at screen and per-`ServiceCall` level).

## Repo-wide conventions (quick reference)

- TypeScript with ES module imports — **always use `.js` extensions in relative imports** (`import { x } from './foo.js'`). This is not a typo; the emitted ESM needs them.
- Services take a **single argument** (usually an object) and return plain JS values.
- Screen IDs are `UPPER_SNAKE_CASE`. CRUDTable screens are always `CRUD_{config.id.toUpperCase()}`.
- Don't edit `server/src/index.ts` to add a new CRUD screen — the default case routes all `CRUD_*` IDs.
- Run `npm run typecheck` from the repo root before handing back a non-trivial change.

## Ground truth for "what exists today"

If a doc and the code disagree, the code wins. Primary sources:

- `server/src/crudtable/types.ts` — every config + context interface
- `server/src/crudtable/runtime.ts` — screen build/handle logic
- `server/src/configs/*.ts` — working examples

The reference doc (`DOCS/CRUDTABLE/6. CRUDTable Reference.md`) is kept in sync with these files; the older numbered docs (1–4) are historical and may drift.
