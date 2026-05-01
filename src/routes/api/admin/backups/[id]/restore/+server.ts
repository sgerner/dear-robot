import { error, json } from '@sveltejs/kit';
import { restoreBackup } from '$lib/server/backup';

export async function POST({ params }) {
  try {
    return json({ result: restoreBackup(String(params.id)) });
  } catch (err) {
    throw error(500, err instanceof Error ? err.message : 'Failed to restore backup');
  }
}

