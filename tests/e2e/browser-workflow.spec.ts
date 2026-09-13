import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

/**
 * The regular e2e fixture mailbox has no report email. These tests add one to
 * the disposable e2e database and use a local portal so the full recording →
 * server replay path remains deterministic and offline.
 */
const e2eDbPath = process.env.DB_PATH || '/tmp/dear-robot-e2e/dear-robot.db';
const testEmail = 'reports@example.test';
const verificationCode = '736291';

type Portal = {
  server: Server;
  startUrl: string;
  close: () => Promise<void>;
};

type SeededMailbox = {
  accountId: number;
  messageId: number;
};

type BridgeCapability = {
  token: string;
  sessionId: string;
  appOrigin: string;
};

function withDatabase<T>(callback: (database: Database.Database) => T): T {
  const database = new Database(e2eDbPath, { timeout: 5000 });
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function insertMailboxMessage(
  accountId: number,
  input: {
    providerMessageId: string;
    subject: string;
    from: string;
    to: string;
    bodyText: string;
  }
) {
  const now = new Date().toISOString();
  return withDatabase((database) => {
    const result = database
      .prepare(
        `INSERT INTO messages (
          account_id, provider_message_id, thread_id, message_id_header,
          in_reply_to, "references", folder_path, subject, "from", "to",
          cc, bcc, date, body_text, body_html, is_read, is_answered,
          is_flagged, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        accountId,
        input.providerMessageId,
        input.providerMessageId,
        `<${input.providerMessageId}@e2e.dear-robot.local>`,
        null,
        null,
        'INBOX',
        input.subject,
        input.from,
        input.to,
        null,
        null,
        now,
        input.bodyText,
        null,
        0,
        0,
        0,
        now,
        now
      );
    return Number(result.lastInsertRowid);
  });
}

function seedReportMailbox(startUrl: string): SeededMailbox {
  const accountId = withDatabase((database) => {
    const account = database
      .prepare("SELECT id FROM accounts WHERE host = 'mock' ORDER BY id LIMIT 1")
      .get() as { id?: number } | undefined;
    if (!account?.id) throw new Error('The mock e2e mailbox was not seeded');
    return account.id;
  });
  const reportMessageId = insertMailboxMessage(accountId, {
    providerMessageId: `browser-workflow-report-${Date.now()}-${Math.random()}`,
    subject: 'Weekly delivery report is ready',
    from: 'Reports Portal <no-reply@127.0.0.1>',
    to: testEmail,
    bodyText: `Your weekly report is ready. Download it here: ${startUrl}`
  });
  return { accountId, messageId: reportMessageId };
}

function seedVerificationEmail(accountId: number) {
  return insertMailboxMessage(accountId, {
    providerMessageId: `browser-workflow-verification-${Date.now()}-${Math.random()}`,
    subject: 'Your verification code',
    from: 'Reports Portal <no-reply@127.0.0.1>',
    to: testEmail,
    bodyText: `Your verification code is ${verificationCode}`
  });
}

/** Remove only rows created by this spec so the shared e2e mailbox stays pristine. */
function cleanupBrowserWorkflow(messageIds: number[]) {
  if (!messageIds.length) return;
  withDatabase((database) => {
    const placeholders = messageIds.map(() => '?').join(', ');
    const recipes = database
      .prepare(
        `SELECT id, profile_id FROM browser_recipes WHERE source_message_id IN (${placeholders})`
      )
      .all(...messageIds) as Array<{ id: number; profile_id: number }>;
    const recipeIds = recipes.map((recipe) => recipe.id);
    const profileIds = recipes.map((recipe) => recipe.profile_id);
    const transaction = database.transaction(() => {
      if (recipeIds.length) {
        const recipePlaceholders = recipeIds.map(() => '?').join(', ');
        const profilePlaceholders = profileIds.map(() => '?').join(', ');
        database
          .prepare(
            `DELETE FROM browser_runs WHERE recipe_id IN (${recipePlaceholders}) OR profile_id IN (${profilePlaceholders})`
          )
          .run(...recipeIds, ...profileIds);
        for (const recipeId of recipeIds) {
          database
            .prepare(`DELETE FROM automation_workflows WHERE filters_json LIKE ?`)
            .run(`%"browserRecipeId":${recipeId}%`);
        }
        database
          .prepare(`DELETE FROM browser_recipes WHERE id IN (${recipePlaceholders})`)
          .run(...recipeIds);
        database
          .prepare(`DELETE FROM browser_profiles WHERE id IN (${profilePlaceholders})`)
          .run(...profileIds);
      }
      database.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds);
    });
    transaction();
  });
}

async function startPortal(): Promise<Portal> {
  const readForm = async (request: import('node:http').IncomingMessage) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    return new URLSearchParams(body);
  };
  const isVerified = (request: import('node:http').IncomingMessage) =>
    request.headers.cookie
      ?.split(';')
      .some((value) => value.trim() === 'portal-session=verified') ?? false;

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'POST' && pathname === '/login') {
      const form = await readForm(request);
      if (form.get('username') !== testEmail || form.get('password') !== 'portal-password') {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Invalid portal credentials');
        return;
      }
      response.setHeader('set-cookie', 'portal-session=pending; HttpOnly; SameSite=Lax; Path=/');
      response.writeHead(303, { location: '/verify' });
      response.end();
      return;
    }
    if (request.method === 'POST' && pathname === '/verify') {
      const form = await readForm(request);
      const hasPendingSession = request.headers.cookie
        ?.split(';')
        .some((value) => value.trim() === 'portal-session=pending');
      if (!hasPendingSession || form.get('otp') !== verificationCode) {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Invalid verification code');
        return;
      }
      response.setHeader('set-cookie', 'portal-session=verified; HttpOnly; SameSite=Lax; Path=/');
      response.writeHead(303, { location: '/reports' });
      response.end();
      return;
    }
    if (pathname === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<form method="post" action="/login">' +
          '<label>Email <input name="username" autocomplete="username"></label>' +
          '<label>Password <input name="password" type="password" autocomplete="current-password"></label>' +
          '<button name="login" type="submit">Sign in</button>' +
          '</form>'
      );
      return;
    }
    if (pathname === '/verify') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<form method="post" action="/verify">' +
          '<label>Verification code <input name="otp" autocomplete="one-time-code"></label>' +
          '<button name="verify" type="submit">Verify</button>' +
          '</form>'
      );
      return;
    }
    if (pathname === '/reports') {
      if (!isVerified(request)) {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Verification required');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<a id="report" href="/report">Latest report</a>');
      return;
    }
    if (pathname === '/report') {
      if (!isVerified(request)) {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Verification required');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<a id="download-report" href="/downloads/report.csv" download>Download report</a>'
      );
      return;
    }
    if (pathname === '/downloads/report.csv') {
      if (!isVerified(request)) {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('Verification required');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="report.csv"'
      });
      response.end('date,total\n2026-09-12,42\n');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const startUrl = `http://127.0.0.1:${address.port}/login`;
  return {
    server,
    startUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

/**
 * The browser bridge is intentionally simulated at the window-message
 * boundary. Installing a real extension would make this suite dependent on a
 * user browser; the app bridge message contract and real persistence API are
 * still exercised.
 */
async function installBridgeSimulation(page: Page, mode: 'success' | 'failure') {
  await page.addInitScript(
    ({ mode: recordingMode }) => {
      window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.source !== 'dear-robot-app') return;
        if (event.data.type === 'PING') {
          window.postMessage(
            { source: 'dear-robot-browser-bridge', type: 'READY', protocolVersion: 3 },
            '*'
          );
          return;
        }
        if (event.data.type === 'STOP_RECORDING') {
          window.postMessage(
            {
              source: 'dear-robot-browser-bridge',
              type: 'BRIDGE_EVENT',
              sessionId: event.data.sessionId,
              event: { type: 'STOPPED' }
            },
            '*'
          );
          return;
        }
        if (event.data.type !== 'START_RECORDING') return;
        const sessionId = event.data.sessionId;
        window.postMessage(
          {
            source: 'dear-robot-browser-bridge',
            type: 'BRIDGE_EVENT',
            sessionId,
            event: { type: 'STARTED' }
          },
          '*'
        );
        const actions = [
          {
            type: 'fill',
            selector: 'input[name="username"]',
            value: null,
            secret: true,
            secretRef: 'username'
          },
          {
            type: 'fill',
            selector: 'input[name="password"]',
            value: null,
            secret: true,
            secretRef: 'password'
          },
          { type: 'click', selector: 'button[name="login"]', optional: true },
          {
            type: 'fill',
            selector: 'input[name="otp"]',
            value: null,
            secret: true,
            secretRef: 'email_code'
          },
          { type: 'click', selector: 'button[name="verify"]', optional: true },
          { type: 'click', selector: 'a#report' },
          ...(recordingMode === 'failure'
            ? [{ type: 'download', timeoutMs: 500 }]
            : [
                { type: 'click', selector: 'a#download-report' },
                { type: 'download', timeoutMs: 5000 }
              ])
        ];
        window.setTimeout(() => {
          for (const action of actions) {
            window.postMessage(
              {
                source: 'dear-robot-browser-bridge',
                type: 'BRIDGE_EVENT',
                sessionId,
                event: { type: 'ACTION', action }
              },
              '*'
            );
          }
        }, 25);
      });
    },
    { mode }
  );
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function saveClientRecording(
  page: Page,
  mailbox: SeededMailbox,
  portal: Portal,
  mode: 'success' | 'failure'
) {
  await installBridgeSimulation(page, mode);
  await page.goto(`/?message=${mailbox.messageId}`);
  await expect(
    page.getByTestId('message-row').filter({ hasText: 'Weekly delivery report is ready' }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Automate this report' }).click();
  await expect(page.getByRole('heading', { name: 'Automate this email' })).toBeVisible();
  await page.getByLabel('Portal email or username').fill(testEmail);
  await page.getByLabel('Portal password').fill('portal-password');
  const startResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/messages/${mailbox.messageId}/browser-automation`) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Record in my browser' }).click();
  const started = await startResponse;
  expect(started.ok()).toBeTruthy();
  const bridge = (await started.json()).bridge as BridgeCapability;
  expect(bridge?.token).toBeTruthy();
  const verification = await page.request.post('/api/browser/bridge/verify', {
    headers: { origin: 'chrome-extension://bridge-test' },
    data: bridge
  });
  expect(verification.ok()).toBeTruthy();
  expect(verification.headers()['access-control-allow-origin']).toBe(
    'chrome-extension://bridge-test'
  );
  expect(await verification.json()).toMatchObject({
    valid: true,
    sessionId: bridge.sessionId,
    appOrigin: bridge.appOrigin
  });
  const untrustedOrigin = await page.request.post('/api/browser/bridge/verify', {
    headers: { origin: 'https://untrusted.example.test' },
    data: bridge
  });
  expect(untrustedOrigin.status()).toBe(403);
  await expect(page.getByText(/Finish the report in your browser/)).toBeVisible();
  await expect(page.getByText(/Captured \d+ steps?/)).toBeVisible();
  await page.getByRole('button', { name: /Done.*save automation/ }).click();
  await expect(page.getByText('Recording saved · server test needed')).toBeVisible();
}

async function latestAutomation(page: Page, messageId: number) {
  const response = await page.request.get(`/api/messages/${messageId}/browser-automation`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.automation?.recipe?.id).toBeTruthy();
  return body.automation.recipe as { id: number };
}

async function testOnServer(
  page: Page,
  messageId: number,
  recipeId: number,
  expectedStatus: 'completed' | 'failed'
) {
  const startResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/messages/${messageId}/browser-automation`) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /Test on server/i }).click();
  const response = await startResponse;
  expect(response.ok()).toBeTruthy();
  const runId = (await response.json()).run?.id as number;
  expect(runId).toBeTruthy();

  await expect
    .poll(
      async () => {
        const runResponse = await page.request.get(`/api/browser/runs/${runId}`);
        return (await runResponse.json()).run;
      },
      { timeout: 20000, intervals: [250, 500, 1000] }
    )
    .toMatchObject({ status: expectedStatus });
  return runId;
}

test.describe('browser automation workflow', () => {
  test('saves bridge-recorded MFA steps, tests on the server, and shows the downloaded report without uploading it', async ({
    page
  }) => {
    test.setTimeout(60000);
    const portal = await startPortal();
    const createdMessageIds: number[] = [];
    try {
      const mailbox = seedReportMailbox(portal.startUrl);
      createdMessageIds.push(mailbox.messageId);
      await signIn(page);
      await saveClientRecording(page, mailbox, portal, 'success');

      // The test run is a fresh session, so its email code must be fresh too.
      createdMessageIds.push(seedVerificationEmail(mailbox.accountId));
      const recipe = await latestAutomation(page, mailbox.messageId);
      const farinUploads: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/farin/upload')) farinUploads.push(request.url());
      });

      const runId = await testOnServer(page, mailbox.messageId, recipe.id, 'completed');
      const runResponse = await page.request.get(`/api/browser/runs/${runId}`);
      const run = (await runResponse.json()).run;
      expect(run).toMatchObject({ status: 'completed', downloadFilename: 'report.csv' });
      expect(run.downloadPath).toContain('report.csv');
      await expect(page.getByText('report.csv')).toBeVisible();
      const inspectLink = page.getByRole('link', { name: /Inspect downloaded report/i });
      await expect(inspectLink).toHaveAttribute('href', `/api/browser/runs/${runId}/download`);
      const downloadResponse = await page.request.get(`/api/browser/runs/${runId}/download`);
      expect(downloadResponse.ok()).toBeTruthy();
      expect(await downloadResponse.text()).toContain('2026-09-12,42');
      expect(farinUploads).toEqual([]);
    } finally {
      cleanupBrowserWorkflow(createdMessageIds);
      await portal.close();
    }
  });

  test('surfaces a failed server test instead of claiming success', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    const portal = await startPortal();
    const createdMessageIds: number[] = [];
    try {
      const mailbox = seedReportMailbox(portal.startUrl);
      createdMessageIds.push(mailbox.messageId);
      await signIn(page);
      await saveClientRecording(page, mailbox, portal, 'failure');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBeTruthy();
      await expect(page.getByRole('button', { name: /Test on server/i })).toBeVisible();
      createdMessageIds.push(seedVerificationEmail(mailbox.accountId));
      const recipe = await latestAutomation(page, mailbox.messageId);
      const farinUploads: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/farin/upload')) farinUploads.push(request.url());
      });

      const runId = await testOnServer(page, mailbox.messageId, recipe.id, 'failed');
      const runResponse = await page.request.get(`/api/browser/runs/${runId}`);
      const run = (await runResponse.json()).run;
      expect(run.status).toBe('failed');
      expect(run.errorMessage).toBeTruthy();
      await expect(page.getByRole('alert')).toContainText(
        /failed|error|could not|locator|timed out/i
      );
      await expect(page.getByText('Recording saved · server test needed')).toBeVisible();
      expect(farinUploads).toEqual([]);
    } finally {
      cleanupBrowserWorkflow(createdMessageIds);
      await portal.close();
    }
  });
});
