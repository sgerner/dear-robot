import { fail, redirect } from '@sveltejs/kit';
import { env } from '$lib/server/env';
import { requireConfiguredPassword, sessionCookieValue } from '$lib/server/security';

export const actions = {
  default: async ({ request, cookies }) => {
    requireConfiguredPassword();
    const data = await request.formData();
    const password = String(data.get('password') || '');
    const expected = env.APP_PASSWORD || 'password';
    if (password !== expected) {
      return fail(400, { message: 'Invalid password' });
    }
    cookies.set('dear-robot_session', sessionCookieValue(), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30
    });
    throw redirect(303, '/');
  }
};
