import type { EmailSuggestion } from '../ai/schema';
import { truncateMarkdown } from '../skills';

export function buildAgentPlanMessages(input: {
  agentInstructions: string;
  memoryContext: string;
  subject: string;
  sender: string;
  recipients: string;
  cc: string | null;
  date: string;
  bodyText: string;
  availableFolders: string[];
  existingSuggestion: EmailSuggestion | null;
  note: string | null;
  relatedEmailContext: Array<{
    id: number;
    date: string;
    from: string;
    subject: string;
    folderPath: string;
    snippet: string;
  }>;
  obligations: Array<{
    id: number;
    title: string;
    evidence: string;
    dueAt: string | null;
    kind: string;
    owner: string;
  }>;
  recentOutcomes: Array<{
    outcomeType: string;
    notes: string | null;
    createdAt: string;
  }>;
  threadSummary: {
    summary: string;
    openQuestions: string;
    commitments: string;
    nextAction: string;
    urgency: string;
  } | null;
  tools: Array<{
    name: string;
    description: string;
    kind: string;
    readOnly: boolean;
    skillsMarkdown?: string | null;
  }>;
}) {
  const body =
    input.bodyText.length > 16000
      ? `${input.bodyText.slice(0, 16000)}\n[truncated]`
      : input.bodyText;
  const toolsList = input.tools.length
    ? input.tools
        .map((tool) => {
          const lines = [
            `- ${tool.name} (${tool.kind}, ${tool.readOnly ? 'read-only' : 'read/write'}): ${tool.description}`
          ];
          const playbook = truncateMarkdown(tool.skillsMarkdown || '', 1200);
          if (playbook) {
            lines.push(`  skills.md:\n${indent(playbook, '  ')}`);
          }
          return lines.join('\n');
        })
        .join('\n')
    : '- none';
  const obsidianNote = input.tools.some((tool) => tool.name === 'obsidian_vault')
    ? '\nObsidian vault guidance: search the vault before asking for repeated context, and write short dated notes for durable decisions, commitments, and important facts.'
    : '';
  return [
    {
      role: 'system',
      content: `You are Dear Robot Agent Planner. Output strict JSON only.

Create a practical multi-step plan to handle the email as a task workflow.
Never execute actions.
Prefer using available tools only when genuinely useful.
Default to requiring user approval.

JSON schema:
{
  "summary": "string",
  "complexity": "simple|advanced",
  "requires_user_approval": true,
  "final_reply_draft": "string|null",
  "max_turns": 8,
  "steps": [
    {
      "title": "string",
      "kind": "draft_reply|send_reply|move_to_folder|tool_call|delegate|mark_done|notify",
      "details": "string",
      "tool_name": "string|null",
      "tool_input": {},
      "depends_on": [1],
      "condition": {"path":"steps.1.output.ok","operator":"equals","value":true},
      "output_key": "lookup",
      "max_attempts": 3,
      "retry_delay_ms": 1000,
      "requires_approval": true,
      "risk_level": "low|medium|high"
    }
  ]
}

Safety:
- legal/financial/hr/medical/tax/contract/refund/chargeback/sensitive personal data => medium/high risk.
- never auto-send.
- never permanently delete.
- use dependencies and output_key when one step needs the result of another.
- use conditions only for deterministic checks against prior step outputs; never invent executable expressions.
- if uncertain, ask for approval in the plan.
- for advanced tasks, use related emails outside the thread when relevant.
- prefer mailbox_search when you need historical context by sender, subject, or topic.`
    },
    {
      role: 'user',
      content: `AGENT_INSTRUCTIONS.md:
${input.agentInstructions}

Memory context:
${input.memoryContext || 'None'}

Email:
Subject: ${input.subject}
Sender: ${input.sender}
Recipients: ${input.recipients}
Cc: ${input.cc || ''}
Date: ${input.date}
Available folders: ${input.availableFolders.join(', ')}

Existing suggestion:
${input.existingSuggestion ? JSON.stringify(input.existingSuggestion, null, 2) : 'None'}

Related emails outside current thread:
${input.relatedEmailContext.length ? JSON.stringify(input.relatedEmailContext, null, 2) : 'None'}

Known obligations:
${input.obligations.length ? JSON.stringify(input.obligations, null, 2) : 'None'}

Thread intelligence:
${input.threadSummary ? JSON.stringify(input.threadSummary, null, 2) : 'None'}

Recent outcomes:
${input.recentOutcomes.length ? JSON.stringify(input.recentOutcomes, null, 2) : 'None'}

User note:
${input.note || 'None'}

Available tools:
${toolsList}${obsidianNote}

Body:
${body}`
    }
  ] as Array<{ role: string; content: string }>;
}

function indent(value: string, prefix: string) {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
