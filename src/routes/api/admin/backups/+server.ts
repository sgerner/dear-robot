import { error, json } from '@sveltejs/kit';
import { backupLifecyclePolicy, createBackup, listBackups } from '$lib/server/backup';

export function GET() {
  return json({ backups: listBackups(), policy: backupLifecyclePolicy() });
}

export async function POST() {
  try {
    return json({ backup: await createBackup() });
  } catch (err) {
    throw error(500, err instanceof Error ? err.message : 'Failed to create backup');
  }
}
