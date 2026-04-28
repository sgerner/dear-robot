import { json } from '@sveltejs/kit';
import { executeSuggestion } from '$lib/server/services/messages';

export async function POST({ params }) {
  return json({ action: await executeSuggestion(Number(params.id)) });
}
