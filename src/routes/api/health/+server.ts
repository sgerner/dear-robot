import { json } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';

export function GET() {
  sqlite.prepare('select 1').get();
  return json({ ok: true });
}
