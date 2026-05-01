import { json } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { executedActions, toolCalls } from '$lib/server/db/schema';
import { getMemoryOverview } from '$lib/server/memory-learning';

export function GET() {
  const actions = db.select().from(executedActions).orderBy(desc(executedActions.createdAt)).limit(60).all();
  const calls = db.select().from(toolCalls).orderBy(desc(toolCalls.createdAt)).limit(60).all();
  const memory = getMemoryOverview();
  return json({
    actions,
    toolCalls: calls,
    memoryEvents: memory.events
  });
}

