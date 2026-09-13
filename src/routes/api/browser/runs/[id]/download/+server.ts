import fs from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getBrowserRun } from '$lib/server/browser';
import { env } from '$lib/server/env';

export async function GET({ params }) {
  const parsed = z.coerce.number().int().positive().safeParse(params.id);
  if (!parsed.success) throw error(400, 'Invalid browser run id');
  const run = getBrowserRun(parsed.data);
  if (!run || run.status !== 'completed' || !run.downloadPath)
    throw error(404, 'No completed report download is available.');
  const directory = await fs
    .realpath(path.join(env.DATA_DIR, 'browser', 'downloads', String(run.id)))
    .catch(() => null);
  const file = await fs.realpath(run.downloadPath).catch(() => null);
  if (!directory || !file || path.dirname(file) !== directory)
    throw error(404, 'Report file is unavailable.');
  const filename = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
  return new Response(await fs.readFile(file), {
    headers: {
      'content-type': filename.toLowerCase().endsWith('.csv')
        ? 'text/csv; charset=utf-8'
        : 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
