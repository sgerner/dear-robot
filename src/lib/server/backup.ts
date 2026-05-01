import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from './env';
import { agentInstructionsPath } from './memory';
import { sqlite } from './db';

type BackupManifest = {
  id: string;
  createdAt: string;
  dbFile: string;
  memoryFile: string | null;
};

function backupsDir() {
  return path.join(env.DATA_DIR, 'backups');
}

function manifestPath() {
  return path.join(backupsDir(), 'manifest.json');
}

function loadManifest() {
  const target = manifestPath();
  if (!fs.existsSync(target)) return [] as BackupManifest[];
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as BackupManifest[];
  } catch {
    return [];
  }
}

function saveManifest(rows: BackupManifest[]) {
  fs.mkdirSync(backupsDir(), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify(rows, null, 2), 'utf8');
}

export function listBackups() {
  return loadManifest().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup() {
  fs.mkdirSync(backupsDir(), { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'triage.db');
  await sqlite.backup(dbFile);
  let memoryFile: string | null = null;
  const memoryPath = agentInstructionsPath();
  if (fs.existsSync(memoryPath)) {
    memoryFile = path.join(dir, 'AGENT_INSTRUCTIONS.md');
    fs.copyFileSync(memoryPath, memoryFile);
  }
  const row: BackupManifest = {
    id,
    createdAt: new Date().toISOString(),
    dbFile,
    memoryFile
  };
  const manifest = loadManifest();
  manifest.push(row);
  saveManifest(manifest);
  return row;
}

export function restoreBackup(id: string) {
  const backup = loadManifest().find((row) => row.id === id);
  if (!backup) throw new Error('Backup not found');
  if (!fs.existsSync(backup.dbFile)) throw new Error('Backup database file missing');
  const backupDb = new Database(backup.dbFile, { readonly: true });
  try {
    sqlite.exec(`PRAGMA foreign_keys=OFF;`);
    const liveTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const backupTables = (backupDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>)
      .map((row) => row.name);
    sqlite.exec(`ATTACH DATABASE '${backup.dbFile.replace(/'/g, "''")}' AS backup_restore; BEGIN;`);
    for (const table of liveTables.map((row) => row.name)) {
      if (table === 'messages_fts') continue;
      if (!backupTables.includes(table)) continue;
      sqlite.exec(`DELETE FROM "${table}";`);
      sqlite.exec(`INSERT INTO "${table}" SELECT * FROM backup_restore."${table}";`);
    }
    sqlite.exec(`COMMIT; DETACH DATABASE backup_restore; PRAGMA foreign_keys=ON;`);
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK; DETACH DATABASE backup_restore; PRAGMA foreign_keys=ON;');
    } catch {
      // ignore rollback cleanup errors
    }
    throw error;
  } finally {
    backupDb.close();
  }
  if (backup.memoryFile && fs.existsSync(backup.memoryFile)) {
    fs.copyFileSync(backup.memoryFile, agentInstructionsPath());
  }
  return { ok: true };
}
