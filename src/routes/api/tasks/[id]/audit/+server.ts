import { error, json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { agentAuditEvents, taskRuns } from '$lib/server/db/schema';
import { parseJson } from '$lib/server/agent/runtime';

export function GET({ params }) {
  const id = Number(params.id);
  const run = db.select({ id: taskRuns.id }).from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) throw error(404, 'Task not found');
  const events = db
    .select()
    .from(agentAuditEvents)
    .where(and(eq(agentAuditEvents.taskRunId, id)))
    .orderBy(asc(agentAuditEvents.createdAt))
    .all()
    .map((event) => ({ ...event, payload: parseJson(event.payloadJson, {}) }));
  return json({ events });
}
