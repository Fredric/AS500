#!/usr/bin/env node
/**
 * AS500 MCP Server
 *
 * Provides tools to list, create, update, and delete time registration entries
 * in the AS500 time-tracking system. Connects directly to the PostgreSQL database.
 *
 * Required environment variables:
 *   AS500_USERNAME — the AS500 user this agent acts as (e.g. "FREDRIC")
 *
 * Database connection (pick one):
 *   DATABASE_URL  — full connection string, OR
 *   PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
 *   (defaults: localhost:5433 / as500 / as500 / as500)
 *
 * Optional:
 *   JIRA_API_TOKEN   — Atlassian API token (required for as500_list_jira_tasks)
 *   JIRA_USER_EMAIL  — Jira account email (required for as500_list_jira_tasks)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, max, sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, integer, numeric, timestamp, date, unique, } from "drizzle-orm/pg-core";
import axios from "axios";
// ---------------------------------------------------------------------------
// Inline schema (mirrors server/src/db/schema.ts — only the tables we need)
// ---------------------------------------------------------------------------
const users = pgTable("users", {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    password_hash: text("password_hash").notNull(),
    full_name: text("full_name"),
    active: boolean("active").default(true).notNull(),
    is_admin: boolean("is_admin").default(false).notNull(),
});
const days = pgTable("days", {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id),
    workday: date("workday", { mode: "string" }).notNull(),
    daysum: numeric("daysum", { precision: 5, scale: 2 }).default("0").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [unique("days_user_id_workday_unique").on(table.user_id, table.workday)]);
const dayItems = pgTable("day_items", {
    id: serial("id").primaryKey(),
    day_id: integer("day_id").notNull().references(() => days.id, { onDelete: "cascade" }),
    start_hour: text("start_hour").notNull(),
    end_hour: text("end_hour").notNull(),
    jiratask: text("jiratask"),
    description: text("description"),
    rowsum: numeric("rowsum", { precision: 5, scale: 2 }).default("0").notNull(),
    sort_order: integer("sort_order").default(0).notNull(),
});
// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------
const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    host: useDatabaseUrl ? undefined : (process.env.PGHOST ?? "localhost"),
    port: useDatabaseUrl ? undefined : parseInt(process.env.PGPORT ?? "5433", 10),
    database: useDatabaseUrl ? undefined : (process.env.PGDATABASE ?? "as500"),
    user: useDatabaseUrl ? undefined : (process.env.PGUSER ?? "as500"),
    password: useDatabaseUrl ? undefined : (process.env.PGPASSWORD ?? "as500"),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
const db = drizzle(pool, { schema: { users, days, dayItems } });
let authedUser;
async function resolveConfiguredUser() {
    const username = process.env.AS500_USERNAME?.toUpperCase().trim();
    if (!username)
        throw new Error("AS500_USERNAME environment variable is not set.");
    const rows = await db
        .select({ id: users.id, username: users.username, is_admin: users.is_admin })
        .from(users)
        .where(and(eq(users.username, username), eq(users.active, true)));
    if (!rows[0])
        throw new Error(`User '${username}' not found or inactive in AS500.`);
    return rows[0];
}
// ---------------------------------------------------------------------------
// Time helpers (mirrors server/src/services/timeReg.ts)
// ---------------------------------------------------------------------------
function normalizeTime(time) {
    const t = time.trim();
    if (t.includes(":"))
        return t;
    if (t.length <= 2)
        return `${t.padStart(2, "0")}:00`;
    const h = t.slice(0, t.length - 2);
    const m = t.slice(-2);
    return `${h.padStart(2, "0")}:${m}`;
}
function isValidTime(t) {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m)
        return false;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}
function calculateHours(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diff = endMin >= startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
    return Math.round((diff / 60) * 100) / 100;
}
// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function getOrCreateDay(userId, workday) {
    const existing = await db
        .select({ id: days.id, daysum: days.daysum })
        .from(days)
        .where(and(eq(days.user_id, userId), eq(days.workday, workday)));
    if (existing[0])
        return existing[0];
    const inserted = await db
        .insert(days)
        .values({ user_id: userId, workday, daysum: "0" })
        .returning({ id: days.id, daysum: days.daysum });
    return inserted[0];
}
async function refreshDaysum(dayId) {
    await db
        .update(days)
        .set({ daysum: sql `(SELECT COALESCE(SUM(rowsum), 0) FROM day_items WHERE day_id = ${dayId})` })
        .where(eq(days.id, dayId));
}
function errorResponse(message) {
    return { content: [{ type: "text", text: `Error: ${message}` }] };
}
// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
    name: "as500-mcp-server",
    version: "1.0.0",
});
// ── List time entries ────────────────────────────────────────────────────────
server.registerTool("as500_list_time_entries", {
    title: "List Time Entries",
    description: `List all time registration entries for the configured user on a specific date.

Args:
  - date (string): Work date in YYYY-MM-DD format (e.g. "2025-03-15")

Returns JSON:
  {
    "date": string,
    "username": string,
    "day_id": number,
    "daysum": string,
    "entries": [{ "id", "start_hour", "end_hour", "rowsum", "jiratask", "description" }]
  }`,
    inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ date }) => {
    try {
        const day = await getOrCreateDay(authedUser.id, date);
        const items = await db
            .select()
            .from(dayItems)
            .where(eq(dayItems.day_id, day.id))
            .orderBy(dayItems.sort_order, dayItems.id);
        const output = {
            date,
            username: authedUser.username,
            day_id: day.id,
            daysum: day.daysum,
            entries: items.map((item) => ({
                id: item.id,
                start_hour: item.start_hour,
                end_hour: item.end_hour,
                rowsum: item.rowsum,
                jiratask: item.jiratask ?? "",
                description: item.description ?? "",
            })),
        };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
    }
});
// ── Create time entry ────────────────────────────────────────────────────────
server.registerTool("as500_create_time_entry", {
    title: "Create Time Entry",
    description: `Create a new time registration entry for the configured user on a specific date.

- start_hour / end_hour: accepts HH:MM or shorthand (e.g. "8", "800", "0800")
- jiratask: Jira task key, e.g. "TASK-101" (optional)
- description: free-text (optional)

Returns JSON of the created entry including its id.`,
    inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
        start_hour: z.string().describe("Start time (HH:MM or shorthand like 800)"),
        end_hour: z.string().describe("End time (HH:MM or shorthand like 1700)"),
        jiratask: z.string().optional().describe("Jira task key (optional)"),
        description: z.string().optional().describe("Description (optional)"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ date, start_hour, end_hour, jiratask, description }) => {
    try {
        const startNorm = normalizeTime(start_hour);
        const endNorm = normalizeTime(end_hour);
        if (!isValidTime(startNorm))
            return errorResponse(`Invalid start_hour '${start_hour}'. Use HH:MM or shorthand like 800 or 0800.`);
        if (!isValidTime(endNorm))
            return errorResponse(`Invalid end_hour '${end_hour}'. Use HH:MM or shorthand like 1700.`);
        if (endNorm <= startNorm)
            return errorResponse("end_hour must be after start_hour.");
        const day = await getOrCreateDay(authedUser.id, date);
        const rowsum = calculateHours(startNorm, endNorm);
        const maxOrder = await db
            .select({ maxOrder: max(dayItems.sort_order) })
            .from(dayItems)
            .where(eq(dayItems.day_id, day.id));
        const nextOrder = (maxOrder[0]?.maxOrder ?? 0) + 1;
        const inserted = await db
            .insert(dayItems)
            .values({
            day_id: day.id,
            start_hour: startNorm,
            end_hour: endNorm,
            jiratask: jiratask?.trim() || null,
            description: description?.trim() || null,
            rowsum: rowsum.toFixed(2),
            sort_order: nextOrder,
        })
            .returning();
        await refreshDaysum(day.id);
        return {
            content: [{ type: "text", text: JSON.stringify(inserted[0], null, 2) }],
            structuredContent: inserted[0],
        };
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
    }
});
// ── Update time entry ────────────────────────────────────────────────────────
server.registerTool("as500_update_time_entry", {
    title: "Update Time Entry",
    description: `Update an existing time registration entry by its ID.
Only entries belonging to the configured user can be updated.

- Pass empty string for jiratask or description to clear those fields.

Returns JSON of the updated entry.`,
    inputSchema: z.object({
        entry_id: z.number().int().positive().describe("ID of the time entry to update"),
        start_hour: z.string().describe("New start time (HH:MM or shorthand)"),
        end_hour: z.string().describe("New end time (HH:MM or shorthand)"),
        jiratask: z.string().optional().describe("Jira task key (optional, empty string to clear)"),
        description: z.string().optional().describe("Description (optional, empty string to clear)"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ entry_id, start_hour, end_hour, jiratask, description }) => {
    try {
        // Verify ownership
        const entryRows = await db
            .select({ day_id: dayItems.day_id })
            .from(dayItems)
            .where(eq(dayItems.id, entry_id));
        if (!entryRows[0])
            return errorResponse(`No time entry found with id ${entry_id}.`);
        const dayRows = await db
            .select({ user_id: days.user_id })
            .from(days)
            .where(eq(days.id, entryRows[0].day_id));
        if (!dayRows[0] || dayRows[0].user_id !== authedUser.id) {
            return errorResponse(`Entry ${entry_id} does not belong to user '${authedUser.username}'.`);
        }
        const startNorm = normalizeTime(start_hour);
        const endNorm = normalizeTime(end_hour);
        if (!isValidTime(startNorm))
            return errorResponse(`Invalid start_hour '${start_hour}'.`);
        if (!isValidTime(endNorm))
            return errorResponse(`Invalid end_hour '${end_hour}'.`);
        if (endNorm <= startNorm)
            return errorResponse("end_hour must be after start_hour.");
        const updated = await db
            .update(dayItems)
            .set({
            start_hour: startNorm,
            end_hour: endNorm,
            jiratask: jiratask !== undefined ? (jiratask.trim() || null) : undefined,
            description: description !== undefined ? (description.trim() || null) : undefined,
            rowsum: calculateHours(startNorm, endNorm).toFixed(2),
        })
            .where(eq(dayItems.id, entry_id))
            .returning();
        await refreshDaysum(updated[0].day_id);
        return {
            content: [{ type: "text", text: JSON.stringify(updated[0], null, 2) }],
            structuredContent: updated[0],
        };
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
    }
});
// ── Delete time entry ────────────────────────────────────────────────────────
server.registerTool("as500_delete_time_entry", {
    title: "Delete Time Entry",
    description: `Delete a time registration entry by its ID.
Only entries belonging to the configured user can be deleted.

Returns a confirmation message.`,
    inputSchema: z.object({
        entry_id: z.number().int().positive().describe("ID of the time entry to delete"),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ entry_id }) => {
    try {
        const entryRows = await db
            .select({ day_id: dayItems.day_id })
            .from(dayItems)
            .where(eq(dayItems.id, entry_id));
        if (!entryRows[0])
            return errorResponse(`No time entry found with id ${entry_id}.`);
        const dayRows = await db
            .select({ user_id: days.user_id })
            .from(days)
            .where(eq(days.id, entryRows[0].day_id));
        if (!dayRows[0] || dayRows[0].user_id !== authedUser.id) {
            return errorResponse(`Entry ${entry_id} does not belong to user '${authedUser.username}'.`);
        }
        const dayId = entryRows[0].day_id;
        await db.delete(dayItems).where(eq(dayItems.id, entry_id));
        await refreshDaysum(dayId);
        return { content: [{ type: "text", text: `Time entry ${entry_id} deleted successfully.` }] };
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
    }
});
// ── List Jira tasks ──────────────────────────────────────────────────────────
server.registerTool("as500_list_jira_tasks", {
    title: "List Jira Tasks",
    description: `List open Jira tasks assigned to the configured Jira user.
Requires JIRA_API_TOKEN and JIRA_USER_EMAIL environment variables.

Returns JSON array of { id, name, status, assignee } objects.
Use the 'id' value (e.g. "TASK-101") as jiratask when creating or updating time entries.`,
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => {
    try {
        const apiToken = process.env.JIRA_API_TOKEN;
        const jiraEmail = process.env.JIRA_USER_EMAIL;
        if (!apiToken)
            return errorResponse("JIRA_API_TOKEN environment variable is not set.");
        if (!jiraEmail)
            return errorResponse("JIRA_USER_EMAIL environment variable is not set.");
        const jira = axios.create({
            baseURL: "https://stepwise-as.atlassian.net",
            auth: { username: jiraEmail, password: apiToken },
            headers: { Accept: "application/json" },
        });
        const jql = "assignee = currentUser() AND (status != Done OR resolution != Done) ORDER BY created DESC";
        const response = await jira.get("/rest/api/3/search/jql", {
            params: { jql, maxResults: 50, fields: "key,summary,status,assignee" },
        });
        const tasks = response.data.issues.map((issue) => ({
            id: issue.key,
            name: issue.fields.summary,
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName ?? "",
        }));
        return {
            content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
            structuredContent: { tasks },
        };
    }
    catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
    }
});
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
    const client = await pool.connect();
    client.release();
    authedUser = await resolveConfiguredUser();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`AS500 MCP server running via stdio (user: ${authedUser.username})`);
}
main().catch((err) => {
    console.error("Failed to start AS500 MCP server:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map