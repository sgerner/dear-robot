import type { EmailSuggestionInput } from './schema';

export const DEAR_ROBOT_PROMPT_VERSION = 'dear-robot-v1';

export function buildSuggestionMessages(input: EmailSuggestionInput) {
  const body =
    input.bodyText.length > 12000
      ? `${input.bodyText.slice(0, 12000)}\n[truncated]`
      : input.bodyText;
  return [
    {
      role: 'system',
      content: `You are Dear Robot, a review-first AI email assistant. Return strict JSON only. Never execute actions.

Required JSON fields:
category string
confidence number 0..1
recommended_action one of reply, forward, move_to_folder, delete, spam, delegate, archive, no_action
target_folder string or null
draft_reply string or null
forward_to string or null
delegate_instructions string or null
reasoning_summary string
risk_level one of low, medium, high

Safety rules:
- Legal, financial, HR, medical, taxes, contracts, refunds, chargebacks, angry customers, or sensitive personal information must be medium or high risk.
- Never recommend sending confidential information unless explicitly present in the user's instructions.
- Never recommend permanent deletion.
- High risk suggestions are allowed but must clearly require review.`
    },
    {
      role: 'user',
      content: `Prompt version: ${DEAR_ROBOT_PROMPT_VERSION}

AGENT_INSTRUCTIONS.md:
${input.agentInstructions}

Memory context:
${input.memoryContext || 'None'}

Related context:
${input.relatedContext || 'None'}

Email:
Subject: ${input.subject}
Sender: ${input.sender}
Recipients: ${input.recipients}
Cc: ${input.cc || ''}
Date: ${input.date}
Available folders: ${input.availableFolders.join(', ')}

Existing suggestion if regenerating:
${input.existingSuggestion ? JSON.stringify(input.existingSuggestion, null, 2) : 'None'}

User regeneration note:
${input.regenerationNote || 'None'}

Body:
${body}`
    }
  ];
}
