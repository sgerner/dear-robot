/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const extensionDir = path.resolve('static/browser-bridge/extension');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function backgroundHarness(
  recordings: unknown[] = [],
  apiMode: 'callback' | 'promise' = 'callback',
  capabilityValid = true,
  configuredAppOrigin = 'https://dear-robot.example.test'
) {
  const events: Record<string, (...args: any[]) => void> = {};
  const sent: any[] = [];
  const writes: any[] = [];
  const created: any[] = [];
  const verificationRequests: any[] = [];
  const fetch = async (_url: string, init: { body?: string } = {}) => {
    const body = JSON.parse(init.body || '{}');
    verificationRequests.push(body);
    return {
      ok: capabilityValid,
      json: async () => ({
        valid: capabilityValid,
        sessionId: body.sessionId,
        appOrigin: body.appOrigin
      })
    };
  };
  const listener = (name: string) => ({
    addListener: (fn: (...args: any[]) => void) => {
      events[name] = fn;
    }
  });
  const storage = {
    get:
      apiMode === 'promise'
        ? async () => ({ recordings })
        : (_key: string, callback: (value: unknown) => void) => callback({ recordings }),
    set:
      apiMode === 'promise'
        ? async (value: unknown) => {
            writes.push(value);
          }
        : (value: unknown, callback?: () => void) => {
            writes.push(value);
            callback?.();
          }
  };
  const tabs = {
    onRemoved: listener('removed'),
    onUpdated: listener('updated'),
    query:
      apiMode === 'promise'
        ? async () => [{ id: 2, url: 'https://reports.example.test/dashboard' }]
        : (_query: unknown, callback: (tabs: unknown[]) => void) =>
            callback([{ id: 2, url: 'https://reports.example.test/dashboard' }]),
    create:
      apiMode === 'promise'
        ? async (details: unknown) => {
            created.push(details);
            return { id: 2, ...(details as object) };
          }
        : (details: unknown, callback: (tab: unknown) => void) => {
            created.push(details);
            callback({ id: 2, url: 'https://reports.example.test/dashboard' });
          },
    sendMessage: (id: number, data: unknown, callback?: () => void) => {
      sent.push({ id, data });
      callback?.();
    }
  };
  const localStorage = {
    get: async () => ({ appOrigin: configuredAppOrigin })
  };
  const chrome = {
    storage: { session: storage, local: localStorage },
    runtime: { onMessage: listener('message'), lastError: null },
    tabs,
    downloads: { onCreated: listener('download'), onChanged: listener('changed') }
  };
  return { chrome, events, sent, writes, created, verificationRequests, fetch };
}

describe('Dear Robot browser bridge bundle', () => {
  it('restores a suspended recording and associates Chrome downloads without a tabId', async () => {
    const events: Record<string, (...args: any[]) => void> = {};
    const sent: any[] = [];
    const listener = (name: string) => ({
      addListener: (fn: (...args: any[]) => void) => {
        events[name] = fn;
      }
    });
    const chrome = {
      storage: {
        session: {
          get: async () => ({
            recordings: [
              {
                sessionId: 'session',
                appTabId: 1,
                targetTabId: 2,
                appOrigin: 'https://dear-robot.example.test',
                startedAt: Date.now(),
                stopped: false
              }
            ]
          }),
          set: async () => undefined
        }
      },
      runtime: { onMessage: listener('message'), lastError: null },
      tabs: {
        onRemoved: listener('removed'),
        query: (_: unknown, callback: (tabs: unknown[]) => void) =>
          callback([{ id: 2, url: 'https://reports.example.test/' }]),
        sendMessage: (id: number, data: unknown, callback: () => void) => {
          sent.push({ id, data });
          callback();
        }
      },
      downloads: { onCreated: listener('download') }
    };
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'background.js'), 'utf8'), {
      chrome,
      setTimeout,
      URL
    });
    events.download({ referrer: 'https://reports.example.test/', filename: 'payout.csv' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toContainEqual({
      id: 1,
      data: {
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://dear-robot.example.test',
        sessionId: 'session',
        event: { type: 'ACTION', action: { type: 'download' }, downloadFilename: 'payout.csv' }
      }
    });
    sent.length = 0;
    events.download({ referrer: 'https://unrelated.example.test/', filename: 'private.csv' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(0);
  });
  it('ships Chrome and Firefox manifests with the required bridge permissions', async () => {
    const chromeManifest = JSON.parse(
      await fs.readFile(path.join(extensionDir, 'manifest.json'), 'utf8')
    );
    const firefoxManifest = JSON.parse(
      await fs.readFile(path.join(extensionDir, 'manifest.firefox.json'), 'utf8')
    );

    for (const manifest of [chromeManifest, firefoxManifest]) {
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs', 'downloads']));
      expect(manifest.content_scripts[0].matches).toContain('<all_urls>');
      expect(manifest.content_scripts[0].js).toContain('content.js');
      expect(manifest.options_ui.page).toBe('options.html');
    }
    expect(chromeManifest.background.service_worker).toBe('background.js');
    expect(firefoxManifest.background.scripts).toContain('background.js');
  });

  it('records credential fields as references instead of values', async () => {
    const content = await fs.readFile(path.join(extensionDir, 'content.js'), 'utf8');
    expect(content).toContain("return 'password'");
    expect(content).toContain("return 'username'");
    expect(content).toContain('value: secretRef ? null : target.value.slice(0, 4000)');
  });

  it('waits for the content ENDED handshake and rejects stale or unsafe actions', async () => {
    const { chrome, events, sent } = backgroundHarness([
      {
        sessionId: 'session',
        appTabId: 1,
        targetTabId: 2,
        appOrigin: 'https://dear-robot.example.test',
        startedAt: Date.now(),
        stopped: false
      }
    ]);
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'background.js'), 'utf8'), {
      chrome,
      setTimeout,
      clearTimeout,
      URL
    });
    events.message(
      { type: 'STOP_RECORDING', sessionId: 'session' },
      { tab: { id: 1 }, url: 'https://dear-robot.example.test/inbox' }
    );
    await flush();
    expect(sent).toContainEqual({ id: 2, data: { type: 'END_RECORDING', sessionId: 'session' } });
    expect(sent.some((entry) => entry.data?.event?.type === 'STOPPED')).toBe(false);

    events.message(
      {
        type: 'ACTION',
        sessionId: 'wrong-session',
        action: { type: 'fill', selector: '#password', value: 'typed-secret' }
      },
      { tab: { id: 2 } }
    );
    events.message(
      {
        type: 'ACTION',
        sessionId: 'session',
        action: {
          type: 'fill',
          selector: '#password',
          value: 'typed-secret',
          secret: true,
          secretRef: 'password'
        }
      },
      { tab: { id: 2 } }
    );
    await flush();
    expect(sent.some((entry) => entry.data?.event?.action?.value === 'typed-secret')).toBe(false);
    expect(sent).toContainEqual({
      id: 1,
      data: {
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://dear-robot.example.test',
        sessionId: 'session',
        event: {
          type: 'ACTION',
          action: {
            type: 'fill',
            selector: '#password',
            value: null,
            secret: true,
            secretRef: 'password'
          }
        }
      }
    });

    events.message({ type: 'ENDED', sessionId: 'session' }, { tab: { id: 2 } });
    await flush();
    expect(sent.filter((entry) => entry.data?.event?.type === 'STOPPED')).toHaveLength(1);
    events.message({ type: 'ENDED', sessionId: 'session' }, { tab: { id: 2 } });
    await flush();
    expect(sent.filter((entry) => entry.data?.event?.type === 'STOPPED')).toHaveLength(1);
  });

  it('supports Promise-style APIs and resumes after navigation without recording goto URLs', async () => {
    const { chrome, events, sent, writes, verificationRequests, fetch } = backgroundHarness(
      [],
      'promise'
    );
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'background.js'), 'utf8'), {
      chrome,
      setTimeout,
      clearTimeout,
      URL,
      fetch,
      AbortController
    });
    events.message(
      {
        type: 'START_RECORDING',
        sessionId: 'promise-session',
        startUrl: 'https://reports.example.test/dashboard?token=should-not-persist',
        appOrigin: 'https://dear-robot.example.test',
        bridgeToken: 'signed-capability-token-for-the-test'
      },
      { tab: { id: 1 }, url: 'https://dear-robot.example.test/inbox' }
    );
    await flush();
    await flush();
    expect(sent).toContainEqual({
      id: 1,
      data: {
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://dear-robot.example.test',
        sessionId: 'promise-session',
        event: { type: 'STARTED', targetTabId: 2 }
      }
    });
    expect(sent).toContainEqual({
      id: 2,
      data: { type: 'BEGIN_RECORDING', sessionId: 'promise-session' }
    });
    expect(JSON.stringify(writes)).not.toContain('should-not-persist');
    expect(verificationRequests).toEqual([
      {
        token: 'signed-capability-token-for-the-test',
        sessionId: 'promise-session',
        appOrigin: 'https://dear-robot.example.test'
      }
    ]);

    events.message(
      { type: 'CONTENT_READY', url: 'https://reports.example.test/reports/latest' },
      { tab: { id: 2 } }
    );
    events.message(
      {
        type: 'ACTION',
        sessionId: 'promise-session',
        action: { type: 'goto', url: 'https://oauth.example.test/callback?code=one-time' }
      },
      { tab: { id: 2 } }
    );
    events.message(
      {
        type: 'ACTION',
        sessionId: 'promise-session',
        action: { type: 'check', selector: '#include-tax', checked: true }
      },
      { tab: { id: 2 } }
    );
    await flush();
    expect(sent.some((entry) => entry.data?.event?.action?.type === 'goto')).toBe(false);
    expect(sent).toContainEqual({
      id: 1,
      data: {
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://dear-robot.example.test',
        sessionId: 'promise-session',
        event: {
          type: 'ACTION',
          action: { type: 'check', selector: '#include-tax', checked: true }
        }
      }
    });
  });

  it('refuses a recording request that the app server does not verify', async () => {
    const { chrome, events, sent, fetch } = backgroundHarness([], 'callback', false);
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'background.js'), 'utf8'), {
      chrome,
      setTimeout,
      clearTimeout,
      URL,
      fetch,
      AbortController
    });
    events.message(
      {
        type: 'START_RECORDING',
        sessionId: 'unverified-session-001',
        startUrl: 'https://reports.example.test/dashboard',
        appOrigin: 'https://dear-robot.example.test',
        bridgeToken: 'invalid-capability-token-for-the-test'
      },
      { tab: { id: 1 }, url: 'https://dear-robot.example.test/inbox' }
    );
    await flush();
    await flush();
    expect(sent).toContainEqual({
      id: 1,
      data: {
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://dear-robot.example.test',
        sessionId: 'unverified-session-001',
        event: { type: 'ERROR', message: expect.stringMatching(/could not verify/i) }
      }
    });
    expect(sent.some((entry) => entry.data?.event?.type === 'STARTED')).toBe(false);
  });

  it('ignores bridge probes, starts, and stops from outside the configured app origin', async () => {
    const { chrome, events, sent, created, verificationRequests } = backgroundHarness([
      {
        sessionId: 'active-session-001',
        appTabId: 1,
        targetTabId: 2,
        appOrigin: 'https://dear-robot.example.test',
        startedAt: Date.now(),
        stopped: false
      }
    ]);
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'background.js'), 'utf8'), {
      chrome,
      setTimeout,
      clearTimeout,
      URL
    });

    const unrelatedPage = { tab: { id: 1 }, url: 'https://attacker.example.test/page' };
    events.message({ type: 'PING' }, unrelatedPage);
    events.message(
      {
        type: 'START_RECORDING',
        sessionId: 'attacker-session-001',
        startUrl: 'https://reports.example.test/dashboard',
        appOrigin: 'https://attacker.example.test',
        bridgeToken: 'attacker-controlled-token-value'
      },
      unrelatedPage
    );
    events.message(
      {
        type: 'START_RECORDING',
        sessionId: 'redirected-session-001',
        startUrl: 'https://reports.example.test/dashboard',
        appOrigin: 'https://attacker.example.test',
        bridgeToken: 'attacker-controlled-token-value'
      },
      { tab: { id: 1 }, url: 'https://dear-robot.example.test/inbox' }
    );
    events.message({ type: 'STOP_RECORDING', sessionId: 'active-session-001' }, unrelatedPage);
    await flush();
    await flush();

    expect(sent).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(verificationRequests).toHaveLength(0);

    events.message(
      { type: 'PING' },
      { tab: { id: 1 }, url: 'https://dear-robot.example.test/inbox' }
    );
    await flush();
    expect(sent).toContainEqual({
      id: 1,
      data: { type: 'BRIDGE_READY', appOrigin: 'https://dear-robot.example.test' }
    });
  });

  it('records fills, OTP references, checks, selects, clicks and Enter with no file or hidden values', async () => {
    class FakeEventTarget {
      handlers: Record<string, Array<(event: any) => void>> = {};
      addEventListener(type: string, handler: (event: any) => void) {
        (this.handlers[type] ||= []).push(handler);
      }
      removeEventListener(type: string, handler: (event: any) => void) {
        this.handlers[type] = (this.handlers[type] || []).filter((entry) => entry !== handler);
      }
      emit(type: string, event: any = {}) {
        for (const handler of this.handlers[type] || []) handler(event);
      }
    }
    class FakeElement extends FakeEventTarget {
      nodeType = 1;
      tagName: string;
      id = '';
      textContent = '';
      parentElement: FakeElement | null = null;
      children: FakeElement[] = [];
      attributes: Record<string, string> = {};
      constructor(tagName: string) {
        super();
        this.tagName = tagName.toUpperCase();
      }
      append(child: FakeElement) {
        child.parentElement = this;
        this.children.push(child);
      }
      getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
      }
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      }
      matches(selector: string) {
        const options = selector.split(',').map((value) => value.trim());
        return options.some((option) => {
          if (option === 'form') return this.tagName === 'FORM';
          if (option === 'button' || option === 'a') return this.tagName === option.toUpperCase();
          if (option === '[role="button"]') return this.attributes.role === 'button';
          if (option === 'input[type="submit"]')
            return this.tagName === 'INPUT' && this.attributes.type === 'submit';
          const match = option.match(/^input\[([^=]+)="([^"]+)"\]$/);
          if (match) return this.tagName === 'INPUT' && this.getAttribute(match[1]) === match[2];
          return option === this.tagName.toLowerCase();
        });
      }
      closest(selector: string) {
        let current: FakeElement | null = this;
        while (current) {
          if (current.matches(selector)) return current;
          current = current.parentElement;
        }
        return null;
      }
      querySelector(selector: string): FakeElement | null {
        for (const child of this.children) {
          if (child.matches(selector)) return child;
          const descendant = child.querySelector(selector);
          if (descendant) return descendant;
        }
        return null;
      }
    }
    class FakeInput extends FakeElement {
      value = '';
      type = 'text';
      name = '';
      autocomplete = '';
      checked = false;
      constructor() {
        super('input');
      }
      getAttribute(name: string) {
        if (name === 'type') return this.type;
        if (name === 'name') return this.name || null;
        if (name === 'autocomplete') return this.autocomplete || null;
        if (name === 'id') return this.id || null;
        return super.getAttribute(name);
      }
    }
    class FakeTextArea extends FakeElement {
      value = '';
      name = '';
      autocomplete = '';
      constructor() {
        super('textarea');
      }
    }
    class FakeSelect extends FakeElement {
      value = '';
      name = '';
      constructor() {
        super('select');
      }
      getAttribute(name: string) {
        if (name === 'name') return this.name || null;
        return super.getAttribute(name);
      }
    }
    class FakeDocument extends FakeEventTarget {}
    class FakeWindow extends FakeEventTarget {
      location = { origin: 'https://report.test', href: 'https://report.test/login' };
      posts: any[] = [];
      postMessage(message: unknown, targetOrigin: string) {
        this.posts.push({ message, targetOrigin });
      }
    }

    const document = new FakeDocument();
    const window = new FakeWindow();
    const runtimeMessages: any[] = [];
    const runtimeListeners: Array<(message: any) => void> = [];
    const chrome = {
      runtime: {
        sendMessage: (message: unknown) => {
          runtimeMessages.push(message);
        },
        onMessage: {
          addListener: (handler: (message: any) => void) => runtimeListeners.push(handler)
        }
      }
    };
    vm.runInNewContext(await fs.readFile(path.join(extensionDir, 'content.js'), 'utf8'), {
      chrome,
      window,
      document,
      location: window.location,
      Element: FakeElement,
      HTMLInputElement: FakeInput,
      HTMLTextAreaElement: FakeTextArea,
      HTMLSelectElement: FakeSelect,
      CSS: { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
      URL,
      globalThis: { CSS: { escape: (value: string) => value } }
    });
    expect(runtimeMessages[0]).toMatchObject({ type: 'CONTENT_READY', sessionId: null });
    runtimeListeners[0]({ type: 'BEGIN_RECORDING', sessionId: 'content-session' });

    window.emit('message', {
      source: window,
      origin: 'https://evil.test',
      data: { source: 'dear-robot-app', type: 'PING' }
    });
    expect(window.posts).toHaveLength(0);
    window.emit('message', {
      source: window,
      origin: 'https://report.test',
      data: {
        source: 'dear-robot-app',
        type: 'START_RECORDING',
        sessionId: 'spoofed-session',
        startUrl: 'https://reports.example.test/dashboard',
        bridgeToken: 'attacker-controlled-token-value'
      }
    });
    expect(runtimeMessages.some((message) => message.type === 'START_RECORDING')).toBe(false);
    window.emit('message', {
      source: window,
      origin: 'https://report.test',
      data: { source: 'dear-robot-app', type: 'PING' }
    });
    expect(runtimeMessages.at(-1)).toEqual({ type: 'PING' });
    expect(window.posts).toHaveLength(0);

    runtimeListeners[0]({ type: 'BRIDGE_READY', appOrigin: 'https://evil.test' });
    expect(window.posts).toHaveLength(0);
    runtimeListeners[0]({ type: 'BRIDGE_READY', appOrigin: 'https://report.test' });
    expect(window.posts.at(-1)).toEqual({
      message: {
        source: 'dear-robot-browser-bridge',
        type: 'READY',
        appOrigin: 'https://report.test',
        protocolVersion: 4,
        capabilities: ['email_code', 'download', 'persistent_sessions']
      },
      targetOrigin: 'https://report.test'
    });
    runtimeListeners[0]({
      type: 'BRIDGE_EVENT',
      appOrigin: 'https://evil.test',
      sessionId: 'content-session',
      event: { type: 'ACTION', action: { type: 'click', selector: '#secret' } }
    });
    expect(window.posts).toHaveLength(1);
    runtimeListeners[0]({
      type: 'BRIDGE_EVENT',
      appOrigin: 'https://report.test',
      sessionId: 'content-session',
      event: { type: 'ACTION', action: { type: 'click', selector: '#button' } }
    });
    expect(window.posts[1]).toEqual({
      message: {
        source: 'dear-robot-browser-bridge',
        type: 'BRIDGE_EVENT',
        appOrigin: 'https://report.test',
        sessionId: 'content-session',
        event: { type: 'ACTION', action: { type: 'click', selector: '#button' } }
      },
      targetOrigin: 'https://report.test'
    });
    window.emit('message', {
      source: window,
      origin: 'https://report.test',
      data: {
        source: 'dear-robot-app',
        type: 'START_RECORDING',
        sessionId: 'new-session',
        startUrl: 'javascript:alert(1)'
      }
    });
    expect(runtimeMessages.some((message) => message.type === 'START_RECORDING')).toBe(false);

    const form = new FakeElement('form');
    const username = new FakeInput();
    username.name = 'email';
    username.value = 'alice@example.test';
    const password = new FakeInput();
    password.id = 'password';
    password.type = 'password';
    password.value = 'do-not-export';
    const otp = new FakeInput();
    otp.name = 'otp';
    otp.autocomplete = 'one-time-code';
    otp.value = '123456';
    const hidden = new FakeInput();
    hidden.type = 'hidden';
    hidden.name = 'csrf';
    hidden.value = 'csrf-token';
    const checkbox = new FakeInput();
    checkbox.id = 'include-tax';
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    const select = new FakeSelect();
    select.name = 'period';
    select.value = 'latest';
    const button = new FakeElement('button');
    button.id = 'submit';
    button.textContent = 'Sign in';
    for (const child of [username, password, otp, hidden, checkbox, select, button])
      form.append(child);

    document.emit('change', { target: username });
    document.emit('blur', { target: username });
    document.emit('blur', { target: password });
    document.emit('blur', { target: otp });
    document.emit('blur', { target: hidden });
    document.emit('change', { target: checkbox });
    document.emit('change', { target: select });
    document.emit('click', { target: button });
    document.emit('keydown', { target: username, key: 'Enter' });

    const actions = runtimeMessages
      .filter((message) => message.type === 'ACTION')
      .map((message) => message.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        {
          type: 'fill',
          selector: 'input[name="email"]',
          value: null,
          secret: true,
          secretRef: 'username'
        },
        { type: 'fill', selector: '#password', value: null, secret: true, secretRef: 'password' },
        {
          type: 'fill',
          selector: 'input[name="otp"]',
          value: null,
          secret: true,
          secretRef: 'email_code'
        },
        { type: 'check', selector: '#include-tax', checked: true },
        { type: 'select', selector: 'select[name="period"]', value: 'latest' },
        { type: 'click', selector: '#submit', optional: true },
        { type: 'press', selector: 'input[name="email"]', key: 'Enter', optional: true }
      ])
    );
    expect(JSON.stringify(actions)).not.toContain('do-not-export');
    expect(JSON.stringify(actions)).not.toContain('csrf-token');
    expect(
      actions.filter(
        (action) => action.type === 'fill' && action.selector === 'input[name="email"]'
      )
    ).toHaveLength(1);

    runtimeListeners[0]({ type: 'END_RECORDING', sessionId: 'content-session' });
    expect(runtimeMessages.at(-1)).toEqual({ type: 'ENDED', sessionId: 'content-session' });
  });
});
