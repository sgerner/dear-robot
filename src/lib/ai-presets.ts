export type AiTransport = 'openai_compatible' | 'anthropic';

export type AiPreset = {
  id: string;
  label: string;
  provider: string;
  transport: AiTransport;
  baseUrl: string;
  defaultModel: string;
  modelOptions: string[];
  notes: string;
  keyHint: string;
};

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'deepseek',
    transport: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    modelOptions: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat'],
    notes: 'Fast, inexpensive, strong for triage and structured drafting.',
    keyHint: 'DeepSeek API key'
  },
  {
    id: 'gemini',
    label: 'Gemini',
    provider: 'gemini',
    transport: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
    modelOptions: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'],
    notes: 'Good fallback and good cost/perf balance for browsing-heavy or multimodal work.',
    keyHint: 'Google AI Studio / Gemini API key'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    transport: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    modelOptions: ['gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    notes: 'Very strong general-purpose writing and planning. Good default when quality matters.',
    keyHint: 'OpenAI API key'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    transport: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4',
    modelOptions: ['claude-haiku-4', 'claude-sonnet-4', 'claude-opus-4'],
    notes: 'Excellent for careful reasoning, summaries, and long-form drafting.',
    keyHint: 'Anthropic API key'
  },
  {
    id: 'vertex',
    label: 'Vertex / Gemini',
    provider: 'vertex',
    transport: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
    modelOptions: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'],
    notes: 'Use for Google-hosted Gemini access. Vertex-specific setups can still be entered manually.',
    keyHint: 'Google API key or Vertex-compatible gateway key'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    transport: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    modelOptions: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'],
    notes: 'Best if you want flexible routing across many frontier models behind one key.',
    keyHint: 'OpenRouter API key'
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    provider: 'opencode-go',
    transport: 'openai_compatible',
    baseUrl: 'https://opencode.go/api/v1',
    defaultModel: 'opencode-go',
    modelOptions: ['opencode-go', 'opencode-go-mini'],
    notes: 'Placeholder preset for hosted or proxy-backed OpenCode Go deployments. Adjust manually if your endpoint differs.',
    keyHint: 'Provider key or proxy token'
  },
  {
    id: 'manual',
    label: 'Manual',
    provider: 'manual',
    transport: 'openai_compatible',
    baseUrl: 'https://example.invalid/v1',
    defaultModel: '',
    modelOptions: [],
    notes: 'Enter every field yourself. Use this when you know the provider endpoint already.',
    keyHint: 'API key or bearer token'
  }
];

export const AI_MODEL_RECOMMENDATIONS = [
  {
    label: 'Fast triage',
    model: 'deepseek-v4-flash',
    reason: 'Lowest friction for inbox classification, summarization, and draft generation.'
  },
  {
    label: 'Balanced general-purpose',
    model: 'gemini-2.5-flash',
    reason: 'Good cost/performance default if you want broadly capable suggestions.'
  },
  {
    label: 'Highest quality planning',
    model: 'deepseek-v4-pro',
    reason: 'Use for complex multi-step tasks, ERP-style lookups, or agent plans that need stronger reasoning.'
  },
  {
    label: 'Careful long-form drafting',
    model: 'claude-sonnet-4',
    reason: 'Good for nuanced replies and long task plans when quality matters more than latency.'
  },
  {
    label: 'OpenAI default',
    model: 'gpt-4.1-mini',
    reason: 'Strong general-purpose option with a straightforward OpenAI-compatible setup.'
  }
];

export function presetForProvider(provider: string) {
  return AI_PRESETS.find((preset) => preset.provider === provider || preset.id === provider) || AI_PRESETS[0];
}
