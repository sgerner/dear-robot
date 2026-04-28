import { error, json } from '@sveltejs/kit';
import { disableAccount } from '$lib/server/services/accounts';

export async function POST({ params }) {
  const account = disableAccount(Number(params.id));
  if (!account) throw error(404, 'Account not found');
  return json({ account });
}
