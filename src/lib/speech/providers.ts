export type SpeechProviderId =
  | 'deepgram'
  | 'assemblyai'
  | 'elevenlabs'
  | 'openai'
  | 'groq'
  | 'soniox'
  | 'google_cloud_stt'
  | 'browser_web_speech';

export type SpeechModelConfig = {
  id: string;
  label: string;
  blurb: string;
};

export type SpeechProviderConfig = {
  id: SpeechProviderId;
  label: string;
  authType: 'api_key' | 'advanced_service_credentials' | 'none';
  signupUrl: string | null;
  docsUrl: string | null;
  defaultModel: string;
  supportsStreaming: boolean;
  supportsBatch: boolean;
  recommended?: boolean;
  fallback?: boolean;
  advanced?: boolean;
  hiddenByDefault?: boolean;
  models: SpeechModelConfig[];
};

export const speechToTextProviders: SpeechProviderConfig[] = [
  {
    id: 'deepgram',
    label: 'Deepgram',
    authType: 'api_key',
    signupUrl: 'https://deepgram.com/pricing',
    docsUrl: 'https://developers.deepgram.com/reference/speech-to-text/listen-streaming',
    defaultModel: 'nova-3',
    supportsStreaming: true,
    supportsBatch: true,
    recommended: true,
    models: [
      {
        id: 'nova-3',
        label: 'Nova-3',
        blurb:
          'Best default for live textarea dictation. Fast streaming, stable interim results, smart formatting, and generous free credits.'
      },
      {
        id: 'nova-2',
        label: 'Nova-2',
        blurb: 'Older Deepgram model. Use when compatibility or cost tuning matters.'
      }
    ]
  },
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    authType: 'api_key',
    signupUrl: 'https://www.assemblyai.com/pricing',
    docsUrl: 'https://www.assemblyai.com/docs/streaming/getting-started/transcribe-streaming-audio',
    defaultModel: 'universal-3-pro',
    supportsStreaming: true,
    supportsBatch: false,
    models: [
      {
        id: 'universal-3-pro',
        label: 'Universal-3 Pro',
        blurb: 'Higher quality managed streaming speech model.'
      },
      {
        id: 'universal-2',
        label: 'Universal-2',
        blurb: 'Cheaper broad-coverage model for general voice workflows.'
      }
    ]
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    authType: 'api_key',
    signupUrl: 'https://elevenlabs.io/speech-to-text-api',
    docsUrl: 'https://elevenlabs.io/docs/overview/capabilities/speech-to-text',
    defaultModel: 'scribe_v2',
    supportsStreaming: true,
    supportsBatch: false,
    models: [
      {
        id: 'scribe_v2',
        label: 'Scribe v2',
        blurb: 'Premium-accuracy speech-to-text option.'
      },
      {
        id: 'scribe_v1',
        label: 'Scribe v1',
        blurb: 'Earlier Scribe model for compatibility use cases.'
      }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    authType: 'api_key',
    signupUrl: 'https://platform.openai.com/signup',
    docsUrl: 'https://developers.openai.com/api/reference/audio/createTranscription',
    defaultModel: 'gpt-4o-mini-transcribe',
    supportsStreaming: false,
    supportsBatch: true,
    models: [
      {
        id: 'gpt-4o-mini-transcribe',
        label: 'GPT-4o Mini Transcribe',
        blurb: 'Simple and inexpensive OpenAI speech transcription.'
      },
      {
        id: 'gpt-4o-transcribe',
        label: 'GPT-4o Transcribe',
        blurb: 'Higher quality OpenAI transcription at higher cost.'
      },
      {
        id: 'whisper-1',
        label: 'Whisper',
        blurb: 'Reliable baseline transcription model.'
      }
    ]
  },
  {
    id: 'groq',
    label: 'Groq',
    authType: 'api_key',
    signupUrl: 'https://console.groq.com',
    docsUrl: 'https://console.groq.com/docs/speech-to-text',
    defaultModel: 'whisper-large-v3-turbo',
    supportsStreaming: false,
    supportsBatch: true,
    models: [
      {
        id: 'whisper-large-v3-turbo',
        label: 'Whisper Large v3 Turbo',
        blurb: 'Very fast, low-cost Whisper transcription via Groq.'
      },
      {
        id: 'whisper-large-v3',
        label: 'Whisper Large v3',
        blurb: 'Higher-quality Whisper option with slightly more cost/latency.'
      }
    ]
  },
  {
    id: 'soniox',
    label: 'Soniox',
    authType: 'api_key',
    signupUrl: 'https://soniox.com/pricing',
    docsUrl: 'https://soniox.com/docs/stt/api-reference/websocket-api',
    defaultModel: 'stt-rt-v4',
    supportsStreaming: true,
    supportsBatch: false,
    models: [
      {
        id: 'stt-rt-v4',
        label: 'STT Realtime v4',
        blurb: 'Low-cost realtime speech-to-text model.'
      },
      {
        id: 'stt-async-v4',
        label: 'STT Async v4',
        blurb: 'Low-cost async transcription model.'
      }
    ]
  },
  {
    id: 'browser_web_speech',
    label: 'Browser fallback',
    authType: 'none',
    signupUrl: null,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition',
    defaultModel: 'browser-default',
    supportsStreaming: true,
    supportsBatch: false,
    fallback: true,
    models: [
      {
        id: 'browser-default',
        label: 'Browser default',
        blurb: 'Free browser-native dictation. Best in Chrome/Edge; Firefox support is inconsistent.'
      }
    ]
  },
  {
    id: 'google_cloud_stt',
    label: 'Google Cloud Speech-to-Text',
    authType: 'advanced_service_credentials',
    signupUrl: 'https://cloud.google.com/speech-to-text',
    docsUrl: 'https://cloud.google.com/speech-to-text/docs',
    defaultModel: 'chirp_3',
    supportsStreaming: true,
    supportsBatch: true,
    advanced: true,
    hiddenByDefault: true,
    models: [
      {
        id: 'chirp_3',
        label: 'Chirp 3',
        blurb: 'Enterprise-grade Google Cloud STT model.'
      },
      {
        id: 'chirp_2',
        label: 'Chirp 2',
        blurb: 'Previous-generation Chirp model.'
      },
      {
        id: 'latest_short',
        label: 'Latest Short',
        blurb: 'Optimized for short command-style utterances.'
      },
      {
        id: 'latest_long',
        label: 'Latest Long',
        blurb: 'Optimized for longer-form transcription.'
      }
    ]
  }
];

export function getSpeechProvider(id: string | null | undefined) {
  return speechToTextProviders.find((provider) => provider.id === id) || speechToTextProviders[0];
}

export function getSpeechModel(providerId: string | null | undefined, modelId: string | null | undefined) {
  const provider = getSpeechProvider(providerId);
  return provider.models.find((model) => model.id === modelId) || provider.models[0];
}

