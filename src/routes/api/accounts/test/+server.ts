import { json } from '@sveltejs/kit';
import { AccountInputSchema, testAccountInput } from '$lib/server/services/accounts';

export async function POST({ request }) {
  const input = AccountInputSchema.parse(await request.json());
  return json(await testAccountInput(input));
}
