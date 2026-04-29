const DB_NAME = 'triage-client-cache';
const DB_VERSION = 1;

type StoreName = 'messages' | 'folders' | 'contacts' | 'meta' | 'outbox' | 'draft_local';

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('contacts')) db.createObjectStore('contacts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('draft_local')) db.createObjectStore('draft_local', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function replaceCache(storeName: StoreName, rows: Array<Record<string, unknown>>) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function setCacheMeta(key: string, value: unknown) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function putLocalDraft(id: string, value: Record<string, unknown>) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('draft_local', 'readwrite');
    tx.objectStore('draft_local').put({ id, ...value, updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function enqueueOutbox(payload: Record<string, unknown>) {
  if (typeof indexedDB === 'undefined') return null;
  const id = `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').put({ id, payload, createdAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

export async function listOutbox() {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openCache();
  const rows = await new Promise<Array<{ id: string; payload: Record<string, unknown> }>>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const request = tx.objectStore('outbox').getAll();
    request.onsuccess = () => resolve(request.result as Array<{ id: string; payload: Record<string, unknown> }>);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

export async function deleteOutbox(id: string) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
