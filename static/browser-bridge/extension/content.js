/* global chrome, window, document, location, Element, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, CSS, URL */

(() => {
  const APP_SOURCE = 'dear-robot-app';
  const BRIDGE_SOURCE = 'dear-robot-browser-bridge';
  const PROTOCOL_VERSION = 4;
  const CAPABILITIES = ['email_code', 'download', 'persistent_sessions'];
  let configuredAppOrigin = null;
  let activeSessionId = null;
  let listeners = [];
  let lastFill = null;

  function send(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // The extension can be reloaded while a page is open.
    }
  }

  function post(message, targetOrigin = window.location.origin) {
    window.postMessage({ source: BRIDGE_SOURCE, ...message }, targetOrigin);
  }

  function escapeCss(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
  }

  function selector(element) {
    if (!(element instanceof Element)) return '';
    if (element.id && !element.id.includes(':')) return `#${escapeCss(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeCss(testId)}"]`;
    const name = element.getAttribute('name');
    if (name) return `${element.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
    const label = element.getAttribute('aria-label');
    if (label) return `${element.tagName.toLowerCase()}[aria-label=${JSON.stringify(label)}]`;
    if (element.matches('button,a,[role="button"]') && element.textContent.trim()) {
      return `${element.tagName.toLowerCase()}:text-is(${JSON.stringify(element.textContent.trim())})`;
    }
    const parts = [];
    let current = element;
    for (let index = 0; current && current.nodeType === 1 && index < 5; index += 1, current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function credentialRef(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
    if (target instanceof HTMLInputElement && target.type === 'password') return 'password';
    const hint = [target.autocomplete, target.name, target.id, target.getAttribute('aria-label') || '']
      .join(' ')
      .toLowerCase();
    if (/one-time-code|otp|verification|security.?code|verify.?code/.test(hint)) return 'email_code';
    if (/(^|[\s_-])(user(name)?|login|email)([\s_-]|$)/.test(hint)) return 'username';
    return null;
  }

  function isNonRecordable(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
    if (target instanceof HTMLInputElement && ['checkbox', 'radio', 'file', 'hidden'].includes(target.type)) return true;
    const hint = [target.name, target.id, target.getAttribute('aria-label') || ''].join(' ').toLowerCase();
    return /csrf|xsrf|nonce|oauth.?state|access.?token|refresh.?token|api.?key/.test(hint);
  }

  function isLoginControl(target) {
    if (!(target instanceof Element)) return false;
    const form = target.closest('form');
    return Boolean(form && form.querySelector('input[type="password"], input[autocomplete="current-password"], input[autocomplete="password"]'));
  }

  function emit(action) {
    if (!activeSessionId || !action) return;
    send({ type: 'ACTION', sessionId: activeSessionId, action });
  }

  function recordFill(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (isNonRecordable(target)) return;
    const secretRef = credentialRef(target);
    const action = {
      type: 'fill',
      selector: selector(target),
      value: secretRef ? null : target.value.slice(0, 4000),
      ...(secretRef ? { secret: true, secretRef } : {})
    };
    const signature = JSON.stringify(action);
    if (lastFill === signature) return;
    lastFill = signature;
    emit(action);
  }

  function begin(sessionId) {
    if (!sessionId) return;
    if (activeSessionId === sessionId) return;
    stop(false);
    activeSessionId = String(sessionId);
    lastFill = null;
    const onChange = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)) emit({ type: 'check', selector: selector(target), checked: target.checked });
      else if (target instanceof HTMLSelectElement) emit({ type: 'select', selector: selector(target), value: target.value });
      else recordFill(target);
    };
    const onBlur = (event) => recordFill(event.target);
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
      if (!target) return;
      lastFill = null;
      const action = { type: 'click', selector: selector(target) };
      if (isLoginControl(target)) action.optional = true;
      emit(action);
    };
    const onKeydown = (event) => {
      if (event.key !== 'Enter' || !(event.target instanceof Element)) return;
      lastFill = null;
      const action = { type: 'press', selector: selector(event.target), key: 'Enter' };
      if (isLoginControl(event.target)) action.optional = true;
      emit(action);
    };
    listeners = [
      ['change', onChange],
      ['blur', onBlur],
      ['click', onClick],
      ['keydown', onKeydown]
    ];
    for (const [event, handler] of listeners) document.addEventListener(event, handler, true);
    // Navigation results are not replay actions: OAuth redirects contain
    // single-use state and authorization codes. Replay the triggering click.
  }

  function stop(notify = true) {
    if (!activeSessionId) return;
    for (const [event, handler] of listeners) document.removeEventListener(event, handler, true);
    listeners = [];
    const sessionId = activeSessionId;
    activeSessionId = null;
    lastFill = null;
    if (notify) send({ type: 'ENDED', sessionId });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BEGIN_RECORDING') begin(message.sessionId);
    if (message?.type === 'END_RECORDING' && message.sessionId === activeSessionId) stop();
    if (message?.type === 'BRIDGE_READY' && message.appOrigin === window.location.origin) {
      configuredAppOrigin = message.appOrigin;
      post(
        {
          type: 'READY',
          appOrigin: message.appOrigin,
          protocolVersion: PROTOCOL_VERSION,
          capabilities: CAPABILITIES
        },
        message.appOrigin
      );
    }
    if (message?.type === 'BRIDGE_EVENT') {
      if (message.appOrigin !== configuredAppOrigin || message.appOrigin !== window.location.origin) return;
      post(
        {
          type: 'BRIDGE_EVENT',
          appOrigin: message.appOrigin,
          sessionId: message.sessionId,
          event: message.event
        },
        message.appOrigin
      );
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== APP_SOURCE) return;
    if (event.data.type === 'PING') {
      send({ type: 'PING' });
      return;
    }
    if (event.data.type === 'START_RECORDING') {
      if (configuredAppOrigin !== window.location.origin) return;
      const sessionId = typeof event.data.sessionId === 'string' ? event.data.sessionId.slice(0, 160) : '';
      const bridgeToken = typeof event.data.bridgeToken === 'string' ? event.data.bridgeToken.slice(0, 2000) : '';
      let startUrl = '';
      try {
        const parsed = new URL(String(event.data.startUrl || ''), window.location.href);
        if (['http:', 'https:'].includes(parsed.protocol)) startUrl = parsed.href;
      } catch {
        // Invalid or non-web destinations are ignored.
      }
      if (sessionId && startUrl && bridgeToken) {
        send({
          type: 'START_RECORDING',
          sessionId,
          startUrl,
          bridgeToken,
          appOrigin: window.location.origin
        });
      }
      return;
    }
    if (event.data.type === 'STOP_RECORDING') {
      if (configuredAppOrigin !== window.location.origin) return;
      if (typeof event.data.sessionId === 'string' && event.data.sessionId.length <= 160) {
        send({ type: 'STOP_RECORDING', sessionId: event.data.sessionId });
      }
    }
  });

  // The background worker uses this signal to attach recording listeners after
  // every navigation in the report tab.
  send({ type: 'CONTENT_READY', url: location.href, sessionId: activeSessionId });
})();
