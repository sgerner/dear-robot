import { test, expect, chromium, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type FixtureServer = {
  server: Server;
  origin: string;
  close: () => Promise<void>;
};

async function readJson(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body || '{}') as Record<string, unknown>;
}

function html(response: ServerResponse, content: string) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(content);
}

function bridgeEvents(page: Page) {
  return page.evaluate(() => {
    const bridgeWindow = window as Window & { bridgeEvents?: Array<Record<string, unknown>> };
    return bridgeWindow.bridgeEvents || [];
  });
}

async function startFixture(): Promise<FixtureServer> {
  let origin = '';
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (pathname === '/api/browser/bridge/verify') {
      const extensionOrigin = request.headers.origin || '';
      response.setHeader('access-control-allow-origin', extensionOrigin);
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      const body = await readJson(request);
      const valid =
        request.method === 'POST' &&
        body.token === 'runtime-bridge-capability-token' &&
        body.sessionId === 'extension-runtime-session-001' &&
        body.appOrigin === origin;
      response.writeHead(valid ? 200 : 403, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      });
      response.end(
        JSON.stringify(
          valid ? { valid, sessionId: body.sessionId, appOrigin: body.appOrigin } : { valid: false }
        )
      );
      return;
    }
    if (pathname === '/app') {
      html(
        response,
        `<!doctype html><title>Bridge test app</title><button id="start">Start</button><button id="stop">Stop</button>
        <script>
          window.bridgeEvents = [];
          window.addEventListener('message', (event) => {
            if (event.source === window && event.data && event.data.source === 'dear-robot-browser-bridge') {
              window.bridgeEvents.push(event.data);
            }
          });
          document.querySelector('#start').onclick = () => window.postMessage({
            source: 'dear-robot-app', type: 'START_RECORDING',
            sessionId: 'extension-runtime-session-001', startUrl: '${origin}/portal',
            bridgeToken: 'runtime-bridge-capability-token'
          }, window.location.origin);
          document.querySelector('#stop').onclick = () => window.postMessage({
            source: 'dear-robot-app', type: 'STOP_RECORDING', sessionId: 'extension-runtime-session-001'
          }, window.location.origin);
          window.postMessage({ source: 'dear-robot-app', type: 'PING' }, window.location.origin);
        </script>`
      );
      return;
    }
    if (pathname === '/portal') {
      html(
        response,
        '<!doctype html><title>Portal</title><button id="open-report">Open latest report</button><a id="download" href="/report.csv" download>Download CSV</a>'
      );
      return;
    }
    if (pathname === '/report.csv') {
      response.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="payout.csv"',
        'cache-control': 'no-store'
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
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test('loads the packaged bridge in Chromium and records an authenticated local download', async () => {
  test.setTimeout(60000);
  const fixture = await startFixture();
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dear-robot-browser-bridge-'));
  const extensionDir = path.resolve('static/browser-bridge/extension');
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    await expect
      .poll(() => context!.serviceWorkers().map((worker) => worker.url()))
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^chrome-extension:\/\/[^/]+\/background\.js$/)
        ])
      );
    const extensionWorker = context
      .serviceWorkers()
      .find((worker) => worker.url().endsWith('/background.js'));
    expect(extensionWorker).toBeTruthy();
    const extensionId = new URL(extensionWorker!.url()).host;
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html`);
    await settings.locator('#app-origin').fill('http://attacker.example.test');
    await settings.getByRole('button', { name: 'Save origin' }).click();
    await expect(settings.locator('#status')).toContainText('Use HTTPS');
    await settings.locator('#app-origin').fill(fixture.origin);
    await settings.getByRole('button', { name: 'Save origin' }).click();
    await expect(settings.locator('#status')).toContainText('Origin saved');
    await settings.close();

    const app = await context.newPage();
    await app.goto(`${fixture.origin}/app`);
    await expect
      .poll(async () => (await bridgeEvents(app)).map((event) => event.type))
      .toContain('READY');
    await app.locator('#start').click();
    await expect
      .poll(() => bridgeEvents(app))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRIDGE_EVENT',
            sessionId: 'extension-runtime-session-001',
            event: expect.objectContaining({ type: 'STARTED' })
          })
        ])
      );

    await expect
      .poll(() =>
        context!.pages().some((candidate) => candidate.url() === `${fixture.origin}/portal`)
      )
      .toBe(true);
    const portalPage = context
      .pages()
      .find((candidate) => candidate.url() === `${fixture.origin}/portal`)!;
    await portalPage.locator('#open-report').click();
    await expect
      .poll(() => bridgeEvents(app))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRIDGE_EVENT',
            event: expect.objectContaining({
              type: 'ACTION',
              action: { type: 'click', selector: '#open-report' }
            })
          })
        ])
      );
    await portalPage.locator('#download').click();
    await expect
      .poll(() => bridgeEvents(app))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRIDGE_EVENT',
            event: expect.objectContaining({
              type: 'ACTION',
              action: { type: 'download' },
              downloadFilename: expect.stringMatching(/\.csv$/)
            })
          })
        ])
      );
    await app.locator('#stop').click();
    await expect
      .poll(() => bridgeEvents(app))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'BRIDGE_EVENT', event: { type: 'STOPPED' } })
        ])
      );
  } finally {
    await context?.close();
    await fixture.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  }
});
