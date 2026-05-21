#!/usr/bin/env node
/**
 * AS500 Audit Log CLI viewer
 *
 * Usage:
 *   npm run audit
 *   npm run audit -- --user FREDRIC
 *   npm run audit -- --type auth
 *   npm run audit -- --source terminal
 *   npm run audit -- --hours 4
 *   npm run audit -- --limit 100
 *   npm run audit -- --ok false        (only failures)
 *   npm run audit -- --tail            (follow mode, poll every 3s)
 *
 * Flags:
 *   --user    <username>   Filter by username (case-insensitive)
 *   --type    <event_type> Filter by event type: auth|crud|mcp|api|session
 *   --source  <source>     Filter by source: terminal|mcp|api
 *   --hours   <n>          Show events from last N hours (default: 24)
 *   --limit   <n>          Max rows to show (default: 50)
 *   --ok      <true|false> Filter by success/failure
 *   --tail                 Live follow mode (poll every 3s)
 *   --help                 Show this help
 */

import pg from 'pg';
import chalk from 'chalk';
import Table from 'cli-table3';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${chalk.bold.green('AS500 Audit Log Viewer')}

${chalk.dim('Usage:')} npm run audit [-- options]

${chalk.dim('Options:')}
  --user    <username>   Filter by username (case-insensitive)
  --type    <event_type> Filter by event type: auth|crud|mcp|api|session
  --source  <source>     Filter by source: terminal|mcp|api
  --hours   <n>          Show events from last N hours (default: 24)
  --limit   <n>          Max rows to show (default: 50)
  --ok      <true|false> Filter by success/failure
  --tail                 Live follow mode — poll every 3s for new rows
  --help                 Show this help

${chalk.dim('Examples:')}
  npm run audit -- --user FREDRIC --hours 1
  npm run audit -- --type auth --ok false
  npm run audit -- --source mcp --limit 200
  npm run audit -- --tail

${chalk.dim('Log files (lnav-compatible NDJSON):')}
  server/logs/audit-YYYY-MM-DD.ndjson
  ${chalk.cyan('lnav server/logs/audit-*.ndjson')}
`);
  process.exit(0);
}

function getArg(name, defaultValue = undefined) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultValue;
  return args[idx + 1];
}

const filterUser   = getArg('user');
const filterType   = getArg('type');
const filterSource = getArg('source');
const filterOk     = getArg('ok');
const hours        = parseInt(getArg('hours', '24'), 10);
const limit        = Math.min(parseInt(getArg('limit', '50'), 10), 1000);
const tailMode     = args.includes('--tail');

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------

async function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // Try loading from .env.local in server/
  const envPath = join(__dirname, '..', '.env.local');
  try {
    const content = await readFile(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    // Fallback: construct from PG* vars in the file
    const vars = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD)\s*=\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    if (vars.PGHOST) {
      return `postgresql://${vars.PGUSER ?? 'postgres'}:${vars.PGPASSWORD ?? ''}@${vars.PGHOST}:${vars.PGPORT ?? 5433}/${vars.PGDATABASE ?? 'as500'}`;
    }
  } catch {
    // No .env.local — fall through to defaults
  }

  // Docker Compose default
  return 'postgresql://postgres:postgres@localhost:5433/as500';
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

async function fetchRows(pool, since) {
  const conditions = ['al.created_at > $1'];
  const values = [since];
  let idx = 2;

  if (filterUser) {
    conditions.push(`UPPER(al.username) = UPPER($${idx++})`);
    values.push(filterUser);
  }
  if (filterType) {
    conditions.push(`al.event_type = $${idx++}`);
    values.push(filterType);
  }
  if (filterSource) {
    conditions.push(`al.source = $${idx++}`);
    values.push(filterSource);
  }
  if (filterOk !== undefined) {
    conditions.push(`al.ok = $${idx++}`);
    values.push(filterOk === 'true' || filterOk === '1');
  }

  const where = conditions.join(' AND ');
  const query = `
    SELECT
      al.id,
      al.created_at,
      al.event_type,
      al.action,
      al.source,
      al.username,
      al.user_id,
      al.config_id,
      al.record_id,
      al.ok,
      al.error_code,
      al.duration_ms,
      al.ip_address
    FROM audit_log al
    WHERE ${where}
    ORDER BY al.created_at DESC
    LIMIT ${limit}
  `;

  const result = await pool.query(query, values);
  return result.rows.reverse(); // show oldest → newest
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const EVENT_TYPE_COLORS = {
  auth:    chalk.yellow,
  crud:    chalk.cyan,
  mcp:     chalk.magenta,
  api:     chalk.blue,
  session: chalk.white,
};

function colorizeType(type) {
  return (EVENT_TYPE_COLORS[type] ?? chalk.white)(type.padEnd(7));
}

function formatAction(action) {
  const colors = {
    login: chalk.green, login_failed: chalk.red, logout: chalk.yellow,
    token_refresh: chalk.yellow, create: chalk.green, update: chalk.cyan,
    delete: chalk.red, list: chalk.white, read: chalk.white,
    connect: chalk.green, disconnect: chalk.yellow, resume: chalk.cyan,
    expire: chalk.red,
  };
  return (colors[action] ?? chalk.white)(action.padEnd(14));
}

function formatOk(ok) {
  return ok ? chalk.green('✓') : chalk.red('✗');
}

function formatTs(d) {
  if (!d) return '';
  const dt = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return chalk.dim(
    `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ` +
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
  );
}

function formatSource(s) {
  const colors = { terminal: chalk.green, mcp: chalk.magenta, api: chalk.blue };
  return (colors[s] ?? chalk.white)((s ?? '').padEnd(8));
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log(chalk.dim('  (no rows matching filter)'));
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('When'),
      chalk.bold('Type'),
      chalk.bold('Action'),
      chalk.bold('Via'),
      chalk.bold('User'),
      chalk.bold('Config'),
      chalk.bold('OK'),
      chalk.bold('Error / ms'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [21, 9, 16, 10, 14, 14, 4, 26],
    wordWrap: false,
  });

  for (const r of rows) {
    const errOrMs = r.ok
      ? chalk.dim(`${r.duration_ms}ms`)
      : chalk.red(`${r.error_code ?? '?'} (${r.duration_ms}ms)`);

    table.push([
      formatTs(r.created_at),
      colorizeType(r.event_type),
      formatAction(r.action),
      formatSource(r.source),
      r.username ? chalk.bold(r.username) : chalk.dim(`#${r.user_id ?? '?'}`),
      chalk.dim(r.config_id ?? ''),
      formatOk(r.ok),
      errOrMs,
    ]);
  }

  console.log(table.toString());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const connStr = await getConnectionString();
  const pool = new pg.Pool({ connectionString: connStr, max: 2 });

  console.log(chalk.bold.green('\n AS500 Audit Log') + chalk.dim(` — ${new Date().toISOString()}`));
  if (filterUser)   console.log(chalk.dim(`  user:   ${filterUser}`));
  if (filterType)   console.log(chalk.dim(`  type:   ${filterType}`));
  if (filterSource) console.log(chalk.dim(`  source: ${filterSource}`));
  if (filterOk !== undefined) console.log(chalk.dim(`  ok:     ${filterOk}`));
  console.log(chalk.dim(`  hours:  ${hours}  limit: ${limit}${tailMode ? '  [TAIL]' : ''}`));
  console.log();

  if (tailMode) {
    // Tail mode: poll every 3s for new rows
    let lastId = 0;
    let firstRun = true;
    const since = new Date(Date.now() - hours * 3600 * 1000);

    process.stdout.write(chalk.dim(`Tailing audit log (Ctrl+C to stop)...\n\n`));

    const poll = async () => {
      const rows = await fetchRows(pool, firstRun ? since : new Date(Date.now() - 10000));
      const newRows = rows.filter(r => r.id > lastId);
      if (newRows.length > 0) {
        printTable(newRows);
        lastId = Math.max(...newRows.map(r => r.id));
      }
      firstRun = false;
    };

    await poll();
    const interval = setInterval(poll, 3000);

    process.on('SIGINT', () => {
      clearInterval(interval);
      pool.end();
      console.log(chalk.dim('\nStopped.'));
      process.exit(0);
    });
  } else {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const rows = await fetchRows(pool, since);
    printTable(rows);
    if (rows.length > 0) {
      console.log(chalk.dim(`\n  ${rows.length} row${rows.length > 1 ? 's' : ''} (last ${hours}h, newest last)\n`));
    }
    await pool.end();
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
