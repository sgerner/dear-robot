import { error, json } from '@sveltejs/kit';
import { SuggestionEditSchema, editSuggestion } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  const suggestion = editSuggestion(Number(params.id), SuggestionEditSchema.parse(await request.json()));
  if (!suggestion) throw error(404, 'Suggestion not found');
  return json({ suggestion });
}
