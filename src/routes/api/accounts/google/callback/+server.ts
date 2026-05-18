import { error, redirect } from '@sveltejs/kit';
import { completeGoogleOauth } from '$lib/server/oauth/google';

export async function GET({ url, cookies }) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const cookieState = cookies.get('google_oauth_state');
  const verifier = cookies.get('google_oauth_verifier');
  cookies.delete('google_oauth_state', { path: '/' });
  cookies.delete('google_oauth_verifier', { path: '/' });
  if (!state || !cookieState || state !== cookieState) throw error(400, 'Invalid OAuth state');
  if (!code || !verifier) throw error(400, 'Missing OAuth authorization code');
  let redirectUrl: string;
  try {
    const linked = await completeGoogleOauth(code, verifier);
    redirectUrl = `/?view=accounts&oauth=connected&email=${encodeURIComponent(linked.email)}`;
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Unable to complete Google OAuth');
  }
  throw redirect(302, redirectUrl);
}
