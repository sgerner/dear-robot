import { json } from '@sveltejs/kit';
import { discoverAccountSettings } from '$lib/server/email/discovery';

export async function POST({ request }) {
  const { email } = await request.json();
  if (!email || !email.includes('@')) {
    return json({ ok: false, message: 'Invalid email' }, { status: 400 });
  }
  
  const settings = await discoverAccountSettings(email);
  if (settings) {
    return json({ ok: true, settings });
  }
  
  return json({ ok: false, message: 'Could not discover settings' });
}
