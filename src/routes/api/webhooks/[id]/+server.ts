import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { webhookSubscriptions } from '$lib/server/db/schema';

export function DELETE({ params }) {
  const result = db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, Number(params.id))).run();
  return json({ ok: result.changes > 0 });
}
