import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '../../data/as500.db');
// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '../../data'), { recursive: true });
const db = new Database(dbPath);
// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Days table (one record per workday per user)
  CREATE TABLE IF NOT EXISTS days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    workday TEXT NOT NULL,
    daysum REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, workday),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Day items table (time entries)
  CREATE TABLE IF NOT EXISTS day_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL,
    start_hour TEXT NOT NULL,
    end_hour TEXT NOT NULL,
    jiratask TEXT,
    description TEXT,
    rowsum REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
  );
`);
export default db;
