import { error, json } from '@sveltejs/kit';
import { MessageReadSchema, setMessageRead } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  try {
    const input = MessageReadSchema.parse(await request.json());
    return json({ message: await setMessageRead(Number(params.id), input.read) });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Read-state update failed');
  }
}
