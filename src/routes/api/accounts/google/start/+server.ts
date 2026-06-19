import { error, redirect } from '@sveltejs/kit';
import { beginGoogleOauth } from '$lib/server/oauth/google';

export function GET({ url, cookies }) {
  let authUrl: string;
  try {
    const { url: nextUrl, state, verifier } = beginGoogleOauth(
      url.origin,
      url.searchParams.get('email')
    );
    authUrl = nextUrl;
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
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to start Google OAuth');
  }
  throw redirect(302, authUrl);
}
