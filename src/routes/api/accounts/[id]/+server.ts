import { json } from '@sveltejs/kit';
import { removeAccount } from '$lib/server/services/accounts';

export function DELETE({ params }) {
  return json({ ok: removeAccount(Number(params.id)) });
}
