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
  it('stores an isolated profile and rejects navigation outside its allowlist', async () => {
    const { createBrowserProfile, createBrowserRecipe } = await import('../src/lib/server/browser');
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
});
