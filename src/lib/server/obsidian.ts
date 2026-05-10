import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from './db';
import { bootstrapDatabase } from './db/bootstrap';
import { obsidianSettings } from './db/schema';

bootstrapDatabase();

export const DEFAULT_OBSIDIAN_VAULT_PATH = '/obsidian';
export const OBSIDIAN_TOOL_NAME = 'obsidian_vault';

export const ObsidianSettingsSchema = z.object({
  isEnabled: z.boolean().default(false),
  vaultPath: z.string().min(1).max(500)
});

export const ObsidianToolCallSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    path: z.string().max(500).nullable().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100)
  }),
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(200),
    path: z.string().max(500).nullable().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  }),
  z.object({
    action: z.literal('read'),
    path: z.string().min(1).max(500)
  }),
  z.object({
    action: z.literal('write'),
    path: z.string().min(1).max(500),
    content: z.string().max(200000)
  }),
  z.object({
    action: z.literal('append'),
    path: z.string().min(1).max(500),
    content: z.string().max(200000)
  })
]);

export type ObsidianSettingsInput = z.infer<typeof ObsidianSettingsSchema>;
export type ObsidianToolCall = z.infer<typeof ObsidianToolCallSchema>;

const OBSIDIAN_TOOL_SKILLS_MARKDOWN = `# Obsidian vault playbook

- Search the vault before asking for repeat context or writing a new note.
- Keep notes concise, factual, and dated.
- Use append for rolling logs or daily notes.
- Use overwrite for curated summaries, decisions, and handoff notes.
- Prefer relative paths under the vault root.
`;

export function getObsidianSettings() {
  const row = db.select().from(obsidianSettings).where(eq(obsidianSettings.id, 1)).get();
  const vaultPath = row?.vaultPath || DEFAULT_OBSIDIAN_VAULT_PATH;
  const status = inspectVault(vaultPath);
  return {
    id: row?.id ?? 1,
    isEnabled: row?.isEnabled ?? false,
    vaultPath,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    isMounted: status.isMounted,
    isReadable: status.isReadable,
    isWritable: status.isWritable,
    resolvedVaultPath: status.resolvedVaultPath,
    statusLabel: status.statusLabel,
    statusMessage: status.statusMessage
  };
}

export function upsertObsidianSettings(input: ObsidianSettingsInput) {
  const parsed = ObsidianSettingsSchema.parse(input);
  assertAbsoluteVaultPath(parsed.vaultPath);
  const now = nowIso();
  const existing = db.select().from(obsidianSettings).where(eq(obsidianSettings.id, 1)).get();
  const saved = db
    .insert(obsidianSettings)
    .values({
      id: 1,
      isEnabled: parsed.isEnabled,
      vaultPath: parsed.vaultPath,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: obsidianSettings.id,
      set: {
        isEnabled: parsed.isEnabled,
        vaultPath: parsed.vaultPath,
        updatedAt: now
      }
    })
    .returning()
    .get();
  return {
    id: saved.id,
    isEnabled: saved.isEnabled,
    vaultPath: saved.vaultPath,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    ...inspectVault(saved.vaultPath)
  };
}

export function getObsidianToolDefinition() {
  const settings = getObsidianSettings();
  if (!settings.isEnabled || !settings.isMounted || !settings.isReadable) return null;
  return {
    id: undefined,
    name: OBSIDIAN_TOOL_NAME,
    description: 'Search, read, and write notes in the mounted Obsidian vault.',
    kind: 'obsidian' as const,
    endpoint: null,
    command: null,
    args: [],
    skillsMarkdown: OBSIDIAN_TOOL_SKILLS_MARKDOWN,
    isEnabled: true,
    readOnly: !settings.isWritable,
    requireApprovalForWrite: true,
    timeoutMs: 30000,
    hasAuthHeaders: false,
    hasEnv: false,
    createdAt: settings.createdAt || nowIso(),
    updatedAt: settings.updatedAt || nowIso(),
    vaultPath: settings.resolvedVaultPath,
    isBuiltin: true
  };
}

export async function executeObsidianTool(input: unknown) {
  const settings = getObsidianSettings();
  if (!settings.isEnabled) throw new Error('Obsidian vault integration is disabled');
  if (!settings.isMounted) throw new Error(`Obsidian vault path is not mounted: ${settings.vaultPath}`);
  if (!settings.isReadable) throw new Error(`Obsidian vault path is not readable: ${settings.vaultPath}`);
  const call = ObsidianToolCallSchema.parse(input);
  const root = settings.resolvedVaultPath;
  const rootRealPath = fs.realpathSync(root);

  switch (call.action) {
    case 'list': {
      const relativeRoot = normalizeRelativePath(call.path || '');
      const files = listVaultFiles(root, rootRealPath, relativeRoot)
        .slice(0, call.limit)
        .map((file) => ({
          path: file.relativePath,
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt
        }));
      return { root: settings.vaultPath, files };
    }
    case 'search': {
      const relativeRoot = normalizeRelativePath(call.path || '');
      const matches = searchVault(root, rootRealPath, call.query, relativeRoot, call.limit);
      return { root: settings.vaultPath, query: call.query, matches };
    }
    case 'read': {
      const filePath = resolveVaultPath(root, call.path);
      if (!fs.existsSync(filePath)) throw new Error(`Note not found: ${call.path}`);
      assertExistingPathInsideVault(rootRealPath, filePath);
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) throw new Error(`Not a file: ${call.path}`);
      return {
        root: settings.vaultPath,
        path: toVaultRelativePath(root, filePath),
        content: fs.readFileSync(filePath, 'utf8'),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      };
    }
    case 'write': {
      ensureWritable(settings);
      const filePath = resolveVaultPath(root, call.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      assertWritableTargetInsideVault(rootRealPath, filePath);
      fs.writeFileSync(filePath, call.content, 'utf8');
      return {
        root: settings.vaultPath,
        path: toVaultRelativePath(root, filePath),
        bytesWritten: Buffer.byteLength(call.content, 'utf8'),
        mode: 'overwrite'
      };
    }
    case 'append': {
      ensureWritable(settings);
      const filePath = resolveVaultPath(root, call.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      assertWritableTargetInsideVault(rootRealPath, filePath);
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      const next = existing ? `${existing.replace(/\s*$/, '')}\n\n${call.content}` : call.content;
      fs.writeFileSync(filePath, next, 'utf8');
      return {
        root: settings.vaultPath,
        path: toVaultRelativePath(root, filePath),
        bytesWritten: Buffer.byteLength(call.content, 'utf8'),
        mode: 'append'
      };
    }
  }
}

function ensureWritable(settings: ReturnType<typeof getObsidianSettings>) {
  if (!settings.isWritable) {
    throw new Error(`Obsidian vault is not writable: ${settings.vaultPath}`);
  }
}

function inspectVault(vaultPath: string) {
  const resolvedVaultPath = path.resolve(vaultPath);
  const exists = fs.existsSync(resolvedVaultPath);
  let isMounted = false;
  let isReadable = false;
  let isWritable = false;
  let statusMessage = 'Vault path is missing';
  if (exists) {
    try {
      const stats = fs.statSync(resolvedVaultPath);
      isMounted = stats.isDirectory();
      if (isMounted) {
        fs.accessSync(resolvedVaultPath, fs.constants.R_OK | fs.constants.X_OK);
        isReadable = true;
        try {
          fs.accessSync(resolvedVaultPath, fs.constants.W_OK | fs.constants.X_OK);
          isWritable = true;
        } catch {
          isWritable = false;
        }
        statusMessage = isWritable
          ? 'Vault is mounted and writable'
          : 'Vault is mounted but read-only';
      } else {
        statusMessage = 'Vault path exists but is not a directory';
      }
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    resolvedVaultPath,
    isMounted,
    isReadable,
    isWritable,
    statusLabel: isMounted ? (isWritable ? 'mounted' : 'read-only') : 'missing',
    statusMessage
  };
}

function listVaultFiles(root: string, rootRealPath: string, relativeRoot = '') {
  const startDir = resolveVaultPath(root, relativeRoot);
  const files: Array<{
    absolutePath: string;
    relativePath: string;
    sizeBytes: number;
    modifiedAt: string;
  }> = [];
  if (!fs.existsSync(startDir)) return files;
  assertExistingPathInsideVault(rootRealPath, startDir);
  const queue = [startDir];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        assertExistingPathInsideVault(rootRealPath, absolutePath);
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isMarkdownFile(entry.name)) continue;
      assertExistingPathInsideVault(rootRealPath, absolutePath);
      const stats = fs.statSync(absolutePath);
      files.push({
        absolutePath,
        relativePath: toVaultRelativePath(root, absolutePath),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function searchVault(
  root: string,
  rootRealPath: string,
  query: string,
  relativeRoot: string,
  limit: number
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const files = listVaultFiles(root, rootRealPath, relativeRoot);
  const matches: Array<{
    path: string;
    excerpt: string;
    modifiedAt: string;
  }> = [];
  for (const file of files) {
    if (matches.length >= limit) break;
    try {
      const content = fs.readFileSync(file.absolutePath, 'utf8');
      const haystack = `${file.relativePath}\n${content}`.toLowerCase();
      const matchIndex = haystack.indexOf(needle);
      if (matchIndex < 0) continue;
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const contentIndex = normalizedContent.toLowerCase().indexOf(needle);
      const excerpt = buildExcerpt(normalizedContent, contentIndex >= 0 ? contentIndex : 0);
      matches.push({
        path: file.relativePath,
        excerpt,
        modifiedAt: file.modifiedAt
      });
    } catch {
      // Skip unreadable files and continue searching the vault.
    }
  }
  return matches;
}

function buildExcerpt(content: string, index: number) {
  if (index < 0) {
    return content.slice(0, 240).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + 240);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function resolveVaultPath(root: string, relativePath: string) {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, relativePath || '.');
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Vault path escapes the configured root');
  }
  return resolved;
}

function assertExistingPathInsideVault(rootRealPath: string, absolutePath: string) {
  const realPath = fs.realpathSync(absolutePath);
  if (realPath !== rootRealPath && !realPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Vault path resolves outside the configured root');
  }
  return realPath;
}

function assertWritableTargetInsideVault(rootRealPath: string, absolutePath: string) {
  const parentRealPath = assertExistingPathInsideVault(rootRealPath, path.dirname(absolutePath));
  if (parentRealPath !== rootRealPath && !parentRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error('Vault write target resolves outside the configured root');
  }
  if (fs.existsSync(absolutePath)) {
    assertExistingPathInsideVault(rootRealPath, absolutePath);
  }
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  return normalized;
}

function toVaultRelativePath(root: string, absolutePath: string) {
  return path.relative(path.resolve(root), absolutePath).split(path.sep).join('/');
}

function isMarkdownFile(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function assertAbsoluteVaultPath(vaultPath: string) {
  if (!path.isAbsolute(vaultPath)) {
    throw new Error(`Obsidian vault path must be absolute. Received: ${vaultPath}`);
  }
}
