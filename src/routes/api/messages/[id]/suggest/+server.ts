import { json } from '@sveltejs/kit';
import { suggestForMessage } from '$lib/server/services/messages';

export async function POST({ params }) {
  return json({ suggestion: await suggestForMessage(Number(params.id)) });
}
