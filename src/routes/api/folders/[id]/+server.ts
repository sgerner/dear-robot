import { error, json } from '@sveltejs/kit';
import { FolderRoleSchema, updateFolderRole } from '$lib/server/services/messages';

export async function POST({ params, request }) {
  try {
    const input = FolderRoleSchema.parse(await request.json());
    const folder = updateFolderRole(Number(params.id), input.role ?? null);
    if (!folder) throw new Error('Folder not found');
    return json({ folder });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Folder role update failed');
  }
}
