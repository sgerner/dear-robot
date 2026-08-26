import { and, eq, inArray } from 'drizzle-orm';
import { db, nowIso } from './db';
import { accounts, folders, folderSyncState, messageAttachments, messages } from './db/schema';
import { providerForAccount } from './email/provider';
import { suggestForMessage } from './services/messages';
import { appEvents } from './events';

type WorkerState = {
  abortController: AbortController;
  pollTimer: NodeJS.Timeout;
};

const workers = new Map<number, WorkerState>();
const syncInFlight = new Set<number>();
const observedFolderCounts = new Map<number, Map<string, number>>();
let initialized = false;

export function startSyncEngine() {
  if (initialized) return;
  initialized = true;
  const enabled = db.select().from(accounts).where(eq(accounts.isEnabled, true)).all();
  for (const account of enabled) startSyncWorkerForAccount(account.id);
}

export function startSyncWorkerForAccount(accountId: number, options?: { runInitialSync?: boolean }) {
  if (workers.has(accountId)) return;
  const abortController = new AbortController();
  void runWatchLoop(accountId, abortController.signal);
  void runFolderReconciliationLoop(accountId, abortController.signal);
  if (options?.runInitialSync !== false) {
    void syncAccount(accountId);
  }
  const pollTimer = setInterval(() => void syncAccount(accountId), 5 * 60 * 1000);
  workers.set(accountId, { abortController, pollTimer });
}

export function stopSyncWorkerForAccount(accountId: number) {
  const worker = workers.get(accountId);
  if (worker) {
    worker.abortController.abort();
    clearInterval(worker.pollTimer);
  }
  workers.delete(accountId);
  observedFolderCounts.delete(accountId);
}

export async function syncAccount(accountId: number) {
  if (syncInFlight.has(accountId)) return;
  syncInFlight.add(accountId);
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || !account.isEnabled) {
    syncInFlight.delete(accountId);
    return;
  }
  const provider = providerForAccount(account);
  const now = nowIso();
  let activeFolderPath = '(folder discovery)';
  db.update(accounts)
    .set({ syncStatus: 'syncing', syncError: null, updatedAt: now })
    .where(eq(accounts.id, accountId))
    .run();
  try {
    const remoteFolders = await provider.listFolders(account);
    for (const folder of remoteFolders) {
      db.insert(folders)
        .values({
          accountId,
          name: folder.name,
          path: folder.path,
          role: folder.role ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
        .onConflictDoUpdate({
          target: [folders.accountId, folders.path],
          set: { name: folder.name, role: folder.role ?? null, updatedAt: nowIso() }
        })
        .run();
    }
    const foldersToSync = remoteFolders.length ? remoteFolders : [{ path: 'INBOX' }];
    for (const folder of foldersToSync) {
      activeFolderPath = folder.path;
      const isInboxFolder =
        (folder as { role?: string | null }).role === 'inbox' ||
        folder.path.toLowerCase() === 'inbox';
      const fetchLimit = isInboxFolder ? 1000 : 250;
      const now = nowIso();
      const priorState = db
        .select()
        .from(folderSyncState)
        .where(
          and(eq(folderSyncState.accountId, accountId), eq(folderSyncState.folderPath, folder.path))
        )
        .get();
      const remoteState = provider.folderState
        ? await provider.folderState(account, folder.path)
        : null;
      if (remoteState?.messageCount !== undefined) {
        rememberObservedFolderCount(accountId, folder.path, remoteState.messageCount);
      }
      const uidValidityChanged =
        Boolean(priorState?.uidValidity && remoteState?.uidValidity) &&
        priorState?.uidValidity !== remoteState?.uidValidity;
      const sinceUid = uidValidityChanged ? 0 : (priorState?.highestUid ?? 0);
      const remoteMessages =
        provider.fetchSinceUid && sinceUid > 0
          ? await provider.fetchSinceUid(account, folder.path, sinceUid, fetchLimit)
          : await provider.backfill(account, fetchLimit, folder.path);
      const uniqueRemote = mergeByProviderMessageId(remoteMessages);
      const providerIds = uniqueRemote.map((remote) => remote.providerMessageId);
      const existingProviderIds = new Set<string>();
      for (let offset = 0; offset < providerIds.length; offset += 400) {
        const batch = providerIds.slice(offset, offset + 400);
        if (!batch.length) continue;
        const rows = db
          .select({ providerMessageId: messages.providerMessageId })
          .from(messages)
          .where(
            and(eq(messages.accountId, accountId), inArray(messages.providerMessageId, batch))
          )
          .all();
        for (const row of rows) existingProviderIds.add(row.providerMessageId);
      }
      let maxSeenUid = sinceUid;
      for (const remote of uniqueRemote) {
        const existedBefore = existingProviderIds.has(remote.providerMessageId);
        const saved = upsertRemoteMessage(accountId, remote);
        const uid = messageUid(remote.providerMessageId);
        if (uid > maxSeenUid) maxSeenUid = uid;
        if (!existedBefore && saved && isInboxFolder) {
          void suggestForMessage(saved.id).catch((error) => {
            console.error('[dear-robot] AI evaluation failed for inserted message', saved.id, error);
          });
        }
      }
      const highestUid = Math.max(maxSeenUid, remoteState?.highestUid ?? 0);
      if (provider.fetchAllUids && priorState?.uidValidity && !uidValidityChanged) {
        const remoteUids = await provider.fetchAllUids(account, folder.path);
        const remoteUidSet = new Set(remoteUids);
        const localRows = db
          .select({ id: messages.id, providerMessageId: messages.providerMessageId })
          .from(messages)
          .where(
            and(eq(messages.accountId, accountId), eq(messages.folderPath, folder.path))
          )
          .all();
        const staleIds: number[] = [];
        for (const local of localRows) {
          const uid = messageUid(local.providerMessageId);
          if (uid > 0 && !remoteUidSet.has(uid)) {
            staleIds.push(local.id);
          }
        }
        for (let offset = 0; offset < staleIds.length; offset += 400) {
          const batch = staleIds.slice(offset, offset + 400);
          db.delete(messages).where(inArray(messages.id, batch)).run();
        }
      }
      db.insert(folderSyncState)
        .values({
          accountId,
          folderPath: folder.path,
          uidValidity: remoteState?.uidValidity ?? null,
          highestUid,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [folderSyncState.accountId, folderSyncState.folderPath],
          set: {
            uidValidity: remoteState?.uidValidity ?? null,
            highestUid,
            lastSyncedAt: now,
            updatedAt: now
          }
        })
        .run();
      if (uidValidityChanged) {
        db.update(accounts)
          .set({
            syncError: `UIDVALIDITY changed for ${folder.path}; cursor reset`,
            updatedAt: nowIso()
          })
          .where(eq(accounts.id, accountId))
          .run();
      }
    }
    db.update(accounts)
      .set({ syncStatus: 'idle', syncError: null, lastSyncAt: nowIso(), updatedAt: nowIso() })
      .where(eq(accounts.id, accountId))
      .run();
  } catch (error) {
    console.error(
      `[dear-robot] Sync failed for ${account.email} in ${activeFolderPath}:`,
      error instanceof Error ? error.stack || error.message : String(error)
    );
    db.update(accounts)
      .set({
        syncStatus: 'error',
        syncError: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      })
      .where(eq(accounts.id, accountId))
      .run();
  } finally {
    syncInFlight.delete(accountId);
    appEvents.emit('sync_complete', { accountId });
  }
}

async function runFolderReconciliationLoop(accountId: number, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await syncFoldersWhenRemoteCountsChange(accountId);
    } catch (error) {
      if (!signal.aborted) {
        console.error(
          `[dear-robot] Folder reconciliation loop failed for account ${accountId}:`,
          error
        );
      }
    }
    if (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
}

async function syncFoldersWhenRemoteCountsChange(accountId: number) {
  const changed = await detectRemoteFolderChanges(accountId);
  if (changed) await syncAccount(accountId);
}

export async function detectRemoteFolderChanges(accountId: number) {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || !account.isEnabled) return false;
  const provider = providerForAccount(account);
  if (!provider.folderState) return false;
  const folderRows = db
    .select({ path: folders.path })
    .from(folders)
    .where(eq(folders.accountId, accountId))
    .all();
  const knownCounts = observedFolderCounts.get(accountId) || new Map<string, number>();
  let changed = false;
  for (const folder of folderRows) {
    const state = await provider.folderState(account, folder.path);
    const previousCount = knownCounts.get(folder.path);
    if (previousCount !== undefined && previousCount !== state.messageCount) {
      changed = true;
    }
    knownCounts.set(folder.path, state.messageCount);
  }
  observedFolderCounts.set(accountId, knownCounts);
  return changed;
}

function rememberObservedFolderCount(accountId: number, folderPath: string, messageCount: number) {
  const knownCounts = observedFolderCounts.get(accountId) || new Map<string, number>();
  knownCounts.set(folderPath, messageCount);
  observedFolderCounts.set(accountId, knownCounts);
}

async function runWatchLoop(accountId: number, signal: AbortSignal) {
  while (!signal.aborted) {
    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account || !account.isEnabled) return;
    const provider = providerForAccount(account);
    try {
      await provider.watchInbox(
        account,
        {
          onMessage: async (remote) => {
            const existedBefore = db
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.accountId, accountId),
                  eq(messages.providerMessageId, remote.providerMessageId)
                )
              )
              .get();
            const inserted = upsertRemoteMessage(accountId, remote);
            if (inserted && !existedBefore) {
              const uid = messageUid(remote.providerMessageId);
              if (uid > 0) {
                const now = nowIso();
                db.insert(folderSyncState)
                  .values({
                    accountId,
                    folderPath: remote.folderPath,
                    uidValidity: null,
                    highestUid: uid,
                    lastSyncedAt: now,
                    createdAt: now,
                    updatedAt: now
                  })
                  .onConflictDoUpdate({
                    target: [folderSyncState.accountId, folderSyncState.folderPath],
                    set: { highestUid: uid, lastSyncedAt: now, updatedAt: now }
                  })
                  .run();
              }
              await suggestForMessage(inserted.id);
              db.update(accounts)
                .set({
                  lastSyncAt: nowIso(),
                  syncStatus: 'idle',
                  syncError: null,
                  updatedAt: nowIso()
                })
                .where(eq(accounts.id, accountId))
                .run();
              appEvents.emit('sync_complete', { accountId });
            }
          },
          onMailboxChanged: async () => {
            await syncAccount(accountId);
          },
          onError: (error) => {
            db.update(accounts)
              .set({ syncStatus: 'error', syncError: error.message, updatedAt: nowIso() })
              .where(eq(accounts.id, accountId))
              .run();
          }
        },
        signal
      );
      return;
    } catch (error) {
      if (!signal.aborted) {
        console.error(`[dear-robot] Sync engine watch loop failed for account ${accountId}:`, error);
        db.update(accounts)
          .set({
            syncStatus: 'error',
            syncError: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso()
          })
          .where(eq(accounts.id, accountId))
          .run();
        // Increase delay on error to 30 seconds to prevent CPU pinning
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }
}

function upsertRemoteMessage(
  accountId: number,
  remote: {
    providerMessageId: string;
    threadId?: string | null;
    messageIdHeader?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    folderPath: string;
    subject: string;
    from: string;
    to: string;
    cc?: string | null;
    bcc?: string | null;
    date: string;
    bodyText: string;
    bodyHtml?: string | null;
    attachments?: Array<{
      filename: string;
      contentType: string;
      sizeBytes: number;
      contentId?: string | null;
      disposition?: string | null;
      contentBase64?: string | null;
    }>;
    isRead: boolean;
    isAnswered: boolean;
    isFlagged: boolean;
  }
) {
  const saved = db
    .insert(messages)
    .values({
      accountId,
      ...remote,
      messageIdHeader: remote.messageIdHeader ?? null,
      inReplyTo: remote.inReplyTo ?? null,
      references: remote.references ?? null,
      cc: remote.cc ?? null,
      bcc: remote.bcc ?? null,
      bodyHtml: remote.bodyHtml ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
    .onConflictDoUpdate({
      target: [messages.accountId, messages.providerMessageId],
      set: {
        folderPath: remote.folderPath,
        isRead: remote.isRead,
        isAnswered: remote.isAnswered,
        isFlagged: remote.isFlagged,
        updatedAt: nowIso()
      }
    })
    .returning()
    .get();
  if (saved?.id && remote.attachments?.length) {
    db.delete(messageAttachments).where(eq(messageAttachments.messageId, saved.id)).run();
    for (const attachment of remote.attachments) {
      db.insert(messageAttachments)
        .values({
          messageId: saved.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes || 0,
          contentId: attachment.contentId || null,
          disposition: attachment.disposition || null,
          contentBase64: attachment.contentBase64 || null,
          createdAt: nowIso()
        })
        .run();
    }
  }
  return saved;
}

function messageUid(providerMessageId: string) {
  const last = providerMessageId.split(':').at(-1) || '';
  const uid = Number(last);
  return Number.isFinite(uid) ? uid : 0;
}

function mergeByProviderMessageId<T extends { providerMessageId: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.providerMessageId, row);
  return [...map.values()];
}
