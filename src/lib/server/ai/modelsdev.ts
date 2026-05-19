export type ModelsDevProviderRecord = {
  id?: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  description?: string;
  models?: Record<string, ModelsDevModelRecord>;
};

export type ModelsDevModelRecord = {
  id?: string;
  name?: string;
  family?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
  };
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  variants?: Record<string, { id?: string; name?: string }>;
};

export type ModelsDevProvider = {
  id: string;
  name: string;
  npm: string | null;
  api: string | null;
  env: string[];
  doc: string | null;
  description: string;
  models: Array<ModelsDevModel>;
};

export type ModelsDevModel = {
  id: string;
  label: string;
  family: string | null;
  contextWindow: number;
  inputPrice: number;
  outputPrice: number;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  variants: Array<{ id: string; label: string }> | null;
};

export async function fetchModelsDevProviders() {
  const response = await fetch('https://models.dev/api.json');
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  }
  const parsed = (await response.json()) as Record<string, ModelsDevProviderRecord>;
  const providers: ModelsDevProvider[] = [];
  
  for (const [providerKey, providerValue] of Object.entries(parsed)) {
    const models: Array<ModelsDevModel> = [];
    for (const [modelKey, modelValue] of Object.entries(providerValue.models || {})) {
      const id = String(modelValue.id || modelKey || '').trim();
      if (!id) continue;
      models.push({
        id,
        label: String(modelValue.name || id).trim(),
        family: modelValue.family || null,
        contextWindow: modelValue.limit?.context || 0,
        inputPrice: modelValue.cost?.input || 0,
        outputPrice: modelValue.cost?.output || 0,
        reasoning: !!modelValue.reasoning,
        toolCall: !!modelValue.tool_call,
        structuredOutput: !!modelValue.structured_output,
        // Variant ID falls back to the catalog record key (e.g. "low", "medium")
        // when no explicit id is provided in the models.dev catalog entry.
        variants: modelValue.variants
          ? Object.entries(modelValue.variants).map(([key, val]) => ({
              id: String(val.id || key).trim(),
              label: String(val.name || key).trim()
            }))
          : null
      });
    }
    
    providers.push({
      id: String(providerValue.id || providerKey).trim(),
      name: String(providerValue.name || providerKey).trim(),
      npm: providerValue.npm || null,
      api: providerValue.api || null,
      env: Array.isArray(providerValue.env) ? providerValue.env.map((item) => String(item)) : [],
      doc: providerValue.doc || null,
      description: providerValue.description || '',
      models: models.sort((a, b) => a.id.localeCompare(b.id))
    });
  }
  
  providers.sort((a, b) => {
    if (a.id === 'deepseek') return -1;
    if (b.id === 'deepseek') return 1;
    return a.name.localeCompare(b.name);
  });
  
  return providers;
}
