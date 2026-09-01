/* global chrome, window, document, location, Element, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, CSS */

(() => {
  const APP_SOURCE = 'dear-robot-app';
  const BRIDGE_SOURCE = 'dear-robot-browser-bridge';
  let activeSessionId = null;
  let listeners = [];

  function send(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // The extension can be reloaded while a page is open.
    }
  }

  function post(message) {
    window.postMessage({ source: BRIDGE_SOURCE, ...message }, '*');
  }

  function escapeCss(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function selector(element) {
    if (!(element instanceof Element)) return '';
    if (element.id) return `#${escapeCss(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeCss(testId)}"]`;
    const name = element.getAttribute('name');
    if (name) return `${element.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
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
    if (/(^|[\s_-])(user(name)?|login|email)([\s_-]|$)/.test(hint)) return 'username';
    return null;
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
    const secretRef = credentialRef(target);
    emit({
      type: 'fill',
      selector: selector(target),
      value: secretRef ? null : target.value.slice(0, 4000),
      ...(secretRef ? { secret: true, secretRef } : {})
    });
  }

  function begin(sessionId) {
    if (!sessionId) return;
    if (activeSessionId === sessionId) return;
    stop(false);
    activeSessionId = String(sessionId);
    const onChange = (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement) emit({ type: 'select', selector: selector(target), value: target.value });
      else recordFill(target);
    };
    const onBlur = (event) => recordFill(event.target);
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"],input[type="submit"]') : null;
      if (!target) return;
      const action = { type: 'click', selector: selector(target) };
      if (isLoginControl(target)) action.optional = true;
      emit(action);
    };
    const onKeydown = (event) => {
      if (event.key !== 'Enter' || !(event.target instanceof Element)) return;
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
    emit({ type: 'goto', url: location.href });
  }

  function stop(notify = true) {
    if (!activeSessionId) return;
    for (const [event, handler] of listeners) document.removeEventListener(event, handler, true);
    listeners = [];
    const sessionId = activeSessionId;
    activeSessionId = null;
    if (notify) send({ type: 'ENDED', sessionId });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BEGIN_RECORDING') begin(message.sessionId);
    if (message?.type === 'END_RECORDING' && message.sessionId === activeSessionId) stop();
    if (message?.type === 'BRIDGE_EVENT') {
      post({ type: 'BRIDGE_EVENT', sessionId: message.sessionId, event: message.event });
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== APP_SOURCE) return;
    if (event.data.type === 'PING') {
      post({ type: 'READY' });
      return;
    }
    if (event.data.type === 'START_RECORDING') {
      send({ type: 'START_RECORDING', sessionId: event.data.sessionId, startUrl: event.data.startUrl });
      return;
    }
    if (event.data.type === 'STOP_RECORDING') {
      send({ type: 'STOP_RECORDING', sessionId: event.data.sessionId });
    }
  });

  // The background worker uses this signal to attach recording listeners after
  // every navigation in the report tab.
  send({ type: 'CONTENT_READY', url: location.href });
})();
