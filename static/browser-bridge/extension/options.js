/* global chrome, document, URL */

(() => {
  const form = document.querySelector('#settings-form');
  const input = document.querySelector('#app-origin');
  const status = document.querySelector('#status');
  const clearButton = document.querySelector('#clear-origin');

  function storageCall(methodName, args) {
    const method = chrome.storage?.local?.[methodName];
    if (typeof method !== 'function') return Promise.reject(new Error('Browser storage is unavailable.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const callback = (value) => {
        const runtimeError = chrome.runtime?.lastError;
        if (runtimeError) finish(reject, new Error(runtimeError.message || String(runtimeError)));
        else finish(resolve, value);
      };
      try {
        const result = method.call(chrome.storage.local, ...args, callback);
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

  function normalizedOrigin(value) {
    let url;
    try {
      url = new URL(String(value).trim());
    } catch {
      throw new Error('Enter a valid app origin, such as https://mail.example.com.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Enter the app origin only, without a path, query, or fragment.');
    }
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
      throw new Error('Use HTTPS, except for localhost development.');
    }
    return url.origin;
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  storageCall('get', ['appOrigin'])
    .then((settings) => {
      input.value = settings?.appOrigin || '';
    })
    .catch(() => showStatus('Could not load the saved origin.', true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const appOrigin = normalizedOrigin(input.value);
      await storageCall('set', [{ appOrigin }]);
      input.value = appOrigin;
      showStatus('Origin saved. The bridge will only listen on this origin.');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Could not save the app origin.', true);
    }
  });

  clearButton.addEventListener('click', async () => {
    try {
      await storageCall('set', [{ appOrigin: '' }]);
      input.value = '';
      showStatus('Saved origin cleared. The bridge will not respond to app pages.');
    } catch {
      showStatus('Could not clear the saved origin.', true);
    }
  });
})();
