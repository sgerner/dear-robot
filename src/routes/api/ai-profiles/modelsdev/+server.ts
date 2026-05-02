import { error, json } from '@sveltejs/kit';
import { fetchModelsDevProviders } from '$lib/server/ai/modelsdev';

export async function GET() {
  try {
    const providers = await fetchModelsDevProviders();
    return json({ providers });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to load Models.dev catalog');
  }
}
