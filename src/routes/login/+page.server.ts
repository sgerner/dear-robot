import { fail, redirect } from '@sveltejs/kit';
import { env } from '$lib/server/env';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireConfiguredPassword, sessionCookieValue } from '$lib/server/security';

export const actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    requireConfiguredPassword();
    const clientAddress = getClientAddress();
    const rate = checkRateLimit({
      key: `login:${clientAddress}`,
      maxPerMinute: 10
    });
    if (!rate.allowed) {
      return fail(429, { message: 'Too many login attempts. Please try again in a minute.' });
    }
    const data = await request.formData();
    const password = String(data.get('password') || '');
    const expected = env.APP_PASSWORD || 'password';
    if (password !== expected) {
      return fail(400, { message: 'Invalid password' });
    }
    cookies.set('dear-robot_session', sessionCookieValue(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30
    });
    throw redirect(303, '/');
  }
};
