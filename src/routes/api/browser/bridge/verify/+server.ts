import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { verifyClientBrowserBridgeCapability } from '$lib/server/browser';

const VerifySchema = z
  .object({
    token: z.string().min(20).max(2000),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{12,160}$/),
    appOrigin: z.string().url().max(2048)
  })
  .strict();

function isExtensionOrigin(origin: string | null) {
  return Boolean(origin && /^(?:chrome|moz)-extension:\/\/[a-z0-9_-]+$/i.test(origin));
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '300',
    vary: 'Origin',
    'cache-control': 'no-store'
  };
}

/**
 * The extension cannot use the app's HttpOnly login cookie. It instead proves
 * possession of a short-lived, recording-bound capability issued to the
 * authenticated app page. This route intentionally accepts only extension
 * origins and returns no user, credential, or recipe data.
 */
export const OPTIONS: RequestHandler = ({ request }) => {
  const origin = request.headers.get('origin');
  if (!isExtensionOrigin(origin)) throw error(403, 'Browser extension origin required');
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
};

export const POST: RequestHandler = async ({ request }) => {
  const origin = request.headers.get('origin');
  if (!isExtensionOrigin(origin)) throw error(403, 'Browser extension origin required');
  const body = VerifySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw error(400, 'Invalid browser bridge verification request');

  const capability = verifyClientBrowserBridgeCapability(body.data);
  if (!capability) throw error(403, 'Browser bridge capability has expired or is invalid');

  return json(
    {
      valid: true,
      sessionId: capability.sessionId,
      appOrigin: capability.appOrigin
    },
    { headers: corsHeaders(origin!) }
  );
};
