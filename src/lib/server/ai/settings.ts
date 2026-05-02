import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import { bootstrapDatabase } from '../db/bootstrap';
import { aiProfiles } from '../db/schema';
import { decryptSecret, encryptSecret } from '../security';
import { getSpeechProvider } from '$lib/speech/providers';

bootstrapDatabase();

export const AiProfileSchema = z.object({
  profile: z.enum(['primary', 'fallback', 'advanced', 'audio']),
  label: z.string().min(1).max(120),
  provider: z.string().min(1).max(120),
  transport: z.enum(['openai_compatible', 'anthropic']).default('openai_compatible'),
  model: z.string().min(1).max(200),
  baseUrl: z.string().url(),
  apiKey: z.string().nullable().optional(),
  preset: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
  notes: z.string().nullable().optional()
});

export type AiProfileInput = z.infer<typeof AiProfileSchema>;

export function listAiProfiles() {
  return db.select().from(aiProfiles).orderBy(aiProfiles.id).all().map(publicAiProfile);
}

export function getAiProfile(profile: AiProfileInput['profile']) {
  return db.select().from(aiProfiles).where(eq(aiProfiles.profile, profile)).get();
}

export function upsertAiProfile(input: AiProfileInput) {
  const now = nowIso();
  const existing = getAiProfile(input.profile);
  const apiKeyEncrypted =
    input.apiKey === undefined
      ? (existing?.apiKeyEncrypted ?? null)
      : input.apiKey
        ? encryptSecret(input.apiKey)
        : null;
  const saved = db
    .insert(aiProfiles)
    .values({
      profile: input.profile,
      label: input.label,
      provider: input.provider,
      transport: input.transport,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKeyEncrypted,
      preset: input.preset || null,
      isEnabled: input.isEnabled,
      notes: input.notes || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: aiProfiles.profile,
      set: {
        label: input.label,
        provider: input.provider,
        transport: input.transport,
        model: input.model,
        baseUrl: input.baseUrl,
        apiKeyEncrypted,
        preset: input.preset || null,
        isEnabled: input.isEnabled,
        notes: input.notes || null,
        updatedAt: now
      }
    })
    .returning()
    .get();
  return publicAiProfile(saved);
}

export function publicAiProfile(profile: typeof aiProfiles.$inferSelect) {
  return {
    id: profile.id,
    profile: profile.profile,
    label: profile.label,
    provider: profile.provider,
    transport: profile.transport,
    model: profile.model,
    baseUrl: profile.baseUrl,
    preset: profile.preset,
    isEnabled: profile.isEnabled,
    notes: profile.notes,
    hasApiKey: Boolean(profile.apiKeyEncrypted),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

export function getAiConfigForRuntime(
  profile: AiProfileInput['profile'],
  defaults: AiProfileInput
): Omit<AiProfileInput, 'apiKey'> & { apiKey: string | undefined } {
  const saved = getAiProfile(profile);
  if (!saved || !saved.isEnabled) return { ...defaults, apiKey: defaults.apiKey ?? undefined };
  return {
    profile: saved.profile,
    label: saved.label,
    provider: saved.provider,
    transport: saved.transport,
    model: saved.model,
    baseUrl: saved.baseUrl,
    apiKey: saved.apiKeyEncrypted ? decryptSecret(saved.apiKeyEncrypted) : undefined,
    preset: saved.preset,
    isEnabled: saved.isEnabled,
    notes: saved.notes
  };
}

export function getAudioDictationSettings() {
  const saved = getAiProfile('audio');
  const fallbackProvider = getSpeechProvider(saved?.provider || 'deepgram');
  const fallbackModel = saved?.model || fallbackProvider.defaultModel;
  return {
    provider: saved?.provider || fallbackProvider.id,
    model: fallbackModel
  };
}
