import { z } from 'zod';

export const ModelCatalogRequestSchema = z.object({
  profile: z.enum(['primary', 'fallback', 'advanced', 'audio']).optional(),
  provider: z.string().min(1).max(120),
  transport: z.enum(['openai_compatible', 'anthropic']),
  baseUrl: z.string().url(),
  apiKey: z.string().optional()
});

export type ModelCatalogRequest = z.infer<typeof ModelCatalogRequestSchema>;

type CatalogModel = { id: string; label: string };

export async function fetchModelCatalog(config: ModelCatalogRequest): Promise<CatalogModel[]> {
  if (config.provider === 'modeldev' || config.provider === 'modelsdev') {
    return fetchModelsDevCatalog();
  }
  if (!config.apiKey) throw new Error('API key required to fetch model catalog');
  if (config.transport === 'anthropic') {
    return fetchAnthropicModels(config.baseUrl, config.apiKey);
  }
  return fetchOpenAiCompatibleModels(config.baseUrl, config.apiKey);
}

async function fetchOpenAiCompatibleModels(baseUrl: string, apiKey: string) {
  const base = normalizeOpenAiBase(baseUrl);
  const candidates = candidateModelEndpoints(base);
  const errors: string[] = [];
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${endpoint} -> HTTP ${response.status}: ${text.slice(0, 160)}`);
        continue;
      }
      const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
      return (parsed.data || [])
        .map((item) => String(item.id || '').trim())
        .filter(Boolean)
        .map((id) => ({ id, label: id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      errors.push(`${endpoint} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Unable to fetch model catalog from ${base}. Tried: ${errors.join(' | ')}`);
}

async function fetchAnthropicModels(baseUrl: string, apiKey: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/models`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  const parsed = JSON.parse(text) as { data?: Array<{ id?: string; display_name?: string }> };
  return (parsed.data || [])
    .map((item) => ({
      id: String(item.id || '').trim(),
      label: String(item.display_name || item.id || '').trim()
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeOpenAiBase(input: string) {
  const base = input.replace(/\/+$/, '');
  if (base.includes('api.model.dev')) return base.replace('api.model.dev', 'model.dev');
  return base;
}

function candidateModelEndpoints(base: string) {
  const endpoints = new Set<string>();
  if (base.endsWith('/chat/completions')) {
    endpoints.add(base.replace(/\/chat\/completions$/, '/models'));
  }
  endpoints.add(`${base}/models`);
  if (!base.endsWith('/v1')) endpoints.add(`${base}/v1/models`);
  return Array.from(endpoints);
}

async function fetchModelsDevCatalog() {
  const response = await fetch('https://models.dev/api.json');
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  const parsed = JSON.parse(text) as Record<
    string,
    {
      models?: Record<string, { id?: string; name?: string }>;
    }
  >;
  const rows: CatalogModel[] = [];
  for (const provider of Object.values(parsed)) {
    const models = provider.models || {};
    for (const [key, meta] of Object.entries(models)) {
      const id = (meta.id || key || '').trim();
      if (!id) continue;
      rows.push({ id, label: meta.name?.trim() || id });
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
