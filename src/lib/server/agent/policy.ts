import type { RecommendedAction } from '../ai/schema';

export type AgentPolicyDecision = {
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  reasons: string[];
};

export function assessAgentAction(input: {
  action:
    | RecommendedAction
    | 'tool_call'
    | 'browser_recipe'
    | 'farin_upload'
    | 'draft_reply'
    | 'send_reply'
    | 'mark_done'
    | 'notify';
  subject?: string | null;
  bodyText?: string | null;
  toolReadOnly?: boolean | null;
  confidence?: number | null;
}) {
  const haystack = `${input.subject || ''}\n${input.bodyText || ''}`.toLowerCase();
  const reasons: string[] = [];
  let riskLevel: AgentPolicyDecision['riskLevel'] = 'low';
  if (/(legal|contract|tax|medical|health|hr|ssn|password|bank|wire|chargeback)/.test(haystack)) {
    riskLevel = 'high';
    reasons.push('Sensitive or high-impact topic detected.');
  } else if (/(refund|invoice|payment|pricing|deadline|angry|complaint)/.test(haystack)) {
    riskLevel = 'medium';
    reasons.push('Business-critical or time-sensitive topic detected.');
  }
  if (['reply', 'forward', 'delegate', 'send_reply'].includes(input.action)) {
    reasons.push('External communication requires review.');
  }
  if (input.action === 'delete') {
    riskLevel = 'high';
    reasons.push('Delete maps to trash, but still requires review.');
  }
  if (input.action === 'tool_call' && !input.toolReadOnly) {
    riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    reasons.push('Write-capable tool call requires review.');
  }
  if (input.action === 'browser_recipe') {
    // A browser can navigate, expose a logged-in session, and download data.
    // Keep the action reviewable even when the recipe itself is read-only.
    riskLevel = riskLevel === 'high' ? 'high' : 'medium';
    reasons.push('Browser automation can access authenticated third-party data and download files.');
  }
  if (input.action === 'farin_upload') {
    riskLevel = 'high';
    reasons.push('Uploading a file to Farin is an external write and requires review.');
  }
  if (typeof input.confidence === 'number' && input.confidence < 0.72) {
    riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
    reasons.push('Low confidence recommendation.');
  }
  return {
    riskLevel,
    requiresApproval:
      riskLevel !== 'low' ||
      ['reply', 'forward', 'delegate', 'send_reply', 'delete'].includes(input.action) ||
      (input.action === 'tool_call' && !input.toolReadOnly) ||
      input.action === 'browser_recipe' ||
      input.action === 'farin_upload',
    reasons: reasons.length ? reasons : ['Low-risk reversible action.']
  } satisfies AgentPolicyDecision;
}
