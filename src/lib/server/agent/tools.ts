import { spawn } from 'node:child_process';
import { and, eq } from 'drizzle-orm';
import { db, nowIso } from '../db';
import { agentTools, toolCalls } from '../db/schema';
import { decryptSecret, encryptSecret } from '../security';
import { ToolCreateSchema, ToolUpdateSchema } from './schema';

export function listAgentTools() {
  return db
    .select()
    .from(agentTools)
    .all()
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      kind: tool.kind,
      endpoint: tool.endpoint,
      command: tool.command,
      args: safeParseStringArray(tool.argsJson),
      isEnabled: tool.isEnabled,
      readOnly: tool.readOnly,
      requireApprovalForWrite: tool.requireApprovalForWrite,
      timeoutMs: tool.timeoutMs,
      hasAuthHeaders: Boolean(tool.authHeadersEncrypted),
      hasEnv: Boolean(tool.envEncrypted),
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt
    }));
}

export function getAgentTool(id: number) {
  return db.select().from(agentTools).where(eq(agentTools.id, id)).get();
}

export function getAgentToolByName(name: string) {
  return db
    .select()
    .from(agentTools)
    .where(and(eq(agentTools.name, name), eq(agentTools.isEnabled, true)))
    .get();
}

export function createAgentTool(input: unknown) {
  const parsed = ToolCreateSchema.parse(input);
  const now = nowIso();
  const created = db
    .insert(agentTools)
    .values({
      name: parsed.name,
      description: parsed.description || null,
      kind: parsed.kind,
      endpoint: parsed.endpoint || null,
      command: parsed.command || null,
      argsJson: JSON.stringify(parsed.args),
      authHeadersEncrypted: Object.keys(parsed.authHeaders).length
        ? encryptSecret(JSON.stringify(parsed.authHeaders))
        : null,
      envEncrypted: Object.keys(parsed.env).length ? encryptSecret(JSON.stringify(parsed.env)) : null,
      isEnabled: parsed.isEnabled,
      readOnly: parsed.readOnly,
      requireApprovalForWrite: parsed.requireApprovalForWrite,
      timeoutMs: parsed.timeoutMs,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return sanitizeTool(created);
}

export function updateAgentTool(id: number, input: unknown) {
  const parsed = ToolUpdateSchema.parse(input);
  const existing = getAgentTool(id);
  if (!existing) return null;
  const nextHeaders =
    parsed.authHeaders !== undefined
      ? Object.keys(parsed.authHeaders).length
        ? encryptSecret(JSON.stringify(parsed.authHeaders))
        : null
      : existing.authHeadersEncrypted;
  const nextEnv =
    parsed.env !== undefined
      ? Object.keys(parsed.env).length
        ? encryptSecret(JSON.stringify(parsed.env))
        : null
      : existing.envEncrypted;
  const updated = db
    .update(agentTools)
    .set({
      name: parsed.name ?? existing.name,
      description: parsed.description !== undefined ? parsed.description || null : existing.description,
      kind: parsed.kind ?? existing.kind,
      endpoint: parsed.endpoint !== undefined ? parsed.endpoint || null : existing.endpoint,
      command: parsed.command !== undefined ? parsed.command || null : existing.command,
      argsJson: parsed.args ? JSON.stringify(parsed.args) : existing.argsJson,
      authHeadersEncrypted: nextHeaders,
      envEncrypted: nextEnv,
      isEnabled: parsed.isEnabled ?? existing.isEnabled,
      readOnly: parsed.readOnly ?? existing.readOnly,
      requireApprovalForWrite: parsed.requireApprovalForWrite ?? existing.requireApprovalForWrite,
      timeoutMs: parsed.timeoutMs ?? existing.timeoutMs,
      updatedAt: nowIso()
    })
    .where(eq(agentTools.id, id))
    .returning()
    .get();
  return sanitizeTool(updated);
}

export function deleteAgentTool(id: number) {
  const result = db.delete(agentTools).where(eq(agentTools.id, id)).run();
  return result.changes > 0;
}

export async function testAgentTool(id: number) {
  const tool = getAgentTool(id);
  if (!tool) throw new Error('Tool not found');
  return executeTool(tool, { ping: true }, { dryRun: true });
}

export async function executeTool(
  tool:
    | typeof agentTools.$inferSelect
    | {
        id?: number;
        name: string;
        kind: 'mcp_http' | 'cli';
        endpoint: string | null;
        command: string | null;
        argsJson: string | null;
        authHeadersEncrypted?: string | null;
        envEncrypted?: string | null;
        timeoutMs: number;
      },
  input: Record<string, unknown>,
  options: { taskRunId?: number; taskStepId?: number; dryRun?: boolean } = {}
) {
  const started = Date.now();
  let status: 'completed' | 'failed' = 'completed';
  let responseJson = '';
  try {
    const output = tool.kind === 'mcp_http' ? await runHttpTool(tool, input) : await runCliTool(tool, input);
    responseJson = JSON.stringify(output);
    return { ok: true, output, durationMs: Date.now() - started };
  } catch (error) {
    status = 'failed';
    const payload = { error: error instanceof Error ? error.message : String(error) };
    responseJson = JSON.stringify(payload);
    return { ok: false, output: payload, durationMs: Date.now() - started };
  } finally {
    if (!options.dryRun) {
      db.insert(toolCalls)
        .values({
          taskRunId: options.taskRunId ?? null,
          taskStepId: options.taskStepId ?? null,
          toolId: tool.id ?? null,
          toolName: tool.name,
          requestJson: JSON.stringify(input),
          responseJson,
          status,
          durationMs: Date.now() - started,
          createdAt: nowIso()
        })
        .run();
    }
  }
}

function sanitizeTool(tool: typeof agentTools.$inferSelect) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    kind: tool.kind,
    endpoint: tool.endpoint,
    command: tool.command,
    args: safeParseStringArray(tool.argsJson),
    isEnabled: tool.isEnabled,
    readOnly: tool.readOnly,
    requireApprovalForWrite: tool.requireApprovalForWrite,
    timeoutMs: tool.timeoutMs,
    hasAuthHeaders: Boolean(tool.authHeadersEncrypted),
    hasEnv: Boolean(tool.envEncrypted),
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt
  };
}

function safeParseStringArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function runHttpTool(
  tool: {
    endpoint: string | null;
    authHeadersEncrypted?: string | null;
    timeoutMs: number;
  },
  input: Record<string, unknown>
) {
  if (!tool.endpoint) throw new Error('Tool endpoint is missing');
  const headers = decryptJsonRecord(tool.authHeadersEncrypted);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tool.timeoutMs || 30000);
  try {
    const response = await fetch(tool.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(input)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function runCliTool(
  tool: {
    command: string | null;
    argsJson: string | null;
    envEncrypted?: string | null;
    timeoutMs: number;
  },
  input: Record<string, unknown>
) {
  if (!tool.command) throw new Error('Tool command is missing');
  const args = safeParseStringArray(tool.argsJson);
  const env = {
    ...process.env,
    ...decryptJsonRecord(tool.envEncrypted)
  };
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(tool.command as string, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI tool timeout after ${tool.timeoutMs}ms`));
    }, tool.timeoutMs || 30000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 50_000) stderr = stderr.slice(-50_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CLI exit ${code}: ${stderr.slice(0, 240)}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolve({ ok: true });
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ raw: text });
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

function decryptJsonRecord(value: string | null | undefined) {
  if (!value) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(decryptSecret(value));
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
