import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { env } from './env';
import { db, nowIso } from './db';
import {
  browserProfiles,
  browserRecipes,
  browserRuns,
  type BrowserRecipe,
  type BrowserRun
} from './db/schema';
import { recordAgentAudit, parseJson } from './agent/runtime';

/** Browser recipes deliberately contain no arbitrary JavaScript. */
export const BrowserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), url: z.string().url() }).strict(),
  z.object({ type: z.literal('click'), selector: z.string().min(1).max(500) }).strict(),
  z
    .object({
      type: z.literal('fill'),
      selector: z.string().min(1).max(500),
      value: z.string().max(4000).nullable().optional(),
      secret: z.boolean().optional()
    })
    .strict(),
  z.object({ type: z.literal('press'), selector: z.string().min(1).max(500), key: z.string().min(1).max(80) }).strict(),
  z.object({ type: z.literal('select'), selector: z.string().min(1).max(500), value: z.string().max(1000) }).strict(),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(50).max(30000) }).strict(),
  z.object({ type: z.literal('download'), timeoutMs: z.number().int().min(500).max(30000).optional() }).strict()
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

const BrowserProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startUrl: z.string().url().max(2000),
  allowedHosts: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  enabled: z.boolean().default(true)
});

const BrowserRecipeInputSchema = z.object({
  profileId: z.coerce.number().int().positive(),
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
  context: import('playwright').BrowserContext;
  pages: Set<import('playwright').Page>;
  downloadDir: string;
  closed: boolean;
};

const activeSessions = new Map<number, ActiveSession>();
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

function normalizeHost(value: string) {
  const raw = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0];
  const host = raw.split(':')[0];
  if (!host || host.includes('..') || /[^a-z0-9.-]/.test(host)) throw new Error(`Invalid allowed host: ${value}`);
  return host;
}

function hostAllowed(url: URL, allowedHosts: string[]) {
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
}

function assertAllowedUrl(value: string, allowedHosts: string[]) {
  const url = safeUrl(value);
  if (!hostAllowed(url, allowedHosts)) throw new Error(`Browser navigation blocked for host ${url.hostname}. Add it to the profile allowlist.`);
  return url;
}

function parseHosts(value: string | null | undefined) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function toProfile(row: typeof browserProfiles.$inferSelect) {
  return { ...row, allowedHosts: parseHosts(row.allowedHostsJson) };
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
  db.update(browserRuns).set({ logsJson: JSON.stringify(next) }).where(eq(browserRuns.id, runId)).run();
  return next;
}

export function listBrowserProfiles() {
  return db.select().from(browserProfiles).orderBy(desc(browserProfiles.updatedAt)).all().map(toProfile);
}

export function getBrowserProfile(id: number) {
  const row = db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
  return row ? toProfile(row) : null;
}

export function createBrowserProfile(input: unknown) {
  const parsed = BrowserProfileInputSchema.parse(input);
  const start = safeUrl(parsed.startUrl);
  const hosts = [...new Set([start.hostname.toLowerCase(), ...parsed.allowedHosts.map(normalizeHost)])];
  const now = nowIso();
  const row = db
    .insert(browserProfiles)
    .values({
      name: parsed.name,
      startUrl: start.toString(),
      allowedHostsJson: JSON.stringify(hosts),
      enabled: parsed.enabled,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  recordAgentAudit({ actor: 'user', eventType: 'browser_profile_created', payload: { profileId: row.id, name: row.name, allowedHosts: hosts } });
  return toProfile(row);
}

export function updateBrowserProfile(id: number, input: unknown) {
  const existing = db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).get();
  if (!existing) return null;
  const parsed = BrowserProfileInputSchema.partial().parse(input);
  const start = parsed.startUrl ? safeUrl(parsed.startUrl) : safeUrl(existing.startUrl);
  const suppliedHosts = parsed.allowedHosts ?? parseHosts(existing.allowedHostsJson);
  const hosts = [...new Set([start.hostname.toLowerCase(), ...suppliedHosts.map(normalizeHost)])];
  const row = db
    .update(browserProfiles)
    .set({
      name: parsed.name ?? existing.name,
      startUrl: start.toString(),
      allowedHostsJson: JSON.stringify(hosts),
      enabled: parsed.enabled ?? existing.enabled,
      updatedAt: nowIso()
    })
    .where(eq(browserProfiles.id, id))
    .returning()
    .get();
  return toProfile(row);
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
  recordAgentAudit({ actor: 'user', eventType: 'browser_recipe_created', payload: { recipeId: row.id, profileId: row.profileId, actionCount: actions.length } });
  return toRecipe(row);
}

export function updateBrowserRecipe(id: number, input: unknown) {
  const existing = db.select().from(browserRecipes).where(eq(browserRecipes.id, id)).get();
  if (!existing) return null;
  const parsed = BrowserRecipeInputSchema.partial().parse(input);
  const profile = getBrowserProfile(parsed.profileId ?? existing.profileId);
  if (!profile) throw new Error('Browser profile not found');
  const start = assertAllowedUrl(parsed.startUrl ?? existing.startUrl, profile.allowedHosts);
  const actions = parsed.actions ? normalizeActions(parsed.actions, profile.allowedHosts) : parseJson(existing.actionsJson, []);
  const row = db
    .update(browserRecipes)
    .set({
      profileId: profile.id,
      name: parsed.name ?? existing.name,
      description: parsed.description === undefined ? existing.description : parsed.description || null,
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
  const startUrl = assertAllowedUrl(input.startUrl || recipe?.startUrl || profile.startUrl, profile.allowedHosts);
  if (recipe && recipe.profileId !== profile.id) throw new Error('Recipe does not belong to this profile');
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
      logsJson: JSON.stringify([{ at: now, event: 'recording_started', url: startUrl.toString() }]),
      createdAt: now,
      startedAt: now
    })
    .returning()
    .get();
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
    const message = error instanceof Error ? error.message : String(error);
    db.update(browserRuns)
      .set({ status: 'failed', errorMessage: message, finishedAt: nowIso() })
      .where(eq(browserRuns.id, run.id))
      .run();
    throw new Error(message, { cause: error });
  }
  activeSessions.set(run.id, session);
  db.update(browserProfiles).set({ lastUsedAt: now, updatedAt: now }).where(eq(browserProfiles.id, profile.id)).run();
  return { run: getBrowserRun(run.id), recipe: getBrowserRecipe(recipe.id) };
}

export async function getBrowserRecordingEvents(runId: number) {
  const session = activeSessions.get(runId);
  const events: BrowserAction[] = [];
  if (session) {
    for (const page of session.pages) events.push(...(await readPageEvents(page)));
  }
  return { run: getBrowserRun(runId), actions: normalizeActions(events, await allowedHostsForRun(runId)) };
}

export async function stopBrowserRecording(runId: number, save = true) {
  const session = activeSessions.get(runId);
  const run = getBrowserRun(runId);
  if (!run) throw new Error('Browser run not found');
  if (!session) return { run, recipe: run.recipeId ? getBrowserRecipe(run.recipeId) : null };
  const profileHosts = await allowedHostsForRun(runId);
  const pageEvents: BrowserAction[] = [];
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
  recordAgentAudit({ actor: 'user', eventType: 'browser_recording_stopped', payload: { runId, recipeId: recipe?.id || null, actionCount: actions.length } });
  return { run: getBrowserRun(runId), recipe };
}

export async function runBrowserRecipe(
  recipeId: number,
  options: { taskRunId?: number; taskStepId?: number; headless?: boolean; triggerType?: string } = {}
) {
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
    const session = await launchSession({
      runId: run.id,
      profileId: profile.id,
      recipeId: recipe.id,
      startUrl: recipe.startUrl,
      recording: false,
      headless: options.headless ?? env.BROWSER_HEADLESS
    });
    activeSessions.set(run.id, session);
    const page = [...session.pages][0] || (await session.context.newPage());
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const current = getBrowserRun(run.id);
      if (current?.status === 'cancelled') throw new Error('Browser run cancelled');
      db.update(browserRuns).set({ currentActionIndex: index }).where(eq(browserRuns.id, run.id)).run();
      await executeAction(page, action, profile.allowedHosts, run.id);
      appendRunLog(run.id, { event: 'action_completed', index, type: action.type });
    }
    await waitForDownload(run.id, 1800).catch(() => null);
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
    db.update(browserRecipes).set({ lastRunAt: finished, updatedAt: finished }).where(eq(browserRecipes.id, recipe.id)).run();
    recordAgentAudit({ taskRunId: options.taskRunId, taskStepId: options.taskStepId, actor: 'agent', eventType: 'browser_recipe_completed', payload: { runId: run.id, recipeId, downloadPath: getBrowserRun(run.id)?.downloadPath || null } });
    return getBrowserRun(run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeSession(run.id).catch(() => undefined);
    db.update(browserRuns).set({ status: 'failed', errorMessage: message, finishedAt: nowIso() }).where(eq(browserRuns.id, run.id)).run();
    recordAgentAudit({ taskRunId: options.taskRunId, taskStepId: options.taskStepId, actor: 'agent', eventType: 'browser_recipe_failed', payload: { runId: run.id, recipeId, error: message } });
    throw new Error(message, { cause: error });
  }
}

export async function cancelBrowserRun(id: number) {
  const run = getBrowserRun(id);
  if (!run) return null;
  db.update(browserRuns).set({ status: 'cancelled', finishedAt: nowIso(), errorMessage: 'Cancelled by user.' }).where(eq(browserRuns.id, id)).run();
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
    context,
    pages: new Set(context.pages()),
    downloadDir: downloads,
    closed: false
  };
  context.on('page', (page) => {
    session.pages.add(page);
    attachPageListeners(page, session, profile.allowedHosts);
  });
  for (const page of session.pages) attachPageListeners(page, session, profile.allowedHosts);
  const page = [...session.pages][0] || (await context.newPage());
  if (input.recording) await context.addInitScript({ content: recorderScript });
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: env.BROWSER_MAX_RUNTIME_MS });
  return session;
}

function attachPageListeners(page: import('playwright').Page, session: ActiveSession, hosts: string[]) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    try {
      assertAllowedUrl(frame.url(), hosts);
      appendRunLog(session.runId, { event: 'navigated', url: frame.url() });
    } catch (error) {
      appendRunLog(session.runId, { event: 'navigation_blocked', url: frame.url(), error: error instanceof Error ? error.message : String(error) });
      void page.goBack().catch(() => undefined);
    }
  });
  page.on('download', (download) => {
    void page
      .evaluate(() => {
        const target = window as Window & { __dearRobotBrowserEvents?: unknown[] };
        target.__dearRobotBrowserEvents?.push({ type: 'download' });
      })
      .catch(() => undefined);
    void saveDownload(download, session).catch((error) => {
      appendRunLog(session.runId, { event: 'download_failed', error: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function saveDownload(download: import('playwright').Download, session: ActiveSession) {
  const suggested = safeFilename(download.suggestedFilename());
  const target = path.join(session.downloadDir, suggested);
  await download.saveAs(target);
  const stat = await fs.stat(target);
  if (stat.size > env.BROWSER_MAX_DOWNLOAD_BYTES) {
    await fs.rm(target, { force: true });
    throw new Error(`Download exceeds the ${Math.round(env.BROWSER_MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB browser limit.`);
  }
  db.update(browserRuns)
    .set({ downloadPath: target, downloadFilename: suggested })
    .where(eq(browserRuns.id, session.runId))
    .run();
  appendRunLog(session.runId, { event: 'download_saved', path: target, filename: suggested, bytes: stat.size });
}

async function executeAction(page: import('playwright').Page, action: BrowserAction, hosts: string[], runId: number) {
  if (action.type === 'goto') {
    await page.goto(assertAllowedUrl(action.url, hosts).toString(), { waitUntil: 'domcontentloaded', timeout: env.BROWSER_MAX_RUNTIME_MS });
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
  const locator = page.locator(action.selector).first();
  await locator.waitFor({ state: 'visible', timeout: env.BROWSER_MAX_RUNTIME_MS });
  if (action.type === 'click') {
    await locator.click({ timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'fill') {
    if (action.secret || action.value === null || action.value === undefined) throw new Error('Recipe contains a secret field. Log in once while recording; secrets are never replayed.');
    await locator.fill(action.value, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'press') {
    await locator.press(action.key, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  } else if (action.type === 'select') {
    await locator.selectOption(action.value, { timeout: env.BROWSER_MAX_RUNTIME_MS });
  }
}

async function waitForDownload(runId: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = getBrowserRun(runId);
    if (run?.downloadPath) return run.downloadPath;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for a report download.');
}

async function readPageEvents(page: import('playwright').Page) {
  try {
    const raw = await page.evaluate(() => (window as Window & { __dearRobotBrowserEvents?: unknown[] }).__dearRobotBrowserEvents || []);
    return Array.isArray(raw) ? raw.flatMap((value) => BrowserActionSchema.safeParse(value).success ? [value as BrowserAction] : []) : [];
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
    // Never persist secret values. Recording intentionally drops password fills;
    // the persistent browser profile keeps the authenticated session instead.
    if (action.type === 'fill' && (action.secret || action.value === null || action.value === undefined)) continue;
    const previous = result[result.length - 1];
    if (previous && JSON.stringify(previous) === JSON.stringify(action)) continue;
    result.push(action);
  }
  return result.slice(0, 100);
}

function parseLogs(runId: number) {
  const row = db.select({ logs: browserRuns.logsJson }).from(browserRuns).where(eq(browserRuns.id, runId)).get();
  return parseJson(row?.logs, []);
}

async function closeSession(runId: number) {
  const session = activeSessions.get(runId);
  if (!session || session.closed) return;
  session.closed = true;
  activeSessions.delete(runId);
  await session.context.close();
}

async function closeSessionsForProfile(profileId: number) {
  await Promise.all([...activeSessions.values()].filter((session) => session.profileId === profileId).map((session) => closeSession(session.runId)));
}

async function closeSessionsForRecipe(recipeId: number) {
  await Promise.all([...activeSessions.values()].filter((session) => session.recipeId === recipeId).map((session) => closeSession(session.runId)));
}

const recorderScript = `
(() => {
  const win = window;
  win.__dearRobotBrowserEvents = win.__dearRobotBrowserEvents || [];
  const events = win.__dearRobotBrowserEvents;
  const selector = (element) => {
    if (!(element instanceof Element)) return '';
    if (element.id) return '#' + CSS.escape(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    const name = element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
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
  const recordFill = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const value = target.type === 'password' ? null : target.value.slice(0, 4000);
    const item = { type: 'fill', selector: selector(target), value, secret: target.type === 'password' };
    const previous = events[events.length - 1];
    if (previous && previous.type === 'fill' && previous.selector === item.selector) events[events.length - 1] = item;
    else events.push(item);
  };
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement) events.push({ type: 'select', selector: selector(target), value: target.value });
    else recordFill(target);
  }, true);
  document.addEventListener('blur', (event) => recordFill(event.target), true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
    if (target) events.push({ type: 'click', selector: selector(target) });
  }, true);
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (event.key === 'Enter' && target instanceof Element) events.push({ type: 'press', selector: selector(target), key: 'Enter' });
  }, true);
})();
`;

declare global {
  interface Window {
    __dearRobotBrowserEvents?: unknown[];
  }
}
