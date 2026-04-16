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
export {};
