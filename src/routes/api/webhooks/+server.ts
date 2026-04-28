import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, nowIso } from '$lib/server/db';
import { webhookSubscriptions } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

const WebhookSchema = z.object({
  eventType: z.string().min(1).default('delegate'),
  targetUrl: z.string().url(),
  secret: z.string().nullable().optional()
});

export function GET() {
  return json({ webhooks: db.select().from(webhookSubscriptions).orderBy(desc(webhookSubscriptions.createdAt)).all() });
}

export async function POST({ request }) {
  const input = WebhookSchema.parse(await request.json());
  const now = nowIso();
  const webhook = db
    .insert(webhookSubscriptions)
    .values({
      eventType: input.eventType,
      targetUrl: input.targetUrl,
      secret: input.secret || null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return json({ webhook }, { status: 201 });
}
