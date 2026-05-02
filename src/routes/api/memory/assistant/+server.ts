import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { generateStructuredObject } from '$lib/server/ai/provider';
import {
  getMemoryOverview,
  setMemoryAdvancedMode,
  updateCoreProfile
} from '$lib/server/memory-learning';

const RequestSchema = z.object({
  prompt: z.string().min(3).max(2000)
});

const ActionSchema = z.object({
  summary: z.string(),
  updated_core_profile: z.string().nullable(),
  set_advanced_mode: z.boolean().nullable(),
  remove_rule_ids: z.array(z.number().int().positive()).default([]),
  explanation: z.string().min(1)
});

export async function POST({ request }) {
  const { prompt } = RequestSchema.parse(await request.json());
  const overview = getMemoryOverview();
  const rules = overview.rules.map((rule) => ({
    id: rule.id,
    scope: rule.scope,
    text: rule.ruleText,
    confidence: rule.confidence
  }));
  const messages = [
    {
      role: 'system',
      content:
        'You are a memory configuration assistant for an AI-first email client. Return strict JSON only. Keep core profile concise and practical. Never produce markdown.'
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          user_request: prompt,
          current_core_profile: overview.profile.coreProfile,
          advanced_mode: overview.profile.advancedMode,
          active_rules: rules,
          constraints: [
            'Only propose operations user requested or clearly implied',
            'Prefer editing core profile over deleting many rules',
            'If uncertain, keep existing values and explain'
          ]
        },
        null,
        2
      )
    }
  ];

  const result = await generateStructuredObject({
    profile: 'advanced',
    messages,
    schema: ActionSchema,
    allowFallback: true,
    mock: () => ({
      summary: 'No-op fallback',
      updated_core_profile: null,
      set_advanced_mode: null,
      remove_rule_ids: [],
      explanation: 'AI provider unavailable; no memory changes were applied.'
    })
  });

  if (result.object.updated_core_profile) {
    updateCoreProfile(result.object.updated_core_profile);
  }
  if (result.object.set_advanced_mode !== null) {
    setMemoryAdvancedMode(result.object.set_advanced_mode);
  }
  const removeRuleIds = result.object.remove_rule_ids ?? [];
  if (removeRuleIds.length) {
    const { deleteMemoryRule } = await import('$lib/server/memory-learning');
    for (const id of removeRuleIds) deleteMemoryRule(id);
  }

  return json({
    ok: true,
    action: result.object,
    provider: result.provider,
    model: result.model,
    memoryOverview: getMemoryOverview()
  });
}
