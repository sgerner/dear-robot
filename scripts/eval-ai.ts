import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { generateEmailSuggestion } from '../src/lib/server/ai/provider';
import { EmailSuggestionSchema } from '../src/lib/server/ai/schema';

const fixturePath = path.join(process.cwd(), 'tests/fixtures/emails.json');
const instructionsPath = path.join(process.cwd(), 'tests/fixtures/AGENT_INSTRUCTIONS.md');
const emails = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{
  id: string;
  subject: string;
  from: string;
  to: string;
  cc?: string | null;
  date: string;
  body_text: string;
}>;
const agentInstructions = fs.readFileSync(instructionsPath, 'utf8');
const rows: Array<{ id: string; category: string; action: string; risk: string; provider: string }> = [];

for (const email of emails) {
  const result = await generateEmailSuggestion({
    agentInstructions,
    subject: email.subject,
    sender: email.from,
    recipients: email.to,
    cc: email.cc ?? null,
    date: email.date,
    bodyText: email.body_text,
    availableFolders: ['INBOX', 'Newsletters', 'Receipts', 'Spam Review', 'Archive', 'Trash']
  });
  const suggestion = EmailSuggestionSchema.parse(result.suggestion);
  rows.push({
    id: email.id,
    category: suggestion.category,
    action: suggestion.recommended_action,
    risk: suggestion.risk_level,
    provider: result.provider
  });
  console.log(JSON.stringify({ id: email.id, result }, null, 2));
}

console.log('\nSummary');
console.table(rows);
