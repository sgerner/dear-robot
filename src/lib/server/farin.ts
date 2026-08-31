import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { env } from './env';
import { db, nowIso } from './db';
import { farinSettings } from './db/schema';
import { decryptSecret, encryptSecret } from './security';
import { recordAgentAudit } from './agent/runtime';

const FarinSettingsSchema = z.object({
  host: z.string().url().max(500).optional(),
  companyId: z.string().trim().max(160).nullable().optional(),
  apiKey: z.string().trim().max(500).nullable().optional(),
  automationSecret: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional()
});

const FarinUploadSchema = z.object({
  filePath: z.string().min(1).max(2000),
  filename: z.string().trim().max(180).optional(),
  companyId: z.string().trim().max(160).optional(),
  sourceType: z.string().trim().max(120).optional(),
  force: z.boolean().default(false),
  taskRunId: z.number().int().positive().optional(),
  taskStepId: z.number().int().positive().optional()
});

function safeHost(value: string) {
  const url = new URL(value);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Farin host must use HTTPS (HTTP is allowed only for localhost development).');
  }
  return url.origin;
}

function browserDownloadsRoot() {
  return path.resolve(env.DATA_DIR, 'browser', 'downloads');
}

function safeDownloadPath(value: string) {
  const root = browserDownloadsRoot();
  const candidate = path.resolve(value);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Farin uploads may only use files downloaded by the isolated browser.');
  }
  return candidate;
}

function mimeForFilename(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  return (
    {
      '.csv': 'text/csv',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.qbo': 'application/x-qbo',
      '.ofx': 'application/ofx'
    }[extension] || 'application/octet-stream'
  );
}

export function getFarinSettings() {
  const row = db.select().from(farinSettings).where(eq(farinSettings.id, 1)).get();
  const host = row?.host || env.FARIN_API_HOST;
  return {
    id: 1,
    host,
    companyId: row?.companyId || env.FARIN_COMPANY_ID || null,
    enabled: row?.enabled ?? Boolean(row?.apiKeyEncrypted || env.FARIN_API_KEY || env.FARIN_AUTOMATION_SECRET),
    hasApiKey: Boolean(decryptSecret(row?.apiKeyEncrypted) || env.FARIN_API_KEY),
    hasAutomationSecret: Boolean(
      decryptSecret(row?.automationSecretEncrypted) || env.FARIN_AUTOMATION_SECRET
    ),
    updatedAt: row?.updatedAt || null
  };
}

export function saveFarinSettings(input: unknown) {
  const parsed = FarinSettingsSchema.parse(input);
  const existing = db.select().from(farinSettings).where(eq(farinSettings.id, 1)).get();
  const host = safeHost(parsed.host || existing?.host || env.FARIN_API_HOST);
  const now = nowIso();
  const apiKeyEncrypted =
    parsed.apiKey === undefined
      ? existing?.apiKeyEncrypted || null
      : parsed.apiKey
        ? encryptSecret(parsed.apiKey)
        : null;
  const automationSecretEncrypted =
    parsed.automationSecret === undefined
      ? existing?.automationSecretEncrypted || null
      : parsed.automationSecret
        ? encryptSecret(parsed.automationSecret)
        : null;
  const row = existing
    ? db
        .update(farinSettings)
        .set({
          host,
          companyId:
            parsed.companyId === undefined ? existing.companyId : parsed.companyId || null,
          apiKeyEncrypted,
          automationSecretEncrypted,
          enabled:
            parsed.enabled ?? Boolean(apiKeyEncrypted || automationSecretEncrypted || env.FARIN_API_KEY || env.FARIN_AUTOMATION_SECRET),
          updatedAt: now
        })
        .where(eq(farinSettings.id, 1))
        .returning()
        .get()
    : db
        .insert(farinSettings)
        .values({
          id: 1,
          host,
          companyId: parsed.companyId || env.FARIN_COMPANY_ID || null,
          apiKeyEncrypted,
          automationSecretEncrypted,
          enabled:
            parsed.enabled ?? Boolean(apiKeyEncrypted || automationSecretEncrypted || env.FARIN_API_KEY || env.FARIN_AUTOMATION_SECRET),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();
  recordAgentAudit({ actor: 'user', eventType: 'farin_settings_updated', payload: { host, companyId: row.companyId, enabled: row.enabled, hasApiKey: Boolean(apiKeyEncrypted), hasAutomationSecret: Boolean(automationSecretEncrypted) } });
  return getFarinSettings();
}

export async function uploadFarinFile(input: unknown) {
  const parsed = FarinUploadSchema.parse(input);
  const sourcePath = safeDownloadPath(parsed.filePath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) throw new Error('Downloaded report file was not found.');
  if (stat.size === 0) throw new Error('Downloaded report file is empty.');
  if (stat.size > env.BROWSER_MAX_DOWNLOAD_BYTES) throw new Error('Downloaded report exceeds the configured upload limit.');
  const filename = path.basename(parsed.filename || sourcePath);
  const extension = path.extname(filename).toLowerCase();
  if (!['.csv', '.xlsx', '.xls', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.qbo', '.ofx'].includes(extension)) {
    throw new Error('Farin accepts CSV, XLS/XLSX, PDF, image, QBO, and OFX report files.');
  }
  const settings = db.select().from(farinSettings).where(eq(farinSettings.id, 1)).get();
  const host = safeHost(settings?.host || env.FARIN_API_HOST);
  const companyId = parsed.companyId || settings?.companyId || env.FARIN_COMPANY_ID || null;
  const apiKey = decryptSecret(settings?.apiKeyEncrypted) || env.FARIN_API_KEY || '';
  const automationSecret =
    decryptSecret(settings?.automationSecretEncrypted) || env.FARIN_AUTOMATION_SECRET || '';
  if (!companyId) throw new Error('Configure a Farin company id before uploading reports.');
  if (!apiKey && !automationSecret) throw new Error('Configure a Farin API key or accounting automation secret before uploading reports.');

  const buffer = await fs.readFile(sourcePath);
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeForFilename(filename) });
  const headers = new Headers();
  let endpoint = `${host}/api/v1/accounting/automation/upload`;
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
    headers.set('x-company-id', companyId);
    form.append('file', blob, filename);
    form.set('force', parsed.force ? 'true' : 'false');
  } else {
    endpoint = `${host}/api/v1/accounting/automation/ingest`;
    headers.set('x-accounting-automation-secret', automationSecret);
    headers.set('x-company-id', companyId);
    headers.set('x-idempotency-key', `dear-robot:${sourcePath}:${stat.size}:${stat.mtimeMs}`);
    form.append('company_id', companyId);
    form.append('metadata', JSON.stringify({ source_type: parsed.sourceType || 'browser_report', filename }));
    form.append('files', blob, filename);
  }
  const response = await fetch(endpoint, { method: 'POST', headers, body: form });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep the text body for useful diagnostics.
  }
  if (response.status === 409 && body && typeof body === 'object') {
    const duplicate = { duplicate: true, status: response.status, ...(body as Record<string, unknown>) };
    recordAgentAudit({ taskRunId: parsed.taskRunId, taskStepId: parsed.taskStepId, actor: 'agent', eventType: 'farin_upload_duplicate', payload: { filename, companyId } });
    return duplicate;
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 800) : JSON.stringify(body);
    throw new Error(`Farin upload failed (${response.status}): ${detail}`);
  }
  recordAgentAudit({ taskRunId: parsed.taskRunId, taskStepId: parsed.taskStepId, actor: 'agent', eventType: 'farin_upload_completed', payload: { filename, companyId, bytes: stat.size } });
  return { uploaded: true, filename, bytes: stat.size, companyId, response: body };
}
