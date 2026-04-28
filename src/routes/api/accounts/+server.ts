import { json } from '@sveltejs/kit';
import { AccountInputSchema, createAccount, listAccounts } from '$lib/server/services/accounts';

export function GET() {
  return json({ accounts: listAccounts() });
}

export async function POST({ request }) {
  const input = AccountInputSchema.parse(await request.json());
  return json({ account: createAccount(input) }, { status: 201 });
}
