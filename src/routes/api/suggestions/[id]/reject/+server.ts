import { error, json } from '@sveltejs/kit';
import { rejectSuggestion } from '$lib/server/services/messages';

export function POST({ params }) {
  const suggestion = rejectSuggestion(Number(params.id));
  if (!suggestion) throw error(404, 'Suggestion not found');
  return json({ suggestion });
}
