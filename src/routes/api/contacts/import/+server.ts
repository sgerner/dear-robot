import { error, json } from '@sveltejs/kit';
import { ContactImportSchema, importContactsCsv } from '$lib/server/services/messages';

export async function POST({ request }) {
  try {
    const input = ContactImportSchema.parse(await request.json());
    return json(importContactsCsv(input));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid contacts import payload');
  }
}
