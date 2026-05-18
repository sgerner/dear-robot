import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const isBuildProcess =
  process.env.npm_lifecycle_event === 'build' ||
  (process.argv.some((arg) => arg.includes('vite') || arg.includes('@sveltejs/kit')) &&
    process.argv.includes('build'));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATA_DIR: z.string().default('/data'),
  APP_SESSION_SECRET: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  MCP_AUTH_TOKEN: z.string().optional(),
  AI_PROVIDER: z.string().default('deepseek'),
  AI_MODEL: z.string().default('deepseek-v4-flash'),
  AI_BASE_URL: z.string().default('https://api.deepseek.com'),
  AI_PROXY_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_FALLBACK_PROVIDER: z.string().default('gemini'),
  AI_FALLBACK_MODEL: z.string().optional(),
  AI_FALLBACK_BASE_URL: z
    .string()
    .default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  AI_FALLBACK_PROXY_URL: z.string().optional(),
  AI_FALLBACK_API_KEY: z.string().optional(),
  AI_ADVANCED_PROVIDER: z.string().default('deepseek'),
  AI_ADVANCED_MODEL: z.string().optional(),
  AI_ADVANCED_BASE_URL: z.string().optional(),
  AI_ADVANCED_PROXY_URL: z.string().optional(),
  AI_ADVANCED_API_KEY: z.string().optional(),
  AI_MAX_REPAIR_ATTEMPTS: z.coerce.number().default(1),
  DEBUG_AI: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USERNAME: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  TEST_EMAIL_FROM: z.string().optional(),
  TEST_EMAIL_TO: z.string().optional(),
  ATTACHMENT_MAX_BYTES: z.coerce.number().default(15 * 1024 * 1024),
  ATTACHMENT_SCAN_STRICT: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(180),
  MAILBOX_OP_MIN_INTERVAL_MS: z.coerce.number().default(120),
  RUN_LIVE_PROVIDER_TESTS: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  AUTOPILOT_INTERVAL_MINUTES: z.coerce.number().default(15)
});

const parsed = EnvSchema.parse(process.env);
const derivedDbPath = isBuildProcess ? ':memory:' : path.join(parsed.DATA_DIR, 'dear-robot.db');

if (parsed.DEBUG_AI) {
  console.log('[dear-robot] AI debugging is ENABLED');
}

export const env = {
  ...parsed,
  DB_PATH: derivedDbPath,
  DEBUG_AI: parsed.DEBUG_AI ?? false,
  ATTACHMENT_SCAN_STRICT: parsed.ATTACHMENT_SCAN_STRICT ?? false,
  RUN_LIVE_PROVIDER_TESTS: parsed.RUN_LIVE_PROVIDER_TESTS ?? false
};

export const isProduction = env.NODE_ENV === 'production' && !isBuildProcess;

const requiredProductionSecrets = [
  'APP_SESSION_SECRET',
  'APP_PASSWORD',
  'ENCRYPTION_KEY',
  'MCP_AUTH_TOKEN'
] as const;

const dataDirIsAbsolute = path.isAbsolute(env.DATA_DIR);
if (isProduction) {
  const missing = requiredProductionSecrets.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  if (!dataDirIsAbsolute) {
    throw new Error(`DATA_DIR must be an absolute path in production. Received: ${env.DATA_DIR}`);
  }
  if (env.DB_PATH === ':memory:') {
    throw new Error('DB_PATH must be a persistent absolute file path in production, not :memory:.');
  }
}

if (!isBuildProcess && !dataDirIsAbsolute) {
  throw new Error(`DATA_DIR must be an absolute path. Received: ${env.DATA_DIR}`);
}

if (!env.ENCRYPTION_KEY && !isProduction) {
  console.warn(
    '[dear-robot] ENCRYPTION_KEY is missing. Using a temporary development-only key; saved account passwords will not be portable.'
  );
}

export function ensureDataDir() {
  if (isBuildProcess || env.DB_PATH === ':memory:') return;
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
}
