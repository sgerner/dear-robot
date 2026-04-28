import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { defaultAgentInstructions, readAgentInstructions, writeAgentInstructions } from '$lib/server/memory';

const MemorySchema = z.object({ markdown: z.string().min(1).max(100000) });

export function GET() {
  return json({ markdown: readAgentInstructions(), defaultMarkdown: defaultAgentInstructions });
}

export async function POST({ request }) {
  const input = MemorySchema.parse(await request.json());
  writeAgentInstructions(input.markdown);
  return json({ ok: true, markdown: readAgentInstructions() });
}
