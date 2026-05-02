import type { Handle } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { bootstrapDatabase } from '$lib/server/db/bootstrap';
import { startSyncEngine } from '$lib/server/sync';
import { csrfToken, isValidSession, sameOriginOrForm } from '$lib/server/security';
import { env } from '$lib/server/env';
import { checkRateLimit } from '$lib/server/rate-limit';
import { startAutopilotScheduler } from '$lib/server/agent/autopilot';
import { applyCliManifestOnStartup } from '$lib/server/agent/cli-installer';

let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  bootstrapDatabase();
  if (env.NODE_ENV !== 'test') {
    startSyncEngine();
    startAutopilotScheduler();
    applyCliManifestOnStartup();
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  boot();
  const session = event.cookies.get('triage_session');
  event.locals.user = { authenticated: isValidSession(session) };
  event.locals.csrfToken = csrfToken(session);

  const isLogin = event.url.pathname.startsWith('/login');
  const isHealth = event.url.pathname === '/api/health';
  const isMcp = event.url.pathname.startsWith('/api/mcp');
  const isApi = event.url.pathname.startsWith('/api/');

  if (isMcp) {
    const auth = event.request.headers.get('authorization');
    if (!env.MCP_AUTH_TOKEN || auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
      throw error(401, 'Unauthorized');
    }
  }

  if (!isHealth && !isLogin && !isMcp && !event.locals.user.authenticated) {
    if (isApi) throw error(401, 'Unauthorized');
    throw redirect(303, '/login');
  }

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    if (isApi && !isLogin && !isMcp) {
      const key = `${session || event.getClientAddress()}::${event.url.pathname}`;
      const limited = checkRateLimit({
        key,
        maxPerMinute: Math.max(20, env.API_RATE_LIMIT_PER_MINUTE)
      });
      if (!limited.allowed) throw error(429, 'Rate limit exceeded');
    }
    if (!sameOriginOrForm(event.request.headers)) throw error(403, 'Invalid origin');
    const headerToken = event.request.headers.get('x-csrf-token');
    const formHeader = event.request.headers
      .get('content-type')
      ?.includes('application/x-www-form-urlencoded');
    if (!isLogin && !isMcp && isApi && headerToken !== event.locals.csrfToken && !formHeader) {
      throw error(403, 'Invalid CSRF token');
    }
  }

  return resolve(event);
};
