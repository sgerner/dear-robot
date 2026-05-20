import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, nowIso } from '../db';
import { agentObligations, messages } from '../db/schema';

type ObligationKind = 'reply' | 'follow_up' | 'send' | 'review' | 'pay' | 'schedule' | 'other';

type ObligationDraft = {
  owner: 'user' | 'sender' | 'other';
  kind: ObligationKind;
  title: string;
  evidence: string;
  dueAt: string | null;
  confidence: number;
};

const ACTION_REQUEST_RE =
  /\b(action required|need you to|please\s+(reply|respond|review|send|share|confirm|schedule|follow up)|can you\s+(reply|respond|review|send|share|confirm|schedule|follow up|take a look)|could you\s+(reply|respond|review|send|share|confirm|schedule|follow up|take a look))\b/i;
const COMMITMENT_RE =
  /\b(i will|i'll|we will|we'll)\s+(send|follow up|review|call|respond|reply|share|confirm|schedule|get back)\b/i;
const DEADLINE_RE =
  /\b(deadline|due|by\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next week|end of the month|eom|\d{4}-\d{2}-\d{2})\b/i;

export function extractAndStoreObligationsForMessage(messageId: number) {
  try {
    const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
    if (!message) return [];
    const drafts = extractObligationDrafts(message);
    const now = nowIso();
    const saved = [];
    for (const draft of drafts) {
      try {
        const existing = db
          .select()
          .from(agentObligations)
          .where(
            and(
              eq(agentObligations.messageId, message.id),
              eq(agentObligations.title, draft.title),
              inArray(agentObligations.status, ['open', 'done'])
            )
          )
          .get();
        if (existing) {
          saved.push(existing);
          continue;
        }
        saved.push(
          db
            .insert(agentObligations)
            .values({
              messageId: message.id,
              accountId: message.accountId,
              owner: draft.owner,
              kind: draft.kind,
              title: draft.title,
              evidence: draft.evidence,
              dueAt: draft.dueAt,
              status: 'open',
              source: 'heuristic',
              confidence: draft.confidence,
              createdAt: now,
              updatedAt: now
            })
            .returning()
            .get()
        );
      } catch (error) {
        console.warn('Failed to persist extracted obligation', {
          messageId: message.id,
          title: draft.title,
          error
        });
      }
    }
    return saved;
  } catch (error) {
    console.warn('Failed to extract obligations for message', { messageId, error });
    return [];
  }
}

export function scanRecentMessagesForObligations(limit = 50) {
  const rows = db
    .select({ id: messages.id })
    .from(messages)
    .orderBy(desc(messages.date))
    .limit(Math.max(1, Math.min(100, Number(limit) || 50)))
    .all();
  let createdOrFound = 0;
  for (const row of rows) createdOrFound += extractAndStoreObligationsForMessage(row.id).length;
  return { scanned: rows.length, obligations: createdOrFound };
}

export function listOpenObligations(limit = 80) {
  return db
    .select({
      id: agentObligations.id,
      messageId: agentObligations.messageId,
      accountId: agentObligations.accountId,
      owner: agentObligations.owner,
      kind: agentObligations.kind,
      title: agentObligations.title,
      evidence: agentObligations.evidence,
      dueAt: agentObligations.dueAt,
      status: agentObligations.status,
      confidence: agentObligations.confidence,
      createdAt: agentObligations.createdAt,
      updatedAt: agentObligations.updatedAt,
      subject: messages.subject,
      sender: messages.from
    })
    .from(agentObligations)
    .innerJoin(messages, eq(messages.id, agentObligations.messageId))
    .where(eq(agentObligations.status, 'open'))
    .orderBy(sql`${agentObligations.dueAt} IS NULL`, agentObligations.dueAt, desc(agentObligations.createdAt))
    .limit(limit)
    .all();
}

export function updateObligationStatus(id: number, status: 'open' | 'done' | 'dismissed') {
  return db
    .update(agentObligations)
    .set({ status, updatedAt: nowIso() })
    .where(eq(agentObligations.id, id))
    .returning()
    .get();
}

export function extractObligationDrafts(message: typeof messages.$inferSelect): ObligationDraft[] {
  const text = `${message.subject}\n${message.bodyText}`;
  const sentences = text
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
  const drafts: ObligationDraft[] = [];
  for (const sentence of sentences) {
    if (drafts.length >= 6) break;
    const lower = sentence.toLowerCase();
    const dueAt = inferDueDate(sentence, message.date);
    if (ACTION_REQUEST_RE.test(sentence)) {
      drafts.push({
        owner: 'user',
        kind: inferKind(lower),
        title: compactTitle(sentence),
        evidence: sentence.slice(0, 500),
        dueAt,
        confidence: dueAt ? 0.84 : 0.76
      });
      continue;
    }
    if (COMMITMENT_RE.test(sentence)) {
      drafts.push({
        owner: lower.includes('we ') || lower.includes("we'll") ? 'other' : 'user',
        kind: inferKind(lower),
        title: compactTitle(sentence),
        evidence: sentence.slice(0, 500),
        dueAt,
        confidence: dueAt ? 0.78 : 0.68
      });
      continue;
    }
    if (DEADLINE_RE.test(sentence) && /\b(review|send|reply|respond|confirm|schedule|follow up|pay)\b/i.test(sentence)) {
      drafts.push({
        owner: 'user',
        kind: inferKind(lower),
        title: compactTitle(sentence),
        evidence: sentence.slice(0, 500),
        dueAt,
        confidence: 0.72
      });
    }
  }
  return dedupeDrafts(drafts);
}

function inferKind(lower: string): ObligationKind {
  if (/\b(reply|respond|response)\b/.test(lower)) return 'reply';
  if (/\bsend|share\b/.test(lower)) return 'send';
  if (/\breview|take a look\b/.test(lower)) return 'review';
  if (/\bpay|invoice|payment\b/.test(lower)) return 'pay';
  if (/\bschedule|calendar|call\b/.test(lower)) return 'schedule';
  return 'follow_up';
}

function compactTitle(sentence: string) {
  return sentence.replace(/\s+/g, ' ').replace(/^[-*]\s*/, '').slice(0, 140);
}

function dedupeDrafts(drafts: ObligationDraft[]) {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.owner}:${draft.kind}:${draft.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function inferDueDate(sentence: string, anchorDate: string) {
  const lower = sentence.toLowerCase();
  const anchor = Number.isFinite(new Date(anchorDate).getTime()) ? new Date(anchorDate) : new Date();
  const atHour = 17;

  const iso = sentence.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return atEndOfDay(new Date(`${iso[1]}T00:00:00`), atHour).toISOString();

  const slashDate = sentence.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    const month = Number(slashDate[1]) - 1;
    const day = Number(slashDate[2]);
    const year = slashDate[3]
      ? Number(slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3])
      : anchor.getFullYear();
    const parsed = new Date(year, month, day);
    if (Number.isFinite(parsed.getTime())) return atEndOfDay(parsed, atHour).toISOString();
  }

  if (/\btoday\b/.test(lower)) return atEndOfDay(anchor, atHour).toISOString();
  if (/\btomorrow\b/.test(lower)) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + 1);
    return atEndOfDay(next, atHour).toISOString();
  }

  const inDays = lower.match(/\bin\s+(\d+|one|two|three|four|five|six|seven)\s+days?\b/);
  if (inDays) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + wordToNumber(inDays[1]));
    return atEndOfDay(next, atHour).toISOString();
  }

  if (/\b(end of the month|end of month|eom)\b/.test(lower)) {
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return atEndOfDay(end, atHour).toISOString();
  }

  if (/\bnext week\b/.test(lower)) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + 7);
    return atEndOfDay(next, atHour).toISOString();
  }
  const weekday = lower.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekday) return nextWeekday(anchor, weekday[1], atHour).toISOString();
  return null;
}

function wordToNumber(value: string) {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7
  };
  return words[value] ?? Number(value);
}

function atEndOfDay(date: Date, hour: number) {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function nextWeekday(anchor: Date, weekday: string, hour: number) {
  const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(
    weekday
  );
  const next = new Date(anchor);
  const delta = (target - next.getDay() + 7) % 7 || 7;
  next.setDate(next.getDate() + delta);
  return atEndOfDay(next, hour);
}
