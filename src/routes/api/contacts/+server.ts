import { json } from '@sveltejs/kit';
import { listContacts } from '$lib/server/services/messages';

export function GET({ url }) {
  return json({
    contacts: listContacts(
      url.searchParams.get('q') || '',
      Number(url.searchParams.get('limit') || 50)
    )
  });
}
