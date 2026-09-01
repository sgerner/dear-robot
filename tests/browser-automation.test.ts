import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  process.env.DATA_DIR = '/tmp/dear-robot-vitest';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.AI_PROVIDER = 'mock';
  process.env.AI_API_KEY = '';
  const { resetForTests } = await import('../src/lib/server/db/bootstrap');
  resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser automation recipes', () => {
  it('extracts safe report links without following email content', async () => {
    const { extractBrowserLinks, browserReportWorkflowPlan } = await import('../src/lib/server/browser');
    expect(
      extractBrowserLinks(
        'Download https://reports.example.test/latest.csv.',
        '<a href="https://dashboard.example.test/reports?period=latest&amp;format=csv">View report</a>'
      )
    ).toEqual([
      'https://dashboard.example.test/reports?period=latest&format=csv',
      'https://reports.example.test/latest.csv'
    ]);
    expect(extractBrowserLinks('mailto:reports@example.test', null)).toEqual([]);
    expect(browserReportWorkflowPlan({ id: 42, name: 'Weekly report' }).steps).toHaveLength(2);
  });

  it('stores an isolated profile and rejects navigation outside its allowlist', async () => {
    const { createBrowserProfile, createBrowserRecipe, getBrowserRecipeForMessage } = await import('../src/lib/server/browser');
    const { listMessages } = await import('../src/lib/server/services/messages');
    const sourceMessageId = listMessages({ limit: 1 })[0].id;
    const profile = createBrowserProfile({
      name: 'DoorDash',
      startUrl: 'https://merchant.doordash.com/reports',
      allowedHosts: ['identity.doordash.com']
    });
    expect(profile.allowedHosts).toEqual(
      expect.arrayContaining(['merchant.doordash.com', 'identity.doordash.com'])
    );
    expect(() =>
      createBrowserRecipe({
        profileId: profile.id,
        name: 'Unsafe recipe',
        startUrl: 'https://evil.example.test',
        actions: []
      })
    ).toThrow(/allowlist/i);
    const linked = createBrowserRecipe({
      profileId: profile.id,
      sourceMessageId,
      name: 'Linked report',
      startUrl: 'https://merchant.doordash.com/reports',
      actions: []
    });
    expect(linked.sourceMessageId).toBe(sourceMessageId);
    expect(getBrowserRecipeForMessage(sourceMessageId)?.id).toBe(linked.id);
  });

  it('requires review for browser collection and Farin upload steps', async () => {
    const { createBrowserProfile, createBrowserRecipe } = await import('../src/lib/server/browser');
    const { listMessages } = await import('../src/lib/server/services/messages');
    const { createTaskRunFromPlan } = await import('../src/lib/server/agent/tasks');
    const profile = createBrowserProfile({ name: 'Uber Eats', startUrl: 'https://merchant.uber.com' });
    const recipe = createBrowserRecipe({
      profileId: profile.id,
      name: 'Weekly report',
      startUrl: 'https://merchant.uber.com/reports',
      actions: [{ type: 'goto', url: 'https://merchant.uber.com/reports' }]
    });
    const task = createTaskRunFromPlan(listMessages({ limit: 1 })[0].id, {
      summary: 'Download and submit report',
      complexity: 'advanced',
      requires_user_approval: false,
      final_reply_draft: null,
      max_turns: 8,
      steps: [
        {
          title: 'Download report',
          kind: 'browser_recipe',
          details: 'Replay the report recipe.',
          tool_name: `browser_recipe:${recipe.id}`,
          tool_input: {},
          depends_on: [],
          condition: null,
          output_key: 'report',
          max_attempts: 1,
          retry_delay_ms: 100,
          approval_reason: null,
          requires_approval: false,
          risk_level: 'low'
        },
        {
          title: 'Upload to Farin',
          kind: 'farin_upload',
          details: 'Submit the report.',
          tool_name: null,
          tool_input: { file_path: '{{outputs.report.downloadPath}}' },
          depends_on: [1],
          condition: null,
          output_key: null,
          max_attempts: 1,
          retry_delay_ms: 100,
          approval_reason: null,
          requires_approval: false,
          risk_level: 'low'
        }
      ]
    });
    expect(task?.run.status).toBe('needs_approval');
    expect(task?.steps.map((step) => step.requiresApproval)).toEqual([true, true]);
  });

  it('uploads only browser-downloaded files as multipart data', async () => {
    const { saveFarinSettings, uploadFarinFile } = await import('../src/lib/server/farin');
    const downloads = path.join(process.env.DATA_DIR!, 'browser', 'downloads', 'test-run');
    await fs.mkdir(downloads, { recursive: true });
    const filePath = path.join(downloads, 'doordash.csv');
    await fs.writeFile(filePath, 'date,total\n2026-08-30,12.34\n', 'utf8');
    saveFarinSettings({ host: 'https://farin.example.test', companyId: 'company-1', apiKey: 'wz_test' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer wz_test');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('file')).toBeInstanceOf(File);
      return Response.json({ document: { id: 'doc-1' } }, { status: 201 });
    });
    const result = await uploadFarinFile({ filePath });
    expect(result).toMatchObject({ uploaded: true, filename: 'doordash.csv', companyId: 'company-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(uploadFarinFile({ filePath: '/tmp/not-a-browser-download.csv' })).rejects.toThrow(
      /only use files downloaded/i
    );
  });

  it('replays a safe recipe and captures a report download', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/report.csv') {
        response.writeHead(200, {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="report.csv"'
        });
        response.end('date,total\n2026-08-30,42.00\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><a id="download" href="/report.csv">Download latest report</a>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const url = `http://127.0.0.1:${address.port}/`;
    try {
      const { createBrowserProfile, createBrowserRecipe, runBrowserRecipe } = await import('../src/lib/server/browser');
      const profile = createBrowserProfile({ name: 'Local test', startUrl: url });
      const recipe = createBrowserRecipe({
        profileId: profile.id,
        name: 'Download local report',
        startUrl: url,
        actions: [
          { type: 'goto', url },
          { type: 'click', selector: '#download' },
          { type: 'download', timeoutMs: 5000 }
        ]
      });
      const run = await runBrowserRecipe(recipe.id, { headless: true });
      expect(run?.status).toBe('completed');
      expect(run?.downloadFilename).toBe('report.csv');
      expect(await fs.readFile(run!.downloadPath!, 'utf8')).toContain('42.00');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('replays encrypted profile credentials without storing their values in the recipe', async () => {
    const server = createServer(async (request, response) => {
      if (request.url === '/login' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        if (form.get('username') !== 'reports@example.test' || form.get('password') !== 'secret-value') {
          response.writeHead(401);
          response.end('invalid credentials');
          return;
        }
        response.writeHead(302, { location: '/dashboard', 'set-cookie': 'session=valid; Path=/' });
        response.end();
        return;
      }
      if (request.url === '/dashboard' && request.headers.cookie?.includes('session=valid')) {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><a id="download" href="/report.csv">Download report</a>');
        return;
      }
      if (request.url === '/report.csv' && request.headers.cookie?.includes('session=valid')) {
        response.writeHead(200, {
          'content-type': 'text/csv',
          'content-disposition': 'attachment; filename="report.csv"'
        });
        response.end('date,total\n2026-08-30,99.00\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><form method="post" action="/login"><input id="username" name="username" autocomplete="username"><input id="password" name="password" type="password"><button id="submit" type="submit">Sign in</button></form>'
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const url = `http://127.0.0.1:${address.port}/login`;
    try {
      const { createBrowserProfile, createBrowserRecipe, runBrowserRecipe } = await import('../src/lib/server/browser');
      const profile = createBrowserProfile({
        name: 'Credential test',
        startUrl: url,
        username: 'reports@example.test',
        password: 'secret-value'
      });
      expect(profile).toMatchObject({ hasUsername: true, hasPassword: true });
      expect(profile).not.toHaveProperty('passwordEncrypted');
      const recipe = createBrowserRecipe({
        profileId: profile.id,
        name: 'Login and download',
        startUrl: url,
        actions: [
          { type: 'fill', selector: '#username', secretRef: 'username' },
          { type: 'fill', selector: '#password', secretRef: 'password' },
          { type: 'click', selector: '#submit' },
          { type: 'click', selector: '#download' },
          { type: 'download', timeoutMs: 5000 }
        ]
      });
      expect(JSON.stringify(recipe.actions)).not.toContain('secret-value');
      expect(recipe.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'fill', selector: '#username', secretRef: 'username', value: null }),
          expect.objectContaining({ type: 'fill', selector: '#password', secretRef: 'password', value: null })
        ])
      );
      const run = await runBrowserRecipe(recipe.id, { headless: true });
      expect(run?.status).toBe('completed');
      expect(run?.downloadFilename).toBe('report.csv');
      expect(await fs.readFile(run!.downloadPath!, 'utf8')).toContain('99.00');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('finalizes a browser-bridge recording without launching a server desktop window', async () => {
    const { listMessages } = await import('../src/lib/server/services/messages');
    const message = listMessages({ limit: 1 })[0];
    const {
      finishClientBrowserRecording,
      getBrowserRecipe,
      startEmailBrowserAutomationClient
    } = await import('../src/lib/server/browser');
    const started = startEmailBrowserAutomationClient(message.id, {
      startUrl: 'https://reports.example.test/dashboard',
      name: 'Client bridge report',
      username: 'reports@example.test',
      password: 'server-secret'
    });
    expect(started.run).toMatchObject({ status: 'recording', triggerType: 'client_recording' });
    const finished = finishClientBrowserRecording({
      runId: started.run!.id,
      downloadFilename: 'latest-report.csv',
      actions: [
        { type: 'goto', url: 'https://reports.example.test/dashboard' },
        { type: 'click', selector: '#download' },
        { type: 'download' }
      ]
    });
    expect(finished.run).toMatchObject({ status: 'completed', downloadFilename: 'latest-report.csv' });
    expect(finished.recipe?.actions).toEqual(
      expect.arrayContaining([
        { type: 'goto', url: 'https://reports.example.test/dashboard' },
        { type: 'click', selector: '#download' },
        { type: 'download' }
      ])
    );
    expect(getBrowserRecipe(started.recipe!.id)?.actions).toHaveLength(3);
  });
});
