import { json } from '@sveltejs/kit';
import { listFoldersWithCounts } from '$lib/server/services/messages';

export function GET({ url }) {
  const accountId = url.searchParams.get('accountId');
  return json({ folders: listFoldersWithCounts(accountId ? Number(accountId) : undefined) });
}
