import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { fetchModelCatalog, ModelCatalogRequestSchema } from '$lib/server/ai/catalog';
import { getAiProfile } from '$lib/server/ai/settings';
import { decryptSecret } from '$lib/server/security';

const CatalogPayloadSchema = ModelCatalogRequestSchema.extend({
  profile: z.enum(['primary', 'fallback', 'advanced', 'audio'])
});

export async function POST({ request }) {
  try {
    const payload = CatalogPayloadSchema.parse(await request.json());
    const saved = getAiProfile(payload.profile);
    const resolvedApiKey =
      payload.apiKey?.trim() ||
      (saved?.apiKeyEncrypted ? decryptSecret(saved.apiKeyEncrypted) : undefined);
    const models = await fetchModelCatalog({
      ...payload,
      apiKey: resolvedApiKey
    });
    return json({ models });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to fetch model catalog');
  }
}
