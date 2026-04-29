import { error, json } from '@sveltejs/kit';
import { DraftUpsertSchema, listDrafts, upsertDraft } from '$lib/server/services/messages';

export function GET({ url }) {
  const accountId = url.searchParams.get('accountId');
  return json({ drafts: listDrafts(accountId ? Number(accountId) : undefined) });
}

export async function POST({ request }) {
  try {
    return json({ draft: upsertDraft(DraftUpsertSchema.parse(await request.json())) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Failed to save draft');
  }
}
