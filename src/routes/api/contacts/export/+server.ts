import { exportContactsCsv } from '$lib/server/services/messages';

export function GET({ url }) {
  const accountId = url.searchParams.get('accountId');
  const csv = exportContactsCsv(accountId ? Number(accountId) : undefined);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="contacts.csv"'
    }
  });
}
