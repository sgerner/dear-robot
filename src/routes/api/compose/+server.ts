import { error, json } from '@sveltejs/kit';
import { ComposeSendSchema, sendComposedMessage } from '$lib/server/services/messages';

export async function POST({ request }) {
  try {
    return json({
      result: await sendComposedMessage(ComposeSendSchema.parse(await request.json()))
    });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Send failed');
  }
}
