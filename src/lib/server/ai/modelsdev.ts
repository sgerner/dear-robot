type ModelsDevProviderRecord = {
  id?: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models?: Record<string, { id?: string; name?: string }>;
};

export type ModelsDevProvider = {
  id: string;
  name: string;
  npm: string | null;
  api: string | null;
  env: string[];
  doc: string | null;
  models: Array<{ id: string; label: string }>;
};

export async function fetchModelsDevProviders() {
  const response = await fetch('https://models.dev/api.json');
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
  const parsed = JSON.parse(text) as Record<string, ModelsDevProviderRecord>;
  const providers: ModelsDevProvider[] = [];
  for (const [providerKey, providerValue] of Object.entries(parsed)) {
    const models: Array<{ id: string; label: string }> = [];
    for (const [modelKey, modelValue] of Object.entries(providerValue.models || {})) {
      const id = String(modelValue.id || modelKey || '').trim();
      if (!id) continue;
      models.push({
        id,
        label: String(modelValue.name || id).trim()
      });
    }
    providers.push({
      id: String(providerValue.id || providerKey).trim(),
      name: String(providerValue.name || providerKey).trim(),
      npm: providerValue.npm || null,
      api: providerValue.api || null,
      env: Array.isArray(providerValue.env) ? providerValue.env.map((item) => String(item)) : [],
      doc: providerValue.doc || null,
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

