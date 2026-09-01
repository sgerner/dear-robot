import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  deleteBrowserProfile,
  getBrowserProfile,
  updateBrowserProfile
} from '$lib/server/browser';

const IdSchema = z.coerce.number().int().positive();
const BrowserProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    startUrl: z.string().trim().url().max(2048).optional(),
    allowedHosts: z.array(z.string().trim().min(1).max(253)).max(32).optional(),
    username: z.string().trim().max(500).optional(),
    password: z.string().max(4000).optional(),
    enabled: z.boolean().optional()
  })
  .strict();

function profileId(raw: string) {
  const parsed = IdSchema.safeParse(raw);
  if (!parsed.success) throw error(400, 'Invalid browser profile id');
  return parsed.data;
}

export function GET({ params }) {
  const profile = getBrowserProfile(profileId(params.id));
  if (!profile) throw error(404, 'Browser profile not found');
  return json({ profile });
}

export async function PATCH({ params, request }) {
  try {
    const id = profileId(params.id);
    const body = await request.json();
    const input = BrowserProfileUpdateSchema.parse({
      ...body,
      allowedHosts:
        typeof body?.allowedHosts === 'string'
          ? body.allowedHosts
              .split(',')
              .map((host: string) => host.trim())
              .filter(Boolean)
          : body?.allowedHosts
    });
    const profile = updateBrowserProfile(id, input);
    if (!profile) throw error(404, 'Browser profile not found');
    return json({ profile });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw error(400, err instanceof Error ? err.message : 'Browser profile update failed');
  }
}

export async function DELETE({ params }) {
  const deleted = await deleteBrowserProfile(profileId(params.id));
  if (!deleted) throw error(404, 'Browser profile not found');
  return json({ ok: true });
}
