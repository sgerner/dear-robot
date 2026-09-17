/* global chrome, setTimeout, clearTimeout, URL, fetch, AbortController */

// The bridge only keeps a small, non-secret session record. It never stores
// cookies, credentials, or page contents. storage.session is used when the
// browser provides it so a suspended worker can resume routing messages; the
// in-memory map remains the fallback for older Firefox builds.
const SESSION_TTL_MS = 60 * 60 * 1000;
const LOCAL_APP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const sessions = new Map();
const stopTimers = new Map();
const storageSession = chrome.storage?.session || null;

function invokeApi(namespace, name, args = []) {
  const method = namespace?.[name];
  if (typeof method !== 'function') return Promise.reject(new Error(`Missing browser API: ${name}`));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const callback = (value) => {
      let runtimeError = null;
      try {
        runtimeError = chrome.runtime?.lastError || null;
      } catch {
        // Some test doubles do not expose runtime.lastError.
      }
      if (runtimeError) finish(reject, new Error(runtimeError.message || String(runtimeError)));
      else finish(resolve, value);
    };
    try {
      const result = method.call(namespace, ...args, callback);
      if (result && typeof result.then === 'function') {
        result.then((value) => finish(resolve, value), (error) => finish(reject, error));
      } else if (result !== undefined && method.length <= args.length) {
        finish(resolve, result);
      }
    } catch (error) {
      finish(reject, error);
    }
  });
}

function readStoredSessions() {
  if (!storageSession?.get) return Promise.resolve({});
  return invokeApi(storageSession, 'get', ['recordings']).catch(() => ({}));
}

function persistedSession(session) {
  // Do not persist startUrl or target URL history: URLs can contain bearer
  // tokens. The live tab is queried again after worker restoration.
  return {
    sessionId: session.sessionId,
    appTabId: session.appTabId,
    targetTabId: session.targetTabId,
    appOrigin: session.appOrigin,
    startedAt: session.startedAt,
    stopped: Boolean(session.stopped),
    stopping: Boolean(session.stopping)
  };
}

function persist() {
  if (!storageSession?.set) return Promise.resolve();
  return invokeApi(storageSession, 'set', [{ recordings: [...sessions.values()].map(persistedSession) }]).catch(() => undefined);
}

function validStoredSession(value) {
  return Boolean(
    value &&
    typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 160 &&
    Number.isInteger(value.appTabId) && value.appTabId >= 0 &&
    (value.targetTabId === null || Number.isInteger(value.targetTabId)) &&
    appOrigin(value.appOrigin) === value.appOrigin &&
    Number.isFinite(value.startedAt) && Date.now() - value.startedAt < SESSION_TTL_MS
  );
}

const restored = readStoredSessions().then(({ recordings }) => {
  for (const value of Array.isArray(recordings) ? recordings : []) {
    if (!validStoredSession(value)) continue;
    sessions.set(value.sessionId, {
      ...value,
      startUrl: '',
      targetUrlHistory: [],
      lastDownloadId: null,
      lastDownloadFilename: ''
    });
  }
});

function sendToTab(tabId, message) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  try {
    const result = chrome.tabs.sendMessage(tabId, message, () => {
      // Suppress the expected lastError when a page is navigating or closed.
      try { void chrome.runtime?.lastError; } catch { /* noop */ }
    });
    if (result && typeof result.catch === 'function') result.catch(() => undefined);
  } catch {
    // The tab can disappear between an event and this forwarding call.
  }
}

function sendToApp(session, message) {
  const trustedOrigin = appOrigin(session.appOrigin);
  if (!trustedOrigin) return;
  sendToTab(session.appTabId, {
    type: 'BRIDGE_EVENT',
    appOrigin: trustedOrigin,
    sessionId: session.sessionId,
    event: message
  });
}

function sendErrorToAppTab(tabId, trustedOriginValue, sessionId, message) {
  const trustedOrigin = appOrigin(trustedOriginValue);
  if (!trustedOrigin) return;
  sendToTab(tabId, {
    type: 'BRIDGE_EVENT',
    appOrigin: trustedOrigin,
    sessionId,
    event: { type: 'ERROR', message }
  });
}

function sessionForTarget(tabId) {
  return [...sessions.values()].find((session) => session.targetTabId === tabId) || null;
}

function sessionForApp(tabId, sessionId) {
  const session = sessions.get(sessionId);
  return session && session.appTabId === tabId ? session : null;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function appOrigin(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== String(value)) return null;
    if (url.protocol === 'http:' && !LOCAL_APP_HOSTS.has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function pageOrigin(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function isTopLevelSender(sender) {
  return !Number.isInteger(sender?.frameId) || sender.frameId === 0;
}

function readConfiguredAppOrigin() {
  if (!chrome.storage?.local?.get) return Promise.resolve(null);
  return invokeApi(chrome.storage.local, 'get', ['appOrigin'])
    .then((settings) => appOrigin(settings?.appOrigin))
    .catch(() => null);
}

async function verifyBridgeCapability(message, sessionId) {
  const origin = appOrigin(message.appOrigin);
  const token = typeof message.bridgeToken === 'string' ? message.bridgeToken : '';
  if (!origin || token.length < 20 || token.length > 2000) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL('/api/browser/bridge/verify', origin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, sessionId, appOrigin: origin }),
      signal: controller.signal,
      credentials: 'omit'
    });
    if (!response.ok) return false;
    const result = await response.json().catch(() => null);
    return Boolean(result?.valid && result.sessionId === sessionId && result.appOrigin === origin);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalUrl(value) {
  const valid = httpUrl(value);
  return valid ? valid : '';
}

function rememberTargetUrl(session, value) {
  const url = canonicalUrl(value);
  if (!url) return;
  session.targetUrlHistory = [...new Set([...(session.targetUrlHistory || []), url])].slice(-8);
}

function safeFilename(value) {
  let raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    raw = url.pathname.split(/[\\/]/).pop() || '';
  } catch {
    raw = raw.split(/[\\/]/).pop() || '';
  }
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180);
}

function sanitizeAction(value) {
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') return null;
  const selector = typeof value.selector === 'string' ? value.selector.slice(0, 500) : '';
  if (!selector && value.type !== 'download') return null;
  if (value.type === 'fill') {
    if (value.secretRef && ['username', 'password', 'email_code'].includes(value.secretRef)) {
      return { type: 'fill', selector, value: null, secret: true, secretRef: value.secretRef };
    }
    if (value.secret || value.value === null || value.value === undefined) return null;
    return { type: 'fill', selector, value: String(value.value).slice(0, 4000) };
  }
  if (value.type === 'click') return { type: 'click', selector, ...(value.optional === true ? { optional: true } : {}) };
  if (value.type === 'press') {
    const key = typeof value.key === 'string' ? value.key.slice(0, 32) : '';
    return key ? { type: 'press', selector, key, ...(value.optional === true ? { optional: true } : {}) } : null;
  }
  if (value.type === 'check' && typeof value.checked === 'boolean') return { type: 'check', selector, checked: value.checked };
  if (value.type === 'select' && typeof value.value === 'string') return { type: 'select', selector, value: value.value.slice(0, 4000) };
  // Navigation is deliberately not a client-recorded action: redirect URLs
  // frequently contain one-time OAuth state or authorization codes.
  return null;
}

function finishStop(session) {
  if (!sessions.has(session.sessionId)) return;
  const timer = stopTimers.get(session.sessionId);
  if (timer) clearTimeout(timer);
  stopTimers.delete(session.sessionId);
  sessions.delete(session.sessionId);
  sendToApp(session, { type: 'STOPPED' });
  void persist();
}

async function startRecording(message, senderTabId, trustedOrigin) {
  const sessionId = String(message.sessionId || '');
  const startUrl = httpUrl(message.startUrl);
  if (
    !Number.isInteger(senderTabId) ||
    !trustedOrigin ||
    appOrigin(message.appOrigin) !== trustedOrigin ||
    !sessionId ||
    sessionId.length > 160 ||
    !startUrl
  ) return;
  if (!(await verifyBridgeCapability({ ...message, appOrigin: trustedOrigin }, sessionId))) {
    sendErrorToAppTab(senderTabId, trustedOrigin, sessionId, 'Dear Robot could not verify this recording request. Return to the email and start again.');
    return;
  }
  const existing = [...sessions.values()].find((session) => session.appTabId === senderTabId && !session.stopped);
  if (existing) {
    sendErrorToAppTab(senderTabId, trustedOrigin, sessionId, 'A browser recording is already active in this tab.');
    return;
  }
  const session = {
    sessionId,
    appTabId: senderTabId,
    targetTabId: null,
    appOrigin: trustedOrigin,
    startUrl,
    startedAt: Date.now(),
    stopped: false,
    stopping: false,
    targetUrlHistory: [],
    lastDownloadId: null,
    lastDownloadFilename: ''
  };
  sessions.set(session.sessionId, session);
  // Persist before opening the tab so a suspended worker cannot lose the
  // app/session association during the asynchronous tabs.create call.
  await persist();
  try {
    const tab = await invokeApi(chrome.tabs, 'create', [{ url: session.startUrl, active: true }]);
    if (!tab || !Number.isInteger(tab.id)) throw new Error('The browser could not open the report tab.');
    session.targetTabId = tab.id;
    rememberTargetUrl(session, tab.url || session.startUrl);
    await persist();
    sendToApp(session, { type: 'STARTED', targetTabId: tab.id });
    // The content script may have announced readiness before tabs.create's
    // callback fired; send BEGIN again so that race cannot skip recording.
    sendToTab(session.targetTabId, { type: 'BEGIN_RECORDING', sessionId: session.sessionId });
  } catch {
    sessions.delete(session.sessionId);
    await persist();
    sendErrorToAppTab(senderTabId, trustedOrigin, sessionId, 'The browser could not open the report tab.');
  }
}

async function handleMessage(message, sender) {
  const senderTabId = sender?.tab?.id;
  const senderOrigin = pageOrigin(sender?.url);
  if (!isTopLevelSender(sender)) return;

  if (message?.type === 'PING') {
    const configuredOrigin = await readConfiguredAppOrigin();
    if (!Number.isInteger(senderTabId) || !senderOrigin || senderOrigin !== configuredOrigin) return;
    sendToTab(senderTabId, { type: 'BRIDGE_READY', appOrigin: configuredOrigin });
    return;
  }

  if (message?.type === 'START_RECORDING') {
    const configuredOrigin = await readConfiguredAppOrigin();
    if (!senderOrigin || senderOrigin !== configuredOrigin) return;
    await startRecording(message, senderTabId, configuredOrigin);
    return;
  }

  if (message?.type === 'STOP_RECORDING') {
    const session = sessionForApp(senderTabId, String(message.sessionId || ''));
    const configuredOrigin = await readConfiguredAppOrigin();
    if (!session || session.stopping || senderOrigin !== session.appOrigin || senderOrigin !== configuredOrigin) return;
    session.stopping = true;
    sendToTab(session.targetTabId, { type: 'END_RECORDING', sessionId: session.sessionId });
    // END_RECORDING normally receives an immediate ENDED acknowledgement.
    // Keep a bounded fallback for closed/unloaded content scripts.
    const timer = setTimeout(() => finishStop(session), 1000);
    stopTimers.set(session.sessionId, timer);
    return;
  }

  if (message?.type === 'CONTENT_READY') {
    const session = sessionForTarget(senderTabId);
    if (session && !session.stopped && !session.stopping) {
      rememberTargetUrl(session, message.url);
      sendToTab(session.targetTabId, { type: 'BEGIN_RECORDING', sessionId: session.sessionId });
    }
    return;
  }

  if (message?.type === 'ACTION') {
    const session = sessionForTarget(senderTabId);
    if (!session || session.stopped || session.sessionId !== String(message.sessionId || '')) return;
    const action = sanitizeAction(message.action);
    if (action) sendToApp(session, { type: 'ACTION', action });
    return;
  }

  if (message?.type === 'ENDED') {
    const session = sessionForTarget(senderTabId);
    if (session && session.stopping && session.sessionId === String(message.sessionId || '')) finishStop(session);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  void restored.then(() => handleMessage(message, sender));
});

function findDownloadSession(item, tabs) {
  const candidates = [...sessions.values()].filter((session) => !session.stopped && !session.stopping && Number.isInteger(session.targetTabId));
  const referrer = canonicalUrl(item?.referrer);
  const matching = candidates.filter((session) => {
    const tab = tabs.find((value) => value?.id === session.targetTabId);
    if (!tab) return false;
    const knownUrls = new Set([...(session.targetUrlHistory || []), canonicalUrl(tab.url)]);
    return Boolean(referrer && knownUrls.has(referrer));
  });
  if (matching.length === 1) return matching[0];
  // Some Firefox downloads omit referrer. Associate only when there is one
  // active target and the download URL is same-origin with that target.
  if (!referrer && candidates.length === 1) {
    const session = candidates[0];
    const tab = tabs.find((value) => value?.id === session.targetTabId);
    const current = canonicalUrl(tab?.url) || session.targetUrlHistory?.at(-1) || '';
    const downloadUrl = canonicalUrl(item?.url);
    if (current && downloadUrl && new URL(current).origin === new URL(downloadUrl).origin) return session;
  }
  return null;
}

async function captureDownload(item) {
  const tabs = await invokeApi(chrome.tabs, 'query', [{}]).catch(() => []);
  const session = findDownloadSession(item, Array.isArray(tabs) ? tabs : []);
  if (!session) return;
  const filename = safeFilename(item?.filename || item?.url);
  session.lastDownloadId = item?.id ?? null;
  session.lastDownloadFilename = filename;
  sendToApp(session, {
    type: 'ACTION',
    action: { type: 'download' },
    ...(filename ? { downloadFilename: filename } : {})
  });
}

chrome.downloads.onCreated.addListener((item) => {
  void restored.then(() => captureDownload(item));
});

// A filename may be unavailable at onCreated time. Forward a later filename
// update for the same download without exporting the local download path.
chrome.downloads.onChanged?.addListener((delta) => {
  if (typeof delta?.id !== 'number' || typeof delta.filename?.current !== 'string') return;
  void restored.then(() => {
    const session = [...sessions.values()].find((value) => value.lastDownloadId === delta.id && !value.stopped);
    if (!session) return;
    const filename = safeFilename(delta.filename.current);
    if (!filename || filename === session.lastDownloadFilename) return;
    session.lastDownloadFilename = filename;
    sendToApp(session, { type: 'ACTION', action: { type: 'download' }, downloadFilename: filename });
  });
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  void restored.then(() => {
    const session = sessionForTarget(tabId);
    if (session) rememberTargetUrl(session, changeInfo?.url || tab?.url);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void restored.then(() => {
    for (const [sessionId, session] of sessions) {
      if (session.appTabId === tabId) {
        if (session.stopping) finishStop(session);
        else {
          sessions.delete(sessionId);
          void persist();
        }
        continue;
      }
      if (session.targetTabId === tabId) {
        if (session.stopping) finishStop(session);
        else {
          sendToApp(session, { type: 'ERROR', message: 'The report tab was closed before recording finished.' });
          sessions.delete(sessionId);
          void persist();
        }
      }
    }
  });
});
