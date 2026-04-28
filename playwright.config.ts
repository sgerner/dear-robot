import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm run build && NODE_ENV=test PORT=4173 DATA_DIR=/tmp/triage-e2e DB_PATH=/tmp/triage-e2e/triage.db APP_PASSWORD=test-password APP_SESSION_SECRET=test-session-secret-32-bytes MCP_AUTH_TOKEN=test-mcp-token ENCRYPTION_KEY=0123456789abcdef0123456789abcdef AI_API_KEY= npm run preview',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
