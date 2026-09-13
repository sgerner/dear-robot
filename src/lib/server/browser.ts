import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { waitForInboxVerification } from './browser-verification';
import { env } from './env';
import { db, nowIso } from './db';
import {
  decryptSecret,
  encryptSecret,
  issueBrowserBridgeCapability,
  verifyBrowserBridgeCapability
} from './security';
import {
  browserProfiles,
  browserRecipes,
  browserRuns,
  messages,
  type BrowserRecipe,
  type BrowserRun
} from './db/schema';
import { recordAgentAudit, parseJson } from './agent/runtime';

/** Browser recipes deliberately contain no arbitrary JavaScript. */
export const BrowserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), url: z.string().url() }).strict(),
  z
    .object({
      type: z.literal('check'),
      selector: z.string().min(1).max(500),
      checked: z.boolean(),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('click'),
      selector: z.string().min(1).max(500),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('fill'),
      selector: z.string().min(1).max(500),
      value: z.string().max(4000).nullable().optional(),
      secret: z.boolean().optional(),
      secretRef: z.enum(['username', 'password', 'email_code']).optional(),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('press'),
      selector: z.string().min(1).max(500),
      key: z.string().min(1).max(80),
      optional: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('select'),
      selector: z.string().min(1).max(500),
      value: z.string().max(1000),
      optional: z.boolean().optional()
    })
    .strict(),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(50).max(30000) }).strict(),
  z
    .object({
      type: z.literal('download'),
      timeoutMs: z.number().int().min(500).max(30000).optional()
    })
    .strict()
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

const BrowserProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startUrl: z.string().url().max(2000),
  allowedHosts: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  username: z.string().trim().max(500).optional(),
  password: z.string().max(4000).optional(),
  enabled: z.boolean().default(true)
});

const BrowserRecipeInputSchema = z.object({
  profileId: z.coerce.number().int().positive(),
  sourceMessageId: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1200).nullable().optional(),
  startUrl: z.string().url().max(2000),
  actions: z.array(BrowserActionSchema).max(100).default([]),
  enabled: z.boolean().default(true)
});

type ActiveSession = {
  runId: number;
  profileId: number;
  recipeId: number | null;
  recording: boolean;
  context: import('playwright').BrowserContext;
  pages: Set<import('playwright').Page>;
  downloadDir: string;
  recordingActions: BrowserAction[];
  recordingLimitReached?: boolean;
  downloadError?: string;
  downloadTasks: Set<Promise<void>>;
  closed: boolean;
};

const activeSessions = new Map<number, ActiveSession>();
/**
 * Persistent Chromium profiles cannot be safely shared by two contexts. Keep
 * a reservation before launching so two HTTP requests cannot race into the
 * same profile while the first browser is still starting.
 */
const profileRunLocks = new Map<number, number>();
let playwrightPromise: Promise<typeof import('playwright')> | null = null;

async function playwright() {
  playwrightPromise ||= import('playwright');
  return playwrightPromise;
}

function browserRoot() {
  return path.join(env.DATA_DIR, 'browser');
}

function profileDir(profileId: number) {
  return path.join(browserRoot(), 'profiles', String(profileId));
}

function runDownloadDir(runId: number) {
  return path.join(browserRoot(), 'downloads', String(runId));
}

function reserveProfileRun(profileId: number, runId: number) {
  const existing = profileRunLocks.get(profileId);
  if (existing !== undefined && existing !== runId) {
    throw new Error(
      `Browser profile is already in use by run ${existing}. Wait for it to finish or cancel it first.`
    );
  }
  profileRunLocks.set(profileId, runId);
}

function releaseProfileRun(profileId: number, runId: number) {
  if (profileRunLocks.get(profileId) === runId) profileRunLocks.delete(profileId);
}

function ensureRunActive(runId: number) {
  const run = getBrowserRun(runId);
  if (!run) throw new Error('Browser run not found');
  if (run.status === 'cancelled') throw new Error('Browser run cancelled');
  return run;
}

function safeFilename(value: string) {
  const normalized = path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized.slice(0, 180) || `download-${Date.now()}`;
}

function safeUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Browser automation only supports credential-free HTTP(S) URLs.');
  }
  return url;
}

function safeLogUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

function safeBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/gi, (value) => safeLogUrl(value))
    .replace(
      /\b(code|token|state|nonce|auth|assertion|session|ticket|redirect_uri)=([^\s&]+)/gi,
      (_match, key: string) => `${key}=[redacted]`
    );
}

function normalizeHost(value: string) {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0];
  const host = raw.split(':')[0];
  if (!host || host.includes('..') || /[^a-z0-9.-]/.test(host))
    throw new Error(`Invalid allowed host: ${value}`);
  return host;
}

function hostAllowed(url: URL, allowedHosts: string[]) {
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`)
  );
}

function assertAllowedUrl(value: string, allowedHosts: string[]) {
  const url = safeUrl(value);
  if (!hostAllowed(url, allowedHosts))
    throw new Error(
      `Browser navigation blocked for host ${url.hostname}. Add it to the profile allowlist.`
    );
  return url;
}

function parseHosts(value: string | null | undefined) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function profileSecrets(row: typeof browserProfiles.$inferSelect) {
  return {
    username: row.usernameEncrypted ? decryptSecret(row.usernameEncrypted) : '',
    password: row.passwordEncrypted ? decryptSecret(row.passwordEncrypted) : ''
  };
}

function toProfile(row: typeof browserProfiles.$inferSelect) {
  const {
    usernameEncrypted: _usernameEncrypted,
    passwordEncrypted: _passwordEncrypted,
    ...safeRow
  } = row;
  return {
    ...safeRow,
    allowedHosts: parseHosts(row.allowedHostsJson),
    hasUsername: Boolean(row.usernameEncrypted),
    hasPassword: Boolean(row.passwordEncrypted)
  };
}

function toRecipe(row: BrowserRecipe) {
  const actions = parseJson(row.actionsJson, []);
  return { ...row, actions: Array.isArray(actions) ? actions : [] };
}

function toRun(row: BrowserRun) {
  const logs = parseJson(row.logsJson, []);
  return { ...row, logs: Array.isArray(logs) ? logs : [] };
}

function appendRunLog(runId: number, entry: Record<string, unknown>) {
  const run = db.select().from(browserRuns).where(eq(browserRuns.id, runId)).get();
  if (!run) return null;
  const logs = parseJson(run.logsJson, []);
  const next = [...(Array.isArray(logs) ? logs : []), { at: nowIso(), ...entry }].slice(-200);
  db.update(browserRuns)
    .set({ logsJson: JSON.stringify(next) })
    .where(eq(browserRuns.id, runId))
    .run();
  return next;
}

export function listBrowserProfiles() {
  return db
    .select()
    .from(browserProfiles)
    .orderBy(desc(browserProfiles.updatedAt))
    .all()
    .map(toProfile);
}

export function getBrowserProfile(id: number) {
  const row = db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
  return row ? toProfile(row) : null;
}

export function createBrowserProfile(input: unknown) {
  const parsed = BrowserProfileInputSchema.parse(input);
  const start = safeUrl(parsed.startUrl);
  const hosts = [
    ...new Set([start.hostname.toLowerCase(), ...parsed.allowedHosts.map(normalizeHost)])
  ];
  const now = nowIso();
  const row = db
    .insert(browserProfiles)
    .values({
      name: parsed.name,
      startUrl: start.toString(),
      allowedHostsJson: JSON.stringify(hosts),
      usernameEncrypted: parsed.username ? encryptSecret(parsed.username) : null,
      passwordEncrypted: parsed.password ? encryptSecret(parsed.password) : null,
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_profile_created',
    payload: { profileId: row.id, name: row.name, allowedHosts: hosts }
  });
  return toProfile(row);
}

export function updateBrowserProfile(id: number, input: unknown) {
  const existing = db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
  if (!existing) return null;
  const parsed = BrowserProfileInputSchema.partial().parse(input);
  const start = parsed.startUrl ? safeUrl(parsed.startUrl) : safeUrl(existing.startUrl);
  const suppliedHosts = parsed.allowedHosts ?? parseHosts(existing.allowedHostsJson);
  const hosts = [...new Set([start.hostname.toLowerCase(), ...suppliedHosts.map(normalizeHost)])];
  const credentialUpdates = {
    ...(parsed.username !== undefined
      ? { usernameEncrypted: parsed.username ? encryptSecret(parsed.username) : null }
      : {}),
    ...(parsed.password !== undefined
      ? { passwordEncrypted: parsed.password ? encryptSecret(parsed.password) : null }
      : {})
  };
  const row = db
    .update(browserProfiles)
    .set({
      name: parsed.name ?? existing.name,
      startUrl: start.toString(),
      allowedHostsJson: JSON.stringify(hosts),
      ...credentialUpdates,
      enabled: parsed.enabled ?? existing.enabled,
      updatedAt: nowIso()
    })
    .where(eq(browserProfiles.id, id))
    .returning()
    .get();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_profile_updated',
    payload: {
      profileId: id,
      changedCredentials: Object.keys(credentialUpdates).map((key) => key.replace('Encrypted', '')),
      allowedHosts: hosts,
      enabled: row.enabled
    }
  });
  return toProfile(row);
}

function getBrowserProfileRow(id: number) {
  return db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
}

function getBrowserProfileSecrets(id: number) {
  const row = getBrowserProfileRow(id);
  if (!row) return null;
  return profileSecrets(row);
}

export async function deleteBrowserProfile(id: number) {
  await closeSessionsForProfile(id);
  const result = db.delete(browserProfiles).where(eq(browserProfiles.id, id)).run();
  return result.changes > 0;
}

export function listBrowserRecipes(profileId?: number) {
  return db
    .select()
    .from(browserRecipes)
    .where(profileId ? eq(browserRecipes.profileId, profileId) : undefined)
    .orderBy(desc(browserRecipes.updatedAt))
    .all()
    .map(toRecipe);
}

export function getBrowserRecipe(id: number) {
  const row = db.select().from(browserRecipes).where(eq(browserRecipes.id, id)).get();
  return row ? toRecipe(row) : null;
}

export function createBrowserRecipe(input: unknown) {
  const parsed = BrowserRecipeInputSchema.parse(input);
  const profile = getBrowserProfile(parsed.profileId);
  if (!profile) throw new Error('Browser profile not found');
  const start = assertAllowedUrl(parsed.startUrl, profile.allowedHosts);
  const actions = normalizeActions(parsed.actions, profile.allowedHosts);
  const now = nowIso();
  const row = db
    .insert(browserRecipes)
    .values({
      profileId: parsed.profileId,
      sourceMessageId: parsed.sourceMessageId ?? null,
      name: parsed.name,
      description: parsed.description || null,
      startUrl: start.toString(),
      actionsJson: JSON.stringify(actions),
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_recipe_created',
    payload: { recipeId: row.id, profileId: row.profileId, actionCount: actions.length }
  });
  return toRecipe(row);
}

export function updateBrowserRecipe(id: number, input: unknown) {
  const existing = db.select().from(browserRecipes).where(eq(browserRecipes.id, id)).get();
  if (!existing) return null;
  const parsed = BrowserRecipeInputSchema.partial().parse(input);
  const profile = getBrowserProfile(parsed.profileId ?? existing.profileId);
  if (!profile) throw new Error('Browser profile not found');
  const start = assertAllowedUrl(parsed.startUrl ?? existing.startUrl, profile.allowedHosts);
  const actions = parsed.actions
    ? normalizeActions(parsed.actions, profile.allowedHosts)
    : parseJson(existing.actionsJson, []);
  const row = db
    .update(browserRecipes)
    .set({
      profileId: profile.id,
      ...(parsed.sourceMessageId !== undefined
        ? { sourceMessageId: parsed.sourceMessageId ?? null }
        : {}),
      name: parsed.name ?? existing.name,
      description:
        parsed.description === undefined ? existing.description : parsed.description || null,
      startUrl: start.toString(),
      actionsJson: JSON.stringify(actions),
      enabled: parsed.enabled ?? existing.enabled,
      updatedAt: nowIso()
    })
    .where(eq(browserRecipes.id, id))
    .returning()
    .get();
  return toRecipe(row);
}

export async function deleteBrowserRecipe(id: number) {
  await closeSessionsForRecipe(id);
  const result = db.delete(browserRecipes).where(eq(browserRecipes.id, id)).run();
  return result.changes > 0;
}

/** Return the user-facing automation created from a particular report email. */
export function getBrowserRecipeForMessage(messageId: number) {
  const row = db
    .select()
    .from(browserRecipes)
    .where(eq(browserRecipes.sourceMessageId, messageId))
    .orderBy(desc(browserRecipes.updatedAt))
    .get();
  return row ? toRecipe(row) : null;
}

/**
 * Extract candidate dashboard links without following them. The user still
 * chooses the link in the guided setup, which keeps email content from
 * silently initiating a browser session.
 */
export function extractBrowserLinks(
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined
) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const decoded = raw
      .replace(/&amp;/gi, '&')
      .replace(/&#x2F;|&#47;/gi, '/')
      .trim()
      .replace(/[),.;!?]+$/g, '');
    try {
      const url = safeUrl(decoded).toString();
      if (!seen.has(url)) {
        seen.add(url);
        candidates.push(url);
      }
    } catch {
      // Ignore mailto links, malformed URLs, and credential-bearing URLs.
    }
  };
  for (const match of String(bodyHtml || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi))
    add(match[1]);
  for (const match of String(bodyText || '').matchAll(/https?:\/\/[^\s<>"']+/gi)) add(match[0]);
  return candidates.slice(0, 20);
}

export function getBrowserAutomationForMessage(messageId: number) {
  const recipe = getBrowserRecipeForMessage(messageId);
  if (!recipe) return null;
  return {
    recipe,
    profile: getBrowserProfile(recipe.profileId),
    latestRun: listBrowserRuns(recipe.id, 1)[0] || null
  };
}

function reportLabel(message: { subject: string; from: string }) {
  const subject = message.subject.trim().replace(/^(re|fw|fwd):\s*/i, '');
  const sender = message.from.match(/<([^>]+)>/)?.[1] || message.from.split(/\s+/)[0] || 'provider';
  return `${subject || 'Report'} · ${sender}`.slice(0, 120);
}

function prepareEmailBrowserAutomation(
  messageId: number,
  input: {
    startUrl?: string;
    name?: string;
    username?: string;
    password?: string;
  }
) {
  const message = db
    .select({
      id: messages.id,
      subject: messages.subject,
      from: messages.from,
      bodyText: messages.bodyText,
      bodyHtml: messages.bodyHtml
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .get();
  if (!message) throw new Error('Message not found');
  const links = extractBrowserLinks(message.bodyText, message.bodyHtml);
  const selectedUrl = input.startUrl?.trim() || links[0];
  if (!selectedUrl)
    throw new Error('This email has no safe dashboard link. Paste the report URL to continue.');
  const start = safeUrl(selectedUrl);
  const serviceHosts = ['doordash.com', 'uber.com'].filter(
    (host) => start.hostname === host || start.hostname.endsWith(`.${host}`)
  );
  const existing = getBrowserRecipeForMessage(messageId);
  let profile = existing ? getBrowserProfile(existing.profileId) : null;
  let recipe = existing;
  if (!profile || !recipe) {
    profile = createBrowserProfile({
      name: input.name?.trim() || reportLabel(message),
      startUrl: start.toString(),
      allowedHosts: serviceHosts,
      username: input.username?.trim() || undefined,
      password: input.password || undefined,
      enabled: true
    });
    recipe = createBrowserRecipe({
      profileId: profile.id,
      sourceMessageId: messageId,
      name: input.name?.trim() || `Download ${reportLabel(message)}`,
      description: `Guided report download started from “${message.subject}”.`,
      startUrl: start.toString(),
      actions: [],
      enabled: true
    });
  } else {
    const profileUpdates = {
      ...(!profile.allowedHosts.some(
        (host) => host === start.hostname || start.hostname.endsWith(`.${host}`)
      )
        ? { allowedHosts: [...profile.allowedHosts, start.hostname] }
        : {}),
      ...(input.username?.trim() ? { username: input.username.trim() } : {}),
      ...(input.password ? { password: input.password } : {})
    };
    if (Object.keys(profileUpdates).length) {
      profile = updateBrowserProfile(profile.id, profileUpdates);
    }
    if (recipe.startUrl !== start.toString()) {
      recipe = updateBrowserRecipe(recipe.id, {
        startUrl: start.toString(),
        sourceMessageId: messageId
      });
    }
  }
  if (!profile || !recipe) throw new Error('Could not prepare the browser automation');
  return { message, links, profile, recipe };
}

/**
 * One-click email-first setup. Profiles and empty recipes are implementation
 * details; the user only sees the guided browser session launched from mail.
 */
export async function startEmailBrowserAutomation(
  messageId: number,
  input: {
    startUrl?: string;
    name?: string;
    username?: string;
    password?: string;
  }
) {
  const { links, profile, recipe } = prepareEmailBrowserAutomation(messageId, input);
  const started = await startBrowserRecording({
    profileId: profile.id,
    recipeId: recipe.id,
    startUrl: recipe.startUrl
  });
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_email_automation_started',
    payload: { messageId, profileId: profile.id, recipeId: recipe.id, runId: started.run?.id }
  });
  return {
    messageId,
    links,
    profile: getBrowserProfile(profile.id),
    recipe: getBrowserRecipe(recipe.id),
    run: started.run
  };
}

/**
 * Prepare a client-side recording without opening a server desktop window.
 * The browser bridge records actions in the user's own browser and sends the
 * sanitized actions back through the authenticated app page when finished.
 */
export function startEmailBrowserAutomationClient(
  messageId: number,
  input: {
    startUrl?: string;
    name?: string;
    username?: string;
    password?: string;
    bridgeSessionId: string;
    bridgeOrigin: string;
  }
) {
  const { links, profile, recipe } = prepareEmailBrowserAutomation(messageId, input);
  const now = nowIso();
  const run = db
    .insert(browserRuns)
    .values({
      recipeId: recipe.id,
      profileId: profile.id,
      status: 'recording',
      triggerType: 'client_recording',
      currentActionIndex: 0,
      logsJson: JSON.stringify([
        { at: now, event: 'client_recording_started', url: safeLogUrl(recipe.startUrl) }
      ]),
      createdAt: now,
      startedAt: now
    })
    .returning()
    .get();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_client_recording_started',
    payload: { messageId, profileId: profile.id, recipeId: recipe.id, runId: run.id }
  });
  return {
    messageId,
    links,
    profile: getBrowserProfile(profile.id),
    recipe: getBrowserRecipe(recipe.id),
    run: getBrowserRun(run.id),
    bridge: {
      token: issueBrowserBridgeCapability({
        runId: run.id,
        sessionId: input.bridgeSessionId,
        appOrigin: input.bridgeOrigin
      }),
      sessionId: input.bridgeSessionId,
      appOrigin: input.bridgeOrigin
    }
  };
}

/** Verify the short-lived extension capability and ensure its recording is still live. */
export function verifyClientBrowserBridgeCapability(input: {
  token: string;
  sessionId: string;
  appOrigin: string;
}) {
  const capability = verifyBrowserBridgeCapability(input.token, {
    sessionId: input.sessionId,
    appOrigin: input.appOrigin
  });
  if (!capability) return null;
  const run = getBrowserRun(capability.runId);
  if (!run || run.status !== 'recording' || run.triggerType !== 'client_recording') return null;
  return capability;
}

export function finishClientBrowserRecording(input: {
  runId: number;
  actions: unknown[];
  downloadFilename?: string;
}) {
  const run = getBrowserRun(input.runId);
  if (!run) throw new Error('Browser run not found');
  if (run.status !== 'recording') throw new Error('This browser recording is no longer active');
  if (!run.recipeId || !run.profileId) throw new Error('Browser recording is missing its recipe');
  const recipe = getBrowserRecipe(run.recipeId);
  const profile = getBrowserProfile(run.profileId);
  if (!recipe || !profile) throw new Error('Browser recording is missing its profile or recipe');
  const parsedActions = z.array(BrowserActionSchema).max(100).parse(input.actions);
  const actions = normalizeActions(parsedActions, profile.allowedHosts);
  const finished = nowIso();
  const priorLogs = parseLogs(input.runId);
  const updatedRecipe = db
    .update(browserRecipes)
    .set({
      actionsJson: JSON.stringify(actions),
      lastRunAt: finished,
      updatedAt: finished
    })
    .where(eq(browserRecipes.id, recipe.id))
    .returning()
    .get();
  db.update(browserRuns)
    .set({
      status: 'completed',
      currentActionIndex: actions.length,
      downloadFilename: input.downloadFilename ? safeFilename(input.downloadFilename) : null,
      finishedAt: finished,
      logsJson: JSON.stringify([
        ...(Array.isArray(priorLogs) ? priorLogs : []),
        { at: finished, event: 'client_recording_stopped', actionCount: actions.length }
      ])
    })
    .where(eq(browserRuns.id, input.runId))
    .run();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_client_recording_stopped',
    payload: { runId: input.runId, recipeId: recipe.id, actionCount: actions.length }
  });
  return { run: getBrowserRun(input.runId), recipe: toRecipe(updatedRecipe) };
}

export function browserReportWorkflowPlan(recipe: { id: number; name: string }) {
  return {
    summary: `Download ${recipe.name} and submit the report to Farin after review.`,
    complexity: 'advanced',
    requires_user_approval: true,
    final_reply_draft: null,
    max_turns: 8,
    steps: [
      {
        title: `Download ${recipe.name}`,
        kind: 'browser_recipe',
        details: 'Replay the saved browser session and wait for the report download.',
        tool_name: `browser_recipe:${recipe.id}`,
        tool_input: {},
        depends_on: [],
        condition: null,
        output_key: 'report',
        max_attempts: 2,
        retry_delay_ms: 2000,
        approval_reason: 'Review the authenticated browser download before sending it to Farin.',
        requires_approval: true,
        risk_level: 'medium'
      },
      {
        title: 'Upload report to Farin',
        kind: 'farin_upload',
        details: 'Upload the downloaded report to the configured Farin company.',
        tool_name: null,
        tool_input: {
          file_path: '{{outputs.report.downloadPath}}',
          filename: '{{outputs.report.downloadFilename}}'
        },
        depends_on: [1],
        condition: { path: 'steps.1.output.downloadPath', operator: 'exists' },
        output_key: 'farin',
        max_attempts: 2,
        retry_delay_ms: 2000,
        approval_reason: 'Uploading creates an external accounting document in Farin.',
        requires_approval: true,
        risk_level: 'high'
      }
    ]
  };
}

export function listBrowserRuns(recipeId?: number, limit = 30) {
  return db
    .select()
    .from(browserRuns)
    .where(recipeId ? eq(browserRuns.recipeId, recipeId) : undefined)
    .orderBy(desc(browserRuns.createdAt))
    .limit(Math.max(1, Math.min(100, limit)))
    .all()
    .map(toRun);
}

export function getBrowserRun(id: number) {
  const row = db.select().from(browserRuns).where(eq(browserRuns.id, id)).get();
  return row ? toRun(row) : null;
}

/** Start a headed, isolated browser so the user can log in and demonstrate a recipe. */
export async function startBrowserRecording(input: {
  profileId: number;
  recipeId?: number | null;
  recipeName?: string;
  recipeDescription?: string | null;
  startUrl?: string;
}) {
  const profile = getBrowserProfile(input.profileId);
  if (!profile || !profile.enabled) throw new Error('Browser profile is missing or disabled');
  let recipe = input.recipeId ? getBrowserRecipe(input.recipeId) : null;
  const startUrl = assertAllowedUrl(
    input.startUrl || recipe?.startUrl || profile.startUrl,
    profile.allowedHosts
  );
  if (recipe && recipe.profileId !== profile.id)
    throw new Error('Recipe does not belong to this profile');
  if (!recipe) {
    recipe = createBrowserRecipe({
      profileId: profile.id,
      name: input.recipeName?.trim() || 'New browser recipe',
      description: input.recipeDescription || 'Recorded browser workflow',
      startUrl: startUrl.toString(),
      actions: [],
      enabled: true
    });
  }
  const now = nowIso();
  const run = db
    .insert(browserRuns)
    .values({
      recipeId: recipe.id,
      profileId: profile.id,
      status: 'recording',
      triggerType: 'manual',
      currentActionIndex: 0,
      logsJson: JSON.stringify([
        { at: now, event: 'recording_started', url: safeLogUrl(startUrl.toString()) }
      ]),
      createdAt: now,
      startedAt: now
    })
    .returning()
    .get();
  try {
    reserveProfileRun(profile.id, run.id);
  } catch (error) {
    db.update(browserRuns)
      .set({ status: 'failed', errorMessage: safeBrowserError(error), finishedAt: nowIso() })
      .where(eq(browserRuns.id, run.id))
      .run();
    throw error;
  }
  let session: ActiveSession;
  try {
    session = await launchSession({
      runId: run.id,
      profileId: profile.id,
      recipeId: recipe.id,
      startUrl: startUrl.toString(),
      recording: true
    });
  } catch (error) {
    const message = safeBrowserError(error);
    db.update(browserRuns)
      .set({ status: 'failed', errorMessage: message, finishedAt: nowIso() })
      .where(eq(browserRuns.id, run.id))
      .run();
    releaseProfileRun(profile.id, run.id);
    throw new Error(message, { cause: error });
  }
  activeSessions.set(run.id, session);
  db.update(browserProfiles)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(browserProfiles.id, profile.id))
    .run();
  return { run: getBrowserRun(run.id), recipe: getBrowserRecipe(recipe.id) };
}

export async function getBrowserRecordingEvents(runId: number) {
  const session = activeSessions.get(runId);
  const events: BrowserAction[] = session?.recordingActions.length
    ? [...session.recordingActions]
    : [];
  // Console capture is the durable path and survives navigations. Keep a
  // page-state fallback for older sessions/scripts that are already open.
  if (session && !events.length)
    for (const page of session.pages) events.push(...(await readPageEvents(page)));
  return {
    run: getBrowserRun(runId),
    actions: normalizeActions(events, await allowedHostsForRun(runId))
  };
}

export async function stopBrowserRecording(runId: number, save = true) {
  const session = activeSessions.get(runId);
  const run = getBrowserRun(runId);
  if (!run) throw new Error('Browser run not found');
  if (!session) return { run, recipe: run.recipeId ? getBrowserRecipe(run.recipeId) : null };
  const profileHosts = await allowedHostsForRun(runId);
  const pageEvents: BrowserAction[] = session.recordingActions.length
    ? [...session.recordingActions]
    : [];
  if (!pageEvents.length)
    for (const page of session.pages) pageEvents.push(...(await readPageEvents(page)));
  const actions = normalizeActions(pageEvents, profileHosts);
  let recipe = run.recipeId ? getBrowserRecipe(run.recipeId) : null;
  if (save && recipe) {
    const updated = db
      .update(browserRecipes)
      .set({ actionsJson: JSON.stringify(actions), updatedAt: nowIso(), lastRunAt: nowIso() })
      .where(eq(browserRecipes.id, recipe.id))
      .returning()
      .get();
    recipe = toRecipe(updated);
  }
  await closeSession(runId);
  releaseProfileRun(session.profileId, runId);
  const priorLogs = parseLogs(runId);
  db.update(browserRuns)
    .set({
      status: 'completed',
      currentActionIndex: actions.length,
      finishedAt: nowIso(),
      logsJson: JSON.stringify([
        ...(Array.isArray(priorLogs) ? priorLogs : []),
        { at: nowIso(), event: 'recording_stopped', actionCount: actions.length }
      ])
    })
    .where(eq(browserRuns.id, runId))
    .run();
  recordAgentAudit({
    actor: 'user',
    eventType: 'browser_recording_stopped',
    payload: { runId, recipeId: recipe?.id || null, actionCount: actions.length }
  });
  return { run: getBrowserRun(runId), recipe };
}

type BrowserRecipeRunOptions = {
  taskRunId?: number;
  taskStepId?: number;
  headless?: boolean;
  triggerType?: string;
};

function prepareBrowserRecipeRun(recipeId: number, options: BrowserRecipeRunOptions) {
  const recipe = getBrowserRecipe(recipeId);
  if (!recipe || !recipe.enabled) throw new Error('Browser recipe is missing or disabled');
  const profile = getBrowserProfile(recipe.profileId);
  if (!profile || !profile.enabled) throw new Error('Browser profile is missing or disabled');
  const actions = normalizeActions(recipe.actions as BrowserAction[], profile.allowedHosts);
  const now = nowIso();
  const run = db
    .insert(browserRuns)
    .values({
      recipeId: recipe.id,
      profileId: profile.id,
      status: 'running',
      triggerType: options.triggerType || 'workflow',
      currentActionIndex: 0,
      logsJson: JSON.stringify([{ at: now, event: 'run_started', actionCount: actions.length }]),
      createdAt: now,
      startedAt: now
    })
    .returning()
    .get();
  try {
    reserveProfileRun(profile.id, run.id);
  } catch (error) {
    db.update(browserRuns)
      .set({ status: 'failed', errorMessage: safeBrowserError(error), finishedAt: nowIso() })
      .where(eq(browserRuns.id, run.id))
      .run();
    throw error;
  }
  return { recipe, profile, actions, run };
}

async function executeBrowserRecipeRun(
  prepared: ReturnType<typeof prepareBrowserRecipeRun>,
  options: BrowserRecipeRunOptions
) {
  const { recipe, profile, actions, run } = prepared;
  try {
    const session = await launchSession({
      runId: run.id,
      profileId: profile.id,
      recipeId: recipe.id,
      startUrl: recipe.startUrl,
      recording: false,
      headless: options.headless ?? env.BROWSER_HEADLESS
    });
    activeSessions.set(run.id, session);
    ensureRunActive(run.id);
    const page = [...session.pages][0] || (await session.context.newPage());
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      ensureRunActive(run.id);
      db.update(browserRuns)
        .set({ currentActionIndex: index })
        .where(eq(browserRuns.id, run.id))
        .run();
      await executeAction(page, action, profile.allowedHosts, run.id, profile.id);
      appendRunLog(run.id, { event: 'action_completed', index, type: action.type });
    }
    await waitForDownload(run.id, 10000);
    ensureRunActive(run.id);
    await closeSession(run.id);
    const finished = nowIso();
    const priorLogs = parseLogs(run.id);
    db.update(browserRuns)
      .set({
        status: 'completed',
        currentActionIndex: actions.length,
        finishedAt: finished,
        logsJson: JSON.stringify([
          ...(Array.isArray(priorLogs) ? priorLogs : []),
          { at: finished, event: 'run_completed', actionCount: actions.length }
        ])
      })
      .where(eq(browserRuns.id, run.id))
      .run();
    db.update(browserRecipes)
      .set({ lastRunAt: finished, updatedAt: finished })
      .where(eq(browserRecipes.id, recipe.id))
      .run();
    recordAgentAudit({
      taskRunId: options.taskRunId,
      taskStepId: options.taskStepId,
      actor: 'agent',
      eventType: 'browser_recipe_completed',
      payload: {
        runId: run.id,
        recipeId: recipe.id,
        downloadPath: getBrowserRun(run.id)?.downloadPath || null
      }
    });
    return getBrowserRun(run.id);
  } catch (error) {
    const message = safeBrowserError(error);
    await closeSession(run.id).catch(() => undefined);
    const current = getBrowserRun(run.id);
    if (current?.status !== 'cancelled') {
      db.update(browserRuns)
        .set({ status: 'failed', errorMessage: message, finishedAt: nowIso() })
        .where(eq(browserRuns.id, run.id))
        .run();
      recordAgentAudit({
        taskRunId: options.taskRunId,
        taskStepId: options.taskStepId,
        actor: 'agent',
        eventType: 'browser_recipe_failed',
        payload: { runId: run.id, recipeId: recipe.id, error: message }
      });
    }
    if (current?.status === 'cancelled') return current;
    throw new Error(message, { cause: error });
  } finally {
    releaseProfileRun(profile.id, run.id);
  }
}

export async function runBrowserRecipe(recipeId: number, options: BrowserRecipeRunOptions = {}) {
  const prepared = prepareBrowserRecipeRun(recipeId, options);
  return executeBrowserRecipeRun(prepared, options);
}

/** Persist a run and launch it in the background for HTTP callers that need an immediate response. */
export function startBrowserRecipeRun(recipeId: number, options: BrowserRecipeRunOptions = {}) {
  const prepared = prepareBrowserRecipeRun(recipeId, {
    ...options,
    headless: options.headless ?? true,
    triggerType: options.triggerType || 'verification'
  });
  void executeBrowserRecipeRun(prepared, {
    ...options,
    headless: options.headless ?? true,
    triggerType: options.triggerType || 'verification'
  }).catch(() => undefined);
  return getBrowserRun(prepared.run.id);
}

export async function cancelBrowserRun(id: number) {
  const run = getBrowserRun(id);
  if (!run) return null;
  if (!['recording', 'running', 'needs_attention'].includes(run.status)) return run;
  db.update(browserRuns)
    .set({ status: 'cancelled', finishedAt: nowIso(), errorMessage: 'Cancelled by user.' })
    .where(eq(browserRuns.id, id))
    .run();
  await closeSession(id);
  recordAgentAudit({ actor: 'user', eventType: 'browser_run_cancelled', payload: { runId: id } });
  return getBrowserRun(id);
}

async function launchSession(input: {
  runId: number;
  profileId: number;
  recipeId: number | null;
  startUrl: string;
  recording: boolean;
  headless?: boolean;
}) {
  const profile = getBrowserProfile(input.profileId);
  if (!profile) throw new Error('Browser profile not found');
  const url = assertAllowedUrl(input.startUrl, profile.allowedHosts);
  await fs.mkdir(profileDir(profile.id), { recursive: true });
  const downloads = runDownloadDir(input.runId);
  await fs.mkdir(downloads, { recursive: true });
  const { chromium } = await playwright();
  const context = await chromium.launchPersistentContext(profileDir(profile.id), {
    headless: input.headless ?? (input.recording ? false : env.BROWSER_HEADLESS),
    acceptDownloads: true,
    downloadsPath: downloads,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark'
  });
  const session: ActiveSession = {
    runId: input.runId,
    profileId: profile.id,
    recipeId: input.recipeId,
    recording: input.recording,
    context,
    pages: new Set(context.pages()),
    downloadDir: downloads,
    recordingActions: [],
    downloadTasks: new Set(),
    closed: false
  };
  context.on('page', (page) => {
    session.pages.add(page);
    attachPageListeners(page, session, profile.allowedHosts);
  });
  for (const page of session.pages) attachPageListeners(page, session, profile.allowedHosts);
  const page = [...session.pages][0] || (await context.newPage());
  if (input.recording) await context.addInitScript({ content: recorderScript });
  try {
    await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: env.BROWSER_MAX_RUNTIME_MS
    });
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  return session;
}

const recorderEventPrefix = '__dear_robot_browser_event__:';

function attachPageListeners(
  page: import('playwright').Page,
  session: ActiveSession,
  hosts: string[]
) {
  page.on('console', (message) => {
    if (!session.recording) return;
    const text = message.text();
    if (!text.startsWith(recorderEventPrefix)) return;
    try {
      const envelope = JSON.parse(text.slice(recorderEventPrefix.length)) as {
        action?: unknown;
        replaceLast?: boolean;
      };
      const parsed = BrowserActionSchema.safeParse(envelope.action);
      if (!parsed.success) return;
      const action = parsed.data;
      if (envelope.replaceLast && session.recordingActions.length) {
        const previous = session.recordingActions[session.recordingActions.length - 1];
        if (
          previous.type === 'fill' &&
          action.type === 'fill' &&
          previous.selector === action.selector
        ) {
          session.recordingActions[session.recordingActions.length - 1] = action;
          return;
        }
      }
      if (session.recordingActions.length >= 100) {
        if (!session.recordingLimitReached) {
          session.recordingLimitReached = true;
          appendRunLog(session.runId, { event: 'recording_step_limit_reached' });
        }
        return;
      }
      session.recordingActions.push(action);
    } catch {
      // A page's console output is untrusted; malformed recorder events are ignored.
    }
  });
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    try {
      assertAllowedUrl(frame.url(), hosts);
      appendRunLog(session.runId, { event: 'navigated', url: safeLogUrl(frame.url()) });
    } catch (error) {
      appendRunLog(session.runId, {
        event: 'navigation_blocked',
        url: safeLogUrl(frame.url()),
        error: safeBrowserError(error)
      });
      void page.goBack().catch(() => undefined);
    }
  });
  page.on('download', (download) => {
    if (session.recording) session.recordingActions.push({ type: 'download' });
    void page
      .evaluate(() => {
        const target = window as Window & { __dearRobotBrowserEvents?: unknown[] };
        target.__dearRobotBrowserEvents?.push({ type: 'download' });
      })
      .catch(() => undefined);
    const task = saveDownload(download, session)
      .catch((error) => {
        const message = safeBrowserError(error);
        session.downloadError = message;
        appendRunLog(session.runId, { event: 'download_failed', error: message });
      })
      .then(() => undefined);
    session.downloadTasks.add(task);
    void task.finally(() => session.downloadTasks.delete(task));
  });
}

async function saveDownload(download: import('playwright').Download, session: ActiveSession) {
  const suggested = safeFilename(download.suggestedFilename());
  const target = path.join(session.downloadDir, suggested);
  await download.saveAs(target);
  const stat = await fs.stat(target);
  if (stat.size > env.BROWSER_MAX_DOWNLOAD_BYTES) {
    await fs.rm(target, { force: true });
    throw new Error(
      `Download exceeds the ${Math.round(env.BROWSER_MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB browser limit.`
    );
  }
  db.update(browserRuns)
    .set({ downloadPath: target, downloadFilename: suggested })
    .where(eq(browserRuns.id, session.runId))
    .run();
  appendRunLog(session.runId, {
    event: 'download_saved',
    path: target,
    filename: suggested,
    bytes: stat.size
  });
}

async function executeAction(
  page: import('playwright').Page,
  action: BrowserAction,
  hosts: string[],
  runId: number,
  profileId: number
) {
  // A redirect can complete between actions. Re-check the live page before
  // filling credentials or clicking anything so OAuth/session URLs cannot be
  // used as an accidental action target.
  if (page.url() && page.url() !== 'about:blank') assertAllowedUrl(page.url(), hosts);
  if (action.type === 'goto') {
    await page.goto(assertAllowedUrl(action.url, hosts).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: env.BROWSER_MAX_RUNTIME_MS
    });
    return;
  }
  if (action.type === 'wait') {
    await page.waitForTimeout(action.milliseconds);
    return;
  }
  if (action.type === 'download') {
    await waitForDownload(runId, action.timeoutMs || 10000);
    return;
  }
  let locator = page.locator(action.selector);
  let count = await locator.count();
  if (count > 1) {
    throw new Error(
      `Selector “${action.selector}” matched ${count} elements. Refine the saved recipe selector before replaying it.`
    );
  }
  try {
    if (count === 0) {
      if (await completeVisibleEmailChallenge(page, runId, profileId)) {
        locator = page.locator(action.selector);
        count = await locator.count();
        if (count > 1) {
          throw new Error(
            `Selector “${action.selector}” matched ${count} elements after verification. Refine the saved recipe selector.`
          );
        }
      }
      if (count === 0 && action.optional && !(await hasVisibleAuthenticationSurface(page))) return;
    }
    await locator.waitFor({
      state: 'visible',
      timeout: action.optional
        ? Math.min(env.BROWSER_MAX_RUNTIME_MS, 1800)
        : env.BROWSER_MAX_RUNTIME_MS
    });
  } catch (error) {
    if (await completeVisibleEmailChallenge(page, runId, profileId)) {
      locator = page.locator(action.selector);
      count = await locator.count();
      if (count > 1) {
        throw new Error(
          `Selector “${action.selector}” matched ${count} elements after verification. Refine the saved recipe selector.`,
          { cause: error }
        );
      }
      await locator.waitFor({ state: 'visible', timeout: env.BROWSER_MAX_RUNTIME_MS });
    } else if (action.optional && !(await hasVisibleAuthenticationSurface(page))) {
      // Optional login controls are skipped only when the page clearly is not
      // showing a login/challenge surface. A changed selector on an expired
      // login page must remain a visible failure.
      return;
    } else {
      throw error;
    }
  }
  if (action.type === 'click') {
    await locator.click({ timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'check') {
    await locator.setChecked(action.checked, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'fill') {
    if (action.secretRef) {
      const secrets = getBrowserProfileSecrets(profileId);
      const value =
        action.secretRef === 'email_code'
          ? await waitForEmailVerification(runId, profileId)
          : secrets?.[action.secretRef] || '';
      if (!value) {
        throw new Error(
          `This automation is missing its saved ${action.secretRef}. Open Automate this report from the source email to update the login.`
        );
      }
      try {
        await locator.fill(value, { timeout: env.BROWSER_MAX_RUNTIME_MS });
      } catch (error) {
        throw new Error(`Could not fill the saved ${action.secretRef} into the login form.`, {
          cause: error
        });
      }
    } else {
      if (action.secret || action.value === null || action.value === undefined) {
        throw new Error(
          'Recipe contains an unconfigured secret field. Save the profile credential and record the login again.'
        );
      }
      await locator.fill(action.value, { timeout: env.BROWSER_MAX_RUNTIME_MS });
    }
  } else if (action.type === 'press') {
    await locator.press(action.key, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'select') {
    await locator.selectOption(action.value, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  }
}

async function hasVisibleAuthenticationSurface(page: import('playwright').Page) {
  const candidates = page.locator(
    'input[type="password"], input[autocomplete="current-password"], input[autocomplete="username"], input[autocomplete="one-time-code"], input[name="otp"], input[name="verificationCode"]'
  );
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    if (
      await candidates
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  return false;
}

/** Complete a visible email-code challenge, including split one-character fields. */
async function completeVisibleEmailChallenge(
  page: import('playwright').Page,
  runId: number,
  profileId: number
) {
  const fields = page.locator(
    'input[autocomplete="one-time-code"], input[name="otp"], input[name="verificationCode"], input[inputmode="numeric"]'
  );
  const visible: import('playwright').Locator[] = [];
  for (let index = 0; index < (await fields.count()); index += 1) {
    const field = fields.nth(index);
    if (await field.isVisible().catch(() => false)) visible.push(field);
  }
  if (!visible.length) return false;
  const code = await waitForEmailVerification(runId, profileId);
  try {
    if (visible.length === 1) {
      await visible[0].fill(code, { timeout: env.BROWSER_MAX_RUNTIME_MS });
    } else if (visible.length >= code.length && visible.length <= 8) {
      for (let index = 0; index < code.length; index += 1) {
        await visible[index].fill(code[index], { timeout: env.BROWSER_MAX_RUNTIME_MS });
      }
    } else {
      throw new Error('unsupported field count');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'unsupported field count') {
      throw new Error(
        'The verification form has an unsupported number of code fields. Complete this login in the browser recording window.',
        { cause: error }
      );
    }
    throw new Error('Could not fill the fresh verification code into the login form.', {
      cause: error
    });
  }
  const submits = page.getByRole('button', {
    name: /^(verify|verify code|continue|submit|next|sign in)$/i
  });
  const submitCount = await submits.count();
  let submit: import('playwright').Locator | null = null;
  for (let index = 0; index < submitCount; index += 1) {
    const candidate = submits.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      if (submit)
        throw new Error(
          'Verification form has multiple visible submit buttons. Complete this login in the browser recording window.'
        );
      submit = candidate;
    }
  }
  if (!submit) {
    const fallback = page.locator('button[type="submit"], input[type="submit"]');
    const fallbackVisible: import('playwright').Locator[] = [];
    for (let index = 0; index < (await fallback.count()); index += 1) {
      const candidate = fallback.nth(index);
      if (await candidate.isVisible().catch(() => false)) fallbackVisible.push(candidate);
    }
    if (fallbackVisible.length === 1) submit = fallbackVisible[0];
  }
  if (!submit)
    throw new Error(
      'Verification code entered; the verification form needs your help to continue.'
    );
  await submit.click({ timeout: env.BROWSER_MAX_RUNTIME_MS });
  return true;
}

async function waitForEmailVerification(runId: number, profileId: number) {
  const run = getBrowserRun(runId);
  const recipe = run?.recipeId ? getBrowserRecipe(run.recipeId) : null;
  const source = recipe?.sourceMessageId
    ? db.select().from(messages).where(eq(messages.id, recipe.sourceMessageId)).get()
    : null;
  const profile = getBrowserProfile(profileId);
  const email = getBrowserProfileSecrets(profileId)?.username;
  if (!source || !profile || !email?.includes('@')) {
    throw new Error(
      'Email verification needs a source email and a saved login email address. Reopen Automate this report from your inbox.'
    );
  }
  const since = Math.max(
    Date.parse(run!.startedAt || run!.createdAt) - 30000,
    Date.now() - 5 * 60000
  );
  appendRunLog(runId, { event: 'waiting_for_email_code', accountId: source.accountId });
  const code = await waitForInboxVerification({
    sourceAccountId: source.accountId,
    email,
    hosts: profile.allowedHosts,
    since,
    isCancelled: () => getBrowserRun(runId)?.status === 'cancelled'
  });
  appendRunLog(runId, { event: 'email_code_received' });
  return code;
}

async function waitForDownload(runId: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = getBrowserRun(runId);
    if (run?.status === 'cancelled') throw new Error('Browser run cancelled');
    const session = activeSessions.get(runId);
    if (session?.downloadError) throw new Error(`Report download failed: ${session.downloadError}`);
    if (run?.downloadPath) return run.downloadPath;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const session = activeSessions.get(runId);
  if (session?.downloadError) throw new Error(`Report download failed: ${session.downloadError}`);
  if (getBrowserRun(runId)?.status === 'cancelled') throw new Error('Browser run cancelled');
  throw new Error('Timed out waiting for a report download.');
}

async function readPageEvents(page: import('playwright').Page) {
  try {
    const raw = await page.evaluate(
      () =>
        (window as Window & { __dearRobotBrowserEvents?: unknown[] }).__dearRobotBrowserEvents || []
    );
    return Array.isArray(raw)
      ? raw.flatMap((value) =>
          BrowserActionSchema.safeParse(value).success ? [value as BrowserAction] : []
        )
      : [];
  } catch {
    return [];
  }
}

async function allowedHostsForRun(runId: number) {
  const run = getBrowserRun(runId);
  const profile = run?.profileId ? getBrowserProfile(run.profileId) : null;
  return profile?.allowedHosts || [];
}

function normalizeActions(actions: BrowserAction[], hosts: string[]) {
  const result: BrowserAction[] = [];
  for (const raw of actions) {
    const parsed = BrowserActionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const action = parsed.data;
    if (action.type === 'goto') assertAllowedUrl(action.url, hosts);
    // Never persist secret values. A recognized credential field stores only a
    // reference to the encrypted profile credential, never the typed value.
    if (
      action.type === 'fill' &&
      (action.secret || action.value === null || action.value === undefined) &&
      !action.secretRef
    )
      continue;
    const normalizedAction =
      action.type === 'fill' && action.secretRef
        ? { ...action, value: null, secret: true, optional: true }
        : action;
    const previous = result[result.length - 1];
    if (previous && JSON.stringify(previous) === JSON.stringify(normalizedAction)) continue;
    result.push(normalizedAction);
  }
  return result.slice(0, 100);
}

function parseLogs(runId: number) {
  const row = db
    .select({ logs: browserRuns.logsJson })
    .from(browserRuns)
    .where(eq(browserRuns.id, runId))
    .get();
  return parseJson(row?.logs, []);
}

async function closeSession(runId: number) {
  const session = activeSessions.get(runId);
  if (!session || session.closed) return;
  session.closed = true;
  activeSessions.delete(runId);
  releaseProfileRun(session.profileId, runId);
  await session.context.close();
}

async function closeSessionsForProfile(profileId: number) {
  await Promise.all(
    [...activeSessions.values()]
      .filter((session) => session.profileId === profileId)
      .map((session) => closeSession(session.runId))
  );
}

async function closeSessionsForRecipe(recipeId: number) {
  await Promise.all(
    [...activeSessions.values()]
      .filter((session) => session.recipeId === recipeId)
      .map((session) => closeSession(session.runId))
  );
}

const recorderScript = `
(() => {
  const win = window;
  win.__dearRobotBrowserEvents = win.__dearRobotBrowserEvents || [];
  const events = win.__dearRobotBrowserEvents;
  const emit = (action, replaceLast = false) => {
    // The server receives this through Playwright's page console stream. It
    // remains available when a navigation replaces the document, unlike a
    // window property that would otherwise be lost.
    try { console.debug('__dear_robot_browser_event__:' + JSON.stringify({ action, replaceLast })); } catch {}
  };
  const selector = (element) => {
    if (!(element instanceof Element)) return '';
    if (element.id && !element.id.includes(':')) return '#' + CSS.escape(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    const name = element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const label = element.getAttribute('aria-label');
    if (label) return element.tagName.toLowerCase() + '[aria-label=' + JSON.stringify(label) + ']';
    if (element.matches('button,a,[role="button"]') && element.textContent.trim()) return element.tagName.toLowerCase() + ':text-is(' + JSON.stringify(element.textContent.trim()) + ')';
    const parts = [];
    let current = element;
    for (let i = 0; current && current.nodeType === 1 && i < 5; i++, current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const credentialRef = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
    if (target instanceof HTMLInputElement && target.type === 'password') return 'password';
    const hint = [target.autocomplete, target.name, target.id, target.getAttribute('aria-label') || '']
      .join(' ')
      .toLowerCase();
    if (/one-time-code|otp|verification|security.?code|verify.?code/.test(hint)) return 'email_code';
    if (/(^|[\\s_-])(user(name)?|login|email)([\\s_-]|$)/.test(hint)) return 'username';
    return null;
  };
  const isLoginControl = (target) => {
    if (!(target instanceof Element)) return false;
    const form = target.closest('form');
    return Boolean(form && form.querySelector('input[type="password"], input[autocomplete="current-password"], input[autocomplete="password"]'));
  };
  const recordFill = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)) return;
    const secretRef = credentialRef(target);
    const value = secretRef ? null : target.value.slice(0, 4000);
    const item = secretRef
      ? { type: 'fill', selector: selector(target), value: null, secret: true, secretRef }
      : { type: 'fill', selector: selector(target), value, secret: false };
    const previous = events[events.length - 1];
    if (previous && previous.type === 'fill' && previous.selector === item.selector) {
      events[events.length - 1] = item;
      emit(item, true);
    } else {
      events.push(item);
      emit(item);
    }
  };
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)) {
      const item = { type: 'check', selector: selector(target), checked: target.checked };
      events.push(item);
      emit(item);
    } else if (target instanceof HTMLSelectElement) {
      const item = { type: 'select', selector: selector(target), value: target.value };
      events.push(item);
      emit(item);
    }
    else recordFill(target);
  }, true);
  document.addEventListener('blur', (event) => recordFill(event.target), true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
    if (target) {
      const item = { type: 'click', selector: selector(target), optional: isLoginControl(target) };
      const normalized = item.optional ? item : { type: 'click', selector: item.selector };
      events.push(normalized);
      emit(normalized);
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (event.key === 'Enter' && target instanceof Element) {
      const item = { type: 'press', selector: selector(target), key: 'Enter', optional: isLoginControl(target) };
      const normalized = item.optional ? item : { type: 'press', selector: item.selector, key: item.key };
      events.push(normalized);
      emit(normalized);
    }
  }, true);
})();
`;

declare global {
  interface Window {
    __dearRobotBrowserEvents?: unknown[];
  }
}
