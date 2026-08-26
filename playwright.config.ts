import { defineConfig, devices } from '@playwright/test';

const testPort = process.env.PLAYWRIGHT_PORT || '4173';
const testBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: testBaseUrl,
    trace: 'on-first-retry'
  },
  webServer: {
    command:
      `rm -rf /tmp/dear-robot-e2e && npm run build && NODE_ENV=test PORT=${testPort} ORIGIN=${testBaseUrl} DATA_DIR=/tmp/dear-robot-e2e DB_PATH=/tmp/dear-robot-e2e/dear-robot.db APP_PASSWORD=test-password APP_SESSION_SECRET=test-session-secret-32-bytes MCP_AUTH_TOKEN=test-mcp-token ENCRYPTION_KEY=0123456789abcdef0123456789abcdef AI_PROVIDER=mock AI_MODEL=mock AI_API_KEY=test-key npm run preview`,
    url: `${testBaseUrl}/api/health`,
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
