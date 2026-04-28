import { error, json } from '@sveltejs/kit';
import { enableAccount } from '$lib/server/services/accounts';
import { startSyncWorkerForAccount } from '$lib/server/sync';

export async function POST({ params }) {
  const account = enableAccount(Number(params.id));
  if (!account) throw error(404, 'Account not found');
  startSyncWorkerForAccount(account.id);
  return json({ account });
}
