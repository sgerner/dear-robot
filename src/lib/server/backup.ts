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

const BACKUP_RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10));
const BACKUP_MAX_COUNT = Math.max(1, Number.parseInt(process.env.BACKUP_MAX_COUNT || '30', 10));

function backupsDir() {
  return path.join(env.DATA_DIR, 'backups');
}

function resolveInsideBackups(filePath: string) {
  const root = path.resolve(backupsDir());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Backup path escapes backup directory');
  }
  return resolved;
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

function removeBackupFiles(row: BackupManifest) {
  const backupFolder = resolveInsideBackups(path.dirname(row.dbFile));
  fs.rmSync(backupFolder, { recursive: true, force: true });
}

function isManifestEntryPresent(row: BackupManifest) {
  try {
    resolveInsideBackups(row.dbFile);
    if (row.memoryFile) resolveInsideBackups(row.memoryFile);
  } catch {
    return false;
  }
  if (!fs.existsSync(row.dbFile)) return false;
  if (row.memoryFile && !fs.existsSync(row.memoryFile)) return false;
  return true;
}

function pruneManifest() {
  const now = Date.now();
  const retentionMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const sorted = loadManifest().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const survivors: BackupManifest[] = [];
  const toDelete: BackupManifest[] = [];
  for (const row of sorted) {
    if (!isManifestEntryPresent(row)) {
      toDelete.push(row);
      continue;
    }
    const createdAtMs = Date.parse(row.createdAt);
    const olderThanRetention = Number.isFinite(createdAtMs) ? now - createdAtMs > retentionMs : true;
    if (olderThanRetention) {
      toDelete.push(row);
      continue;
    }
    if (survivors.length >= BACKUP_MAX_COUNT) {
      toDelete.push(row);
      continue;
    }
    survivors.push(row);
  }
  for (const row of toDelete) removeBackupFiles(row);
  saveManifest(survivors);
  return survivors;
}

export function backupLifecyclePolicy() {
  return {
    retentionDays: BACKUP_RETENTION_DAYS,
    maxBackups: BACKUP_MAX_COUNT
  };
}

export function listBackups() {
  return pruneManifest();
}

export async function createBackup() {
  fs.mkdirSync(backupsDir(), { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'dear-robot.db');
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
  pruneManifest();
  return row;
}

export function restoreBackup(id: string) {
  const backup = loadManifest().find((row) => row.id === id);
  if (!backup) throw new Error('Backup not found');
  const dbFile = resolveInsideBackups(backup.dbFile);
  const memoryFile = backup.memoryFile ? resolveInsideBackups(backup.memoryFile) : null;
  if (!fs.existsSync(dbFile)) throw new Error('Backup database file missing');
  const backupDb = new Database(dbFile, { readonly: true });
  try {
    sqlite.exec(`PRAGMA foreign_keys=OFF;`);
    const liveTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const backupTables = (
      backupDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    sqlite.exec(`ATTACH DATABASE '${dbFile.replace(/'/g, "''")}' AS backup_restore; BEGIN;`);
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
  if (memoryFile && fs.existsSync(memoryFile)) {
    fs.copyFileSync(memoryFile, agentInstructionsPath());
  }
  return { ok: true };
}
