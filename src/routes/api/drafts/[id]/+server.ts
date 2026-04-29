import { error, json } from '@sveltejs/kit';
import { deleteDraft } from '$lib/server/services/messages';

export function DELETE({ params }) {
  const removed = deleteDraft(Number(params.id));
  if (!removed) throw error(404, 'Draft not found');
  return json({ draft: removed });
}
