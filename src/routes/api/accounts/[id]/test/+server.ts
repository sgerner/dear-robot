import { json } from '@sveltejs/kit';
import { testAccount } from '$lib/server/services/accounts';

export async function POST({ params }) {
  return json(await testAccount(Number(params.id)));
}
