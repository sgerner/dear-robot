import { error, json } from '@sveltejs/kit';
import { uploadFarinFile } from '$lib/server/farin';

export async function POST({ request }) {
  try {
    return json(await uploadFarinFile(await request.json()));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Farin upload failed');
  }
}
