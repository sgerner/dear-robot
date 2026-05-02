import { error, json } from '@sveltejs/kit';
import { createBackup, listBackups } from '$lib/server/backup';

export function GET() {
  return json({ backups: listBackups() });
}

export async function POST() {
  try {
    return json({ backup: await createBackup() });
  } catch (err) {
    throw error(500, err instanceof Error ? err.message : 'Failed to create backup');
  }
}
