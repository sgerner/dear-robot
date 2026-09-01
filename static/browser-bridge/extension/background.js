/* global chrome, setTimeout */

// The bridge deliberately keeps session state in memory. It only forwards
// actions to the authenticated Dear Robot tab; it never sends passwords or
// cookies to a third-party service.
const sessions = new Map();

function sendToTab(tabId, message) {
  if (typeof tabId !== 'number') return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      // Suppress the expected lastError when a page is navigating or closed.
      void chrome.runtime.lastError;
    });
  } catch {
    // The tab can disappear between an event and this forwarding call.
  }
}

function sendToApp(session, message) {
  sendToTab(session.appTabId, {
    type: 'BRIDGE_EVENT',
    sessionId: session.sessionId,
    event: message
  });
}

function sessionForTarget(tabId) {
  return [...sessions.values()].find((session) => session.targetTabId === tabId) || null;
}

function sessionForApp(tabId, sessionId) {
  const session = sessions.get(sessionId);
  return session && session.appTabId === tabId ? session : null;
}

function safeFilename(value) {
  const raw = String(value || '').split(/[\\/]/).pop() || '';
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const senderTabId = sender.tab?.id;
  if (message?.type === 'START_RECORDING') {
    if (typeof senderTabId !== 'number' || !message.sessionId || !message.startUrl) return;
    const session = {
      sessionId: String(message.sessionId),
      appTabId: senderTabId,
      targetTabId: null,
      startUrl: String(message.startUrl),
      startedAt: Date.now(),
      stopped: false
    };
    sessions.set(session.sessionId, session);
    chrome.tabs.create({ url: session.startUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        sendToApp(session, { type: 'ERROR', message: 'The browser could not open the report tab.' });
        sessions.delete(session.sessionId);
        return;
      }
      session.targetTabId = tab.id;
      sendToApp(session, { type: 'STARTED', targetTabId: tab.id });
      // The content script may have announced readiness before tabs.create's
      // callback fired; send BEGIN again so that race cannot skip recording.
      sendToTab(session.targetTabId, { type: 'BEGIN_RECORDING', sessionId: session.sessionId });
    });
    return;
  }

  if (message?.type === 'STOP_RECORDING') {
    const session = sessionForApp(senderTabId, String(message.sessionId || ''));
    if (!session) return;
    session.stopped = true;
    sendToTab(session.targetTabId, { type: 'END_RECORDING', sessionId: session.sessionId });
    // Give the content script a moment to flush its final blur/click event.
    setTimeout(() => {
      sendToApp(session, { type: 'STOPPED' });
      sessions.delete(session.sessionId);
    }, 150);
    return;
  }

  if (message?.type === 'CONTENT_READY') {
    const session = sessionForTarget(senderTabId);
    if (session && !session.stopped) {
      sendToTab(session.targetTabId, { type: 'BEGIN_RECORDING', sessionId: session.sessionId });
    }
    return;
  }

  if (message?.type === 'ACTION') {
    const session = sessionForTarget(senderTabId);
    if (session && !session.stopped && message.action) {
      sendToApp(session, { type: 'ACTION', action: message.action });
    }
    return;
  }

  if (message?.type === 'ENDED') {
    const session = sessionForTarget(senderTabId);
    if (session) sendToApp(session, { type: 'STOPPED' });
  }
});

chrome.downloads.onCreated.addListener((item) => {
  const session = sessionForTarget(item.tabId);
  if (!session || session.stopped) return;
  const filename = safeFilename(item.filename || item.url);
  sendToApp(session, {
    type: 'ACTION',
    action: { type: 'download' },
    ...(filename ? { downloadFilename: filename } : {})
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [sessionId, session] of sessions) {
    if (session.appTabId === tabId) {
      sessions.delete(sessionId);
      continue;
    }
    if (session.targetTabId === tabId && !session.stopped) {
      sendToApp(session, { type: 'ERROR', message: 'The report tab was closed before recording finished.' });
      sessions.delete(sessionId);
    }
  }
});
