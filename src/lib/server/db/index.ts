import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env, ensureDataDir } from '../env';
import * as schema from './schema';

ensureDataDir();
fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });

export const sqlite = new Database(env.DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('temp_store = MEMORY');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export function nowIso() {
  return new Date().toISOString();
}
