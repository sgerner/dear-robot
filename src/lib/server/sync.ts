import { eq } from 'drizzle-orm';
import { db, nowIso } from './db';
import { accounts, folders, messages } from './db/schema';
import { providerForAccount } from './email/provider';
import { suggestForMessage } from './services/messages';

type WorkerState = {
  abortController: AbortController;
  pollTimer: NodeJS.Timeout;
};

const workers = new Map<number, WorkerState>();
let initialized = false;

export function startSyncEngine() {
  if (initialized) return;
  initialized = true;
  const enabled = db.select().from(accounts).where(eq(accounts.isEnabled, true)).all();
  for (const account of enabled) startSyncWorkerForAccount(account.id);
}

export function startSyncWorkerForAccount(accountId: number) {
  if (workers.has(accountId)) return;
  const abortController = new AbortController();
  void runWatchLoop(accountId, abortController.signal);
  void syncAccount(accountId);
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
}

export async function syncAccount(accountId: number) {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || !account.isEnabled) return;
  const provider = providerForAccount(account);
  const now = nowIso();
  db.update(accounts).set({ syncStatus: 'syncing', syncError: null, updatedAt: now }).where(eq(accounts.id, accountId)).run();
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
    const remoteMessages = await provider.backfill(account, 100);
    for (const remote of remoteMessages) {
      const inserted = db
        .insert(messages)
        .values({
          accountId,
          ...remote,
          cc: remote.cc ?? null,
          bodyHtml: remote.bodyHtml ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
        .onConflictDoNothing()
        .returning()
        .get();
      if (inserted) {
        void suggestForMessage(inserted.id).catch((error) => {
          console.error('[triage] AI evaluation failed for inserted message', inserted.id, error);
        });
      }
    }
    db.update(accounts)
      .set({ syncStatus: 'idle', syncError: null, lastSyncAt: nowIso(), updatedAt: nowIso() })
      .where(eq(accounts.id, accountId))
      .run();
  } catch (error) {
    db.update(accounts)
      .set({
        syncStatus: 'error',
        syncError: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      })
      .where(eq(accounts.id, accountId))
      .run();
  }
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
            const inserted = db
              .insert(messages)
              .values({
                accountId,
                ...remote,
                cc: remote.cc ?? null,
                bodyHtml: remote.bodyHtml ?? null,
                createdAt: nowIso(),
                updatedAt: nowIso()
              })
              .onConflictDoNothing()
              .returning()
              .get();
            if (inserted) {
              await suggestForMessage(inserted.id);
              db.update(accounts)
                .set({ lastSyncAt: nowIso(), syncStatus: 'idle', syncError: null, updatedAt: nowIso() })
                .where(eq(accounts.id, accountId))
                .run();
            }
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
        db.update(accounts)
          .set({
            syncStatus: 'error',
            syncError: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso()
          })
          .where(eq(accounts.id, accountId))
          .run();
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
