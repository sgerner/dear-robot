import { error, json } from '@sveltejs/kit';
import {
  AgentLoopResumeSchema,
  cancelAgentToolLoop,
  resumeAgentToolLoop,
  runAgentToolLoop
} from '$lib/server/agent/loop';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { agentLoopSessions } from '$lib/server/db/schema';
import { parseJson } from '$lib/server/agent/runtime';

export function GET({ url }) {
  const sessionId = Number(url.searchParams.get('sessionId'));
  if (!sessionId) throw error(400, 'sessionId is required');
  const session = db.select().from(agentLoopSessions).where(eq(agentLoopSessions.id, sessionId)).get();
  if (!session) throw error(404, 'Agent loop session not found');
  return json({
    sessionId: session.id,
    messageId: session.messageId,
    status: session.status,
    prompt: session.prompt,
    transcript: parseJson(session.transcriptJson, []),
    pendingApprovals: parseJson(session.pendingApprovalsJson, []),
    provider: session.provider,
    model: session.model,
    turns: session.turnCount,
    errorMessage: session.errorMessage
  });
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    if (body?.sessionId) {
      return json(
        await resumeAgentToolLoop(Number(body.sessionId), AgentLoopResumeSchema.parse(body))
      );
    }
    return json(await runAgentToolLoop(body));
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Agent loop failed');
  }
}

export async function DELETE({ url }) {
  const sessionId = Number(url.searchParams.get('sessionId'));
  if (!sessionId) throw error(400, 'sessionId is required');
  const result = cancelAgentToolLoop(sessionId);
  if (!result) throw error(404, 'Agent loop session not found');
  return json(result);
}
