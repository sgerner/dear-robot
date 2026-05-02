import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { db, nowIso } from './db';
import { memoryEvents, memoryExamples, memoryProfile, memoryRules, messages } from './db/schema';
import { readGlobalSkillsMarkdown, truncateMarkdown } from './skills';

const DEFAULT_CORE_PROFILE = `- Write concise replies in a friendly but direct tone.
- Never auto-send email. Every action requires explicit approval.
- Use clear next steps and timelines when possible.
- Treat legal, financial, contract, HR, and personal-data topics as medium/high risk.
`;

export function getOrCreateMemoryProfile() {
  const existing = db.select().from(memoryProfile).where(eq(memoryProfile.id, 1)).get();
  if (existing) return existing;
  const now = nowIso();
  return db
    .insert(memoryProfile)
    .values({
      id: 1,
      coreProfile: DEFAULT_CORE_PROFILE,
      advancedMode: false,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
}

export function getMemoryOverview() {
  const profile = getOrCreateMemoryProfile();
  const rules = db.select().from(memoryRules).where(eq(memoryRules.isActive, true)).orderBy(desc(memoryRules.updatedAt)).limit(20).all();
  const examples = db.select().from(memoryExamples).orderBy(desc(memoryExamples.createdAt)).limit(12).all();
  const events = db.select().from(memoryEvents).orderBy(desc(memoryEvents.createdAt)).limit(20).all();
  return { profile, rules, examples, events };
}

export function updateCoreProfile(coreProfile: string) {
  const now = nowIso();
  const row = getOrCreateMemoryProfile();
  return db
    .update(memoryProfile)
    .set({ coreProfile, updatedAt: now })
    .where(eq(memoryProfile.id, row.id))
    .returning()
    .get();
}

export function setMemoryAdvancedMode(enabled: boolean) {
  const now = nowIso();
  const row = getOrCreateMemoryProfile();
  return db
    .update(memoryProfile)
    .set({ advancedMode: enabled, updatedAt: now })
    .where(eq(memoryProfile.id, row.id))
    .returning()
    .get();
}

export function deleteMemoryRule(id: number) {
  return db.update(memoryRules).set({ isActive: false, updatedAt: nowIso() }).where(eq(memoryRules.id, id)).run();
}

export function buildMemoryPromptContext(input: { subject: string; bodyText: string; note?: string | null }) {
  const profile = getOrCreateMemoryProfile();
  const skillsMarkdown = readGlobalSkillsMarkdown();
  const query = `${input.subject} ${input.bodyText.slice(0, 1200)} ${input.note || ''}`.toLowerCase();
  const keywords = query
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9_-]/g, ''))
    .filter((part) => part.length > 3)
    .slice(0, 10);
  const ruleWhere = keywords.length
    ? and(
        eq(memoryRules.isActive, true),
        or(...keywords.map((keyword) => like(memoryRules.scope, `%${keyword}%`)), ...keywords.map((keyword) => like(memoryRules.ruleText, `%${keyword}%`)))
      )
    : eq(memoryRules.isActive, true);
  const rules = db.select().from(memoryRules).where(ruleWhere).orderBy(desc(memoryRules.confidence), desc(memoryRules.usageCount)).limit(6).all();
  const exampleWhere = keywords.length
    ? or(...keywords.map((keyword) => like(memoryExamples.scope, `%${keyword}%`)), ...keywords.map((keyword) => like(memoryExamples.afterText, `%${keyword}%`)))
    : undefined;
  const examples = db.select().from(memoryExamples).where(exampleWhere).orderBy(desc(memoryExamples.score), desc(memoryExamples.createdAt)).limit(2).all();
  return {
    coreProfile: profile.coreProfile,
    skillsMarkdown,
    rules,
    examples,
    text: renderMemoryContext(profile.coreProfile, skillsMarkdown, rules, examples)
  };
}

export function recordMemoryEvent(input: {
  eventType: 'suggestion_edit' | 'suggestion_regenerate' | 'task_edit';
  messageId: number;
  suggestionId?: number | null;
  beforeText: string;
  afterText: string;
  note?: string | null;
}) {
  const now = nowIso();
  const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();
  const scope = deriveScope(message?.subject || '', message?.from || '', input.note || '', message?.folderPath || '');
  const event = db
    .insert(memoryEvents)
    .values({
      eventType: input.eventType,
      messageId: input.messageId,
      suggestionId: input.suggestionId ?? null,
      contextJson: JSON.stringify({
        subject: message?.subject || '',
        from: message?.from || '',
        folderPath: message?.folderPath || '',
        note: input.note || null
      }),
      beforeText: truncate(input.beforeText, 2400),
      afterText: truncate(input.afterText, 2400),
      note: input.note || null,
      createdAt: now
    })
    .returning()
    .get();
  db.insert(memoryExamples)
    .values({
      eventId: event.id,
      scope,
      beforeText: truncate(input.beforeText, 1800),
      afterText: truncate(input.afterText, 1800),
      note: input.note || null,
      score: heuristicScore(input.beforeText, input.afterText, input.note || ''),
      createdAt: now,
      updatedAt: now
    })
    .run();
  const candidateRule = deriveRule(input.beforeText, input.afterText, input.note || null, scope);
  if (!candidateRule) return event;
  const existing = db
    .select()
    .from(memoryRules)
    .where(and(eq(memoryRules.scope, candidateRule.scope), eq(memoryRules.ruleText, candidateRule.ruleText)))
    .get();
  if (existing) {
    db.update(memoryRules)
      .set({
        confidence: Math.min(0.99, existing.confidence + 0.05),
        usageCount: existing.usageCount + 1,
        lastSeenAt: now,
        isActive: true,
        updatedAt: now
      })
      .where(eq(memoryRules.id, existing.id))
      .run();
  } else {
    db.insert(memoryRules)
      .values({
        kind: candidateRule.kind,
        scope: candidateRule.scope,
        ruleText: candidateRule.ruleText,
        confidence: candidateRule.confidence,
        usageCount: 1,
        lastSeenAt: now,
        sourceEventId: event.id,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run();
  }
  return event;
}

function renderMemoryContext(
  coreProfile: string,
  skillsMarkdown: string,
  rules: Array<typeof memoryRules.$inferSelect>,
  examples: Array<typeof memoryExamples.$inferSelect>
) {
  const lines: string[] = [];
  lines.push('Core profile:');
  lines.push(coreProfile.trim());
  const skillsText = truncateMarkdown(skillsMarkdown, 2600);
  if (skillsText) {
    lines.push('\nSkills:');
    lines.push(skillsText);
  }
  if (rules.length) {
    lines.push('\nLearned rules:');
    for (const rule of rules) lines.push(`- (${rule.confidence.toFixed(2)}) ${rule.ruleText}`);
  }
  if (examples.length) {
    lines.push('\nRelevant examples:');
    for (const example of examples) {
      lines.push(`- Scope: ${example.scope || 'general'}`);
      lines.push(`  Before: ${truncate(example.beforeText, 220)}`);
      lines.push(`  After: ${truncate(example.afterText, 220)}`);
    }
  }
  return lines.join('\n');
}

function deriveRule(beforeText: string, afterText: string, note: string | null, scope: string) {
  const before = beforeText.trim();
  const after = afterText.trim();
  if (!before || !after || before === after) return null;
  if (note && note.trim().length >= 4 && note.trim().length <= 140) {
    return { kind: 'note_preference', scope, ruleText: `When editing drafts, prioritize: ${note.trim()}.`, confidence: 0.7 };
  }
  if (after.length < before.length * 0.8) {
    return { kind: 'style', scope, ruleText: 'Prefer shorter and more concise drafts.', confidence: 0.66 };
  }
  if (/^hi\b|^hello\b/i.test(after) && !/^hi\b|^hello\b/i.test(before)) {
    return { kind: 'tone', scope, ruleText: 'Start customer-facing replies with a warm greeting.', confidence: 0.62 };
  }
  if (/next step|timeline|by\s+\w+/i.test(after) && !/next step|timeline|by\s+\w+/i.test(before)) {
    return { kind: 'structure', scope, ruleText: 'Include explicit next steps or timeline commitments when possible.', confidence: 0.64 };
  }
  return null;
}

function deriveScope(subject: string, from: string, note: string, folderPath: string) {
  const joined = `${subject} ${from} ${note} ${folderPath}`.toLowerCase();
  if (joined.includes('refund') || joined.includes('chargeback')) return 'refund';
  if (joined.includes('wholesale') || joined.includes('pricing') || joined.includes('quote')) return 'sales';
  if (joined.includes('newsletter')) return 'newsletter';
  if (joined.includes('contract') || joined.includes('legal')) return 'legal';
  return 'general';
}

function heuristicScore(beforeText: string, afterText: string, note: string) {
  let score = 0.5;
  if (note.trim().length > 3) score += 0.15;
  const delta = Math.abs(afterText.length - beforeText.length);
  if (delta > 20) score += 0.1;
  if (afterText !== beforeText) score += 0.15;
  return Math.min(1, score);
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function memoryOnboardingState() {
  const profile = getOrCreateMemoryProfile();
  const hasCoreProfile = profile.coreProfile.trim().length > 20;
  const hasSkills = readGlobalSkillsMarkdown().trim().length > 20;
  const hasLearnedRules = (db.select({ count: sql<number>`count(*)` }).from(memoryRules).where(eq(memoryRules.isActive, true)).get()?.count || 0) > 0;
  return {
    hasCoreProfile,
    hasSkills,
    hasLearnedRules,
    needsCoreProfile: !hasCoreProfile,
    needsSkills: !hasSkills
  };
}
