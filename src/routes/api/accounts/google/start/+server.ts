import { error, redirect } from '@sveltejs/kit';
import { beginGoogleOauth } from '$lib/server/oauth/google';

export function GET({ url, cookies }) {
  try {
    const { url: authUrl, state, verifier } = beginGoogleOauth(url.origin);
    cookies.set('google_oauth_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: 60 * 10
    });
    cookies.set('google_oauth_verifier', verifier, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: 60 * 10
    });
    throw redirect(302, authUrl);
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to start Google OAuth');
  }
}
