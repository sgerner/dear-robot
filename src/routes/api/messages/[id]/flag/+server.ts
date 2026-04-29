import { error, json } from '@sveltejs/kit';
import { MessageFlagSchema, setMessageFlagged } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  try {
    const input = MessageFlagSchema.parse(await request.json());
    return json({ message: await setMessageFlagged(Number(params.id), input.flagged) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Flag update failed');
  }
}
