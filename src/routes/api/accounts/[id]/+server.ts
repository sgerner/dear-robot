import { error, json } from '@sveltejs/kit';
import {
  AccountUpdateSchema,
  removeAccount,
  updateAccount
} from '$lib/server/services/accounts';
import { startSyncWorkerForAccount, stopSyncWorkerForAccount } from '$lib/server/sync';

export function DELETE({ params }) {
  return json({ ok: removeAccount(Number(params.id)) });
}

export async function PATCH({ params, request }) {
  const input = AccountUpdateSchema.parse(await request.json());
  const accountId = Number(params.id);
  stopSyncWorkerForAccount(accountId);
  const account = await updateAccount(accountId, input);
  if (!account) throw error(404, 'Account not found');
  if (account.isEnabled) {
    startSyncWorkerForAccount(account.id);
  }
  return json({ account });
}
