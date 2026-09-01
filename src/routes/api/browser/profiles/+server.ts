import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  createBrowserProfile,
  listBrowserProfiles
} from '$lib/server/browser';

const BrowserProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startUrl: z.string().trim().url().max(2048),
  allowedHosts: z
    .array(z.string().trim().min(1).max(253))
    .max(32)
    .default([]),
  username: z.string().trim().max(500).optional(),
  password: z.string().max(4000).optional(),
  enabled: z.boolean().default(true)
});

export function GET() {
  return json({ profiles: listBrowserProfiles() });
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const input = BrowserProfileInputSchema.parse({
      ...body,
      // Accept a comma-separated value as a small convenience for API clients
      // and the browser manager form.
      allowedHosts:
        typeof body?.allowedHosts === 'string'
          ? body.allowedHosts
              .split(',')
              .map((host: string) => host.trim())
              .filter(Boolean)
          : body?.allowedHosts
    });
    return json({ profile: createBrowserProfile(input) }, { status: 201 });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Browser profile creation failed');
  }
}
