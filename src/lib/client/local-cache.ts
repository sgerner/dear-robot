const DB_NAME = 'dear-robot-client-cache';
const DB_VERSION = 2;
const CACHE_KEY_STORAGE = 'dear-robot-cache-passphrase';

type StoreName = 'messages' | 'folders' | 'contacts' | 'meta' | 'outbox' | 'draft_local' | 'message_details';

let encryptionPassphrase: string | null = null;

export function setCacheEncryptionPassphrase(passphrase: string | null) {
  encryptionPassphrase = passphrase && passphrase.trim() ? passphrase.trim() : null;
  if (typeof localStorage !== 'undefined') {
    if (encryptionPassphrase) localStorage.setItem(CACHE_KEY_STORAGE, encryptionPassphrase);
    else localStorage.removeItem(CACHE_KEY_STORAGE);
  }
}

export function loadCacheEncryptionPassphrase() {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(CACHE_KEY_STORAGE);
  encryptionPassphrase = value && value.trim() ? value.trim() : null;
  return encryptionPassphrase;
}

export function cacheEncryptionEnabled() {
  return Boolean(encryptionPassphrase);
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function protectRecord(record: Record<string, unknown>) {
  if (!encryptionPassphrase || typeof crypto === 'undefined') return record;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(encryptionPassphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(record));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  return {
    id: record.id,
    __enc: true,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cipher)
  };
}

async function unprotectRecord(record: Record<string, unknown>) {
  if (!record || !record.__enc) return record;
  if (!encryptionPassphrase || typeof crypto === 'undefined') return null;
  const salt = base64ToBytes(String(record.salt || ''));
  const iv = base64ToBytes(String(record.iv || ''));
  const data = base64ToBytes(String(record.data || ''));
  const key = await deriveKey(encryptionPassphrase, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('messages'))
        db.createObjectStore('messages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders'))
        db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('contacts'))
        db.createObjectStore('contacts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('outbox'))
        db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('draft_local'))
        db.createObjectStore('draft_local', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('message_details'))
        db.createObjectStore('message_details', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCache(storeName: StoreName, id: string | number) {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openCache();
  const row = await new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return row ? unprotectRecord(row) : null;
}

export async function upsertCache(storeName: StoreName, rows: Array<Record<string, unknown>>) {
  if (typeof indexedDB === 'undefined') return;
  const protectedRows = await Promise.all(rows.map((row) => protectRecord(row)));
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of protectedRows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteFromCache(storeName: StoreName, id: string | number) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function replaceCache(storeName: StoreName, rows: Array<Record<string, unknown>>) {
  if (typeof indexedDB === 'undefined') return;
  const protectedRows = await Promise.all(rows.map((row) => protectRecord(row)));
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of protectedRows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function syncCache(
  storeName: StoreName,
  rows: Array<Record<string, unknown>>,
  options: { deleteMissing?: boolean } = {}
) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openCache();
  const existingRows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result || []) as Array<Record<string, unknown>>);
    request.onerror = () => reject(request.error);
  });
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const nextIds = new Set(rows.map((row) => row.id));
  const rowsToPut: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const existing = existingById.get(row.id);
    if (!existing?.__enc && JSON.stringify(existing) === JSON.stringify(row)) continue;
    rowsToPut.push(await protectRecord(row));
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const row of rowsToPut) store.put(row);
    if (options.deleteMissing) {
      for (const row of existingRows) {
        if (!nextIds.has(row.id)) store.delete(row.id as IDBValidKey);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function setCacheMeta(key: string, value: unknown) {
  if (typeof indexedDB === 'undefined') return;
  const row = await protectRecord({ key, value, updatedAt: new Date().toISOString() });
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function putLocalDraft(id: string, value: Record<string, unknown>) {
  if (typeof indexedDB === 'undefined') return;
  const row = await protectRecord({ id, ...value, updatedAt: new Date().toISOString() });
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('draft_local', 'readwrite');
    tx.objectStore('draft_local').put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function enqueueOutbox(payload: Record<string, unknown>) {
  if (typeof indexedDB === 'undefined') return null;
  const id = `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = await protectRecord({ id, payload, createdAt: new Date().toISOString() });
  const db = await openCache();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

export async function listOutbox() {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openCache();
  const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const request = tx.objectStore('outbox').getAll();
    request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const resolved = await Promise.all(rows.map((row) => unprotectRecord(row)));
  return resolved.filter((row): row is { id: string; payload: Record<string, unknown> } =>
    Boolean(row?.id && row?.payload)
  );
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
