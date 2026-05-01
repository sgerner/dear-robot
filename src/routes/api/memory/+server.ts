import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { defaultAgentInstructions, readAgentInstructions, writeAgentInstructions } from '$lib/server/memory';
import {
  deleteMemoryRule,
  getMemoryOverview,
  memoryOnboardingState,
  setMemoryAdvancedMode,
  updateCoreProfile
} from '$lib/server/memory-learning';

const MemorySchema = z.object({ markdown: z.string().min(1).max(100000) });
const MemoryActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_markdown'), markdown: z.string().min(1).max(100000) }),
  z.object({ action: z.literal('save_core_profile'), coreProfile: z.string().min(1).max(10000) }),
  z.object({ action: z.literal('set_advanced_mode'), enabled: z.boolean() }),
  z.object({ action: z.literal('delete_rule'), id: z.coerce.number().int().positive() })
]);

export function GET() {
  return json({
    markdown: readAgentInstructions(),
    defaultMarkdown: defaultAgentInstructions,
    memoryOverview: getMemoryOverview(),
    memoryOnboarding: memoryOnboardingState()
  });
}

export async function POST({ request }) {
  const payload = await request.json();
  if (payload && !payload.action) {
    const input = MemorySchema.parse(payload);
    writeAgentInstructions(input.markdown);
    return json({ ok: true, markdown: readAgentInstructions(), memoryOverview: getMemoryOverview() });
  }
  const input = MemoryActionSchema.parse(payload);
  if (input.action === 'save_markdown') writeAgentInstructions(input.markdown);
  if (input.action === 'save_core_profile') updateCoreProfile(input.coreProfile);
  if (input.action === 'set_advanced_mode') setMemoryAdvancedMode(input.enabled);
  if (input.action === 'delete_rule') deleteMemoryRule(input.id);
  return json({
    ok: true,
    markdown: readAgentInstructions(),
    memoryOverview: getMemoryOverview(),
    memoryOnboarding: memoryOnboardingState()
  });
}
