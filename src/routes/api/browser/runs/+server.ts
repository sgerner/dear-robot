import { error, json } from '@sveltejs/kit';
import { listBrowserRuns } from '$lib/server/browser';

export function GET({ url }) {
  const recipeIdRaw = url.searchParams.get('recipeId');
  let recipeId: number | undefined;
  if (recipeIdRaw) {
    const parsed = Number(recipeIdRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw error(400, 'Invalid browser recipe id');
    recipeId = parsed;
  }
  return json({ runs: listBrowserRuns(recipeId) });
}
