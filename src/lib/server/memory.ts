import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export const defaultAgentInstructions = `# Triage Agent Instructions

- Write concise replies in a friendly but direct tone.
- Never auto-send email. Every action requires explicit user approval.
- Move newsletters to Newsletters.
- Move receipts to Receipts.
- Route suspicious emails to Spam Review.
- Angry customers need empathetic replies and medium or high risk.
- Complex requests should be drafted but marked medium risk.
- Do not share confidential information unless it is explicitly provided in the email and requested by the user.
`;

export function agentInstructionsPath() {
  return path.join(env.DATA_DIR, 'AGENT_INSTRUCTIONS.md');
}

export function ensureAgentInstructions() {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  const target = agentInstructionsPath();
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, defaultAgentInstructions, 'utf8');
  }
}

export function readAgentInstructions() {
  ensureAgentInstructions();
  return fs.readFileSync(agentInstructionsPath(), 'utf8');
}

export function writeAgentInstructions(markdown: string) {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(agentInstructionsPath(), markdown, 'utf8');
}
