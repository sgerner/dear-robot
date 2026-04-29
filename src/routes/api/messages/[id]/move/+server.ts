import { error, json } from '@sveltejs/kit';
import { MessageMoveSchema, moveMessage } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  try {
    const input = MessageMoveSchema.parse(await request.json());
    return json({ message: await moveMessage(Number(params.id), input.folderPath) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Move failed');
  }
}
