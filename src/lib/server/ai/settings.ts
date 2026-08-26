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
  proxyEnabled: z.boolean().default(false),
  proxyUrl: z.preprocess((val) => (val === '' ? null : val), z.string().url().nullable().optional()),
  apiKey: z.union([z.string(), z.record(z.string(), z.string())]).nullable().optional(),
  preset: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
  notes: z.string().nullable().optional()
});

export type AiProfileInput = z.infer<typeof AiProfileSchema>;

export type OpenAiOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  idToken?: string;
  accountId?: string;
};

export function listAiProfiles() {
  return db.select().from(aiProfiles).orderBy(aiProfiles.id).all().map(publicAiProfile);
}

export function getAiProfile(profile: AiProfileInput['profile']) {
  return db.select().from(aiProfiles).where(eq(aiProfiles.profile, profile)).get();
}

export function saveOpenAiOAuthTokens(profile: AiProfileInput['profile'], tokens: OpenAiOAuthTokens) {
  if (!tokens.accessToken) throw new Error('OpenAI OAuth did not return an access token');
  if (!tokens.accountId) throw new Error('OpenAI OAuth did not return a ChatGPT account id');
  const existing = getAiProfile(profile);
  if (!existing) throw new Error(`AI profile ${profile} does not exist`);
  const now = nowIso();
  db.update(aiProfiles)
    .set({
      apiKeyEncrypted: encryptSecret(
        JSON.stringify({ authType: 'openai_oauth', ...tokens })
      ),
      updatedAt: now
    })
    .where(eq(aiProfiles.profile, profile))
    .run();
}

export function hasOpenAiOAuthTokens(profile: AiProfileInput['profile']) {
  const saved = getAiProfile(profile);
  if (!saved?.apiKeyEncrypted) return false;
  const decrypted = decryptSecret(saved.apiKeyEncrypted);
  if (!decrypted) return false;
  try {
    const parsed = JSON.parse(decrypted) as { authType?: string; accessToken?: string };
    return parsed.authType === 'openai_oauth' && Boolean(parsed.accessToken);
  } catch {
    return false;
  }
}

export function upsertAiProfile(input: AiProfileInput) {
  const now = nowIso();
  const existing = getAiProfile(input.profile);
  
  let apiKeyToEncrypt: string | null = null;
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey === 'string') {
      apiKeyToEncrypt = input.apiKey;
    } else if (input.apiKey) {
      apiKeyToEncrypt = JSON.stringify(input.apiKey);
    }
  }
  
  const hasCredentialInput =
    input.apiKey !== undefined &&
    input.apiKey !== null &&
    (typeof input.apiKey === 'string'
      ? input.apiKey.trim().length > 0
      : Object.keys(input.apiKey).length > 0);
  const apiKeyEncrypted = hasCredentialInput
    ? apiKeyToEncrypt
      ? encryptSecret(apiKeyToEncrypt)
      : null
    : (existing?.apiKeyEncrypted ?? null);
        
  const saved = db
    .insert(aiProfiles)
    .values({
      profile: input.profile,
      label: input.label,
      provider: input.provider,
      transport: input.transport,
      model: input.model,
      baseUrl: input.baseUrl,
      proxyEnabled: input.proxyEnabled,
      proxyUrl: input.proxyUrl || null,
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
        proxyEnabled: input.proxyEnabled,
        proxyUrl: input.proxyUrl || null,
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
  const decryptedRaw = profile.apiKeyEncrypted ? decryptSecret(profile.apiKeyEncrypted) : null;
  let envValues: Record<string, string> = {};
  
  if (decryptedRaw) {
    if (decryptedRaw.startsWith('{')) {
      try {
        envValues = JSON.parse(decryptedRaw);
        if (envValues.authType === 'openai_oauth') envValues = {};
      } catch {
        envValues = { apiKey: decryptedRaw };
      }
    } else {
      envValues = { apiKey: decryptedRaw };
    }
  }

  return {
    id: profile.id,
    profile: profile.profile,
    label: profile.label,
    provider: profile.provider,
    transport: profile.transport,
    model: profile.model,
    baseUrl: profile.baseUrl,
    proxyEnabled: profile.proxyEnabled,
    proxyUrl: profile.proxyUrl,
    preset: profile.preset,
    isEnabled: profile.isEnabled,
    notes: profile.notes,
    hasApiKey: Boolean(profile.apiKeyEncrypted),
    envValues,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

export function getAiConfigForRuntime(
  profile: AiProfileInput['profile'],
  defaults: AiProfileInput
): Omit<AiProfileInput, 'apiKey'> & { apiKey: string | undefined; envValues?: Record<string, string> } {
  const saved = getAiProfile(profile);
  if (!saved || !saved.isEnabled) return { ...defaults, apiKey: (defaults.apiKey as string) ?? undefined };
  
  const decryptedRaw = saved.apiKeyEncrypted ? decryptSecret(saved.apiKeyEncrypted) : undefined;
  let envValues: Record<string, string> = {};
  let apiKey = decryptedRaw;

  if (decryptedRaw && decryptedRaw.startsWith('{')) {
    try {
      envValues = JSON.parse(decryptedRaw);
      // Fallback for primary key
      apiKey = envValues.apiKey || envValues.API_KEY || envValues.accessToken ||
        (envValues.authType ? undefined : Object.values(envValues)[0]);
    } catch {
      // Not JSON
    }
  }

  return {
    profile: saved.profile,
    label: saved.label,
    provider: saved.provider,
    transport: saved.transport,
    model: saved.model,
    baseUrl: saved.baseUrl,
    proxyEnabled: saved.proxyEnabled,
    proxyUrl: saved.proxyUrl,
    apiKey,
    envValues,
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
