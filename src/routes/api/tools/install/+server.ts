import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { installCliPackage, persistCliInstall, type CliInstallManager } from '$lib/server/agent/cli-installer';

const InstallSchema = z.object({
  manager: z.enum(['npm', 'pnpm', 'yarn', 'bun', 'pipx', 'uv']) as z.ZodType<CliInstallManager>,
  packageSpec: z.string().min(1).max(200),
  binaryName: z.string().min(1).max(120).optional().nullable()
});

export async function POST({ request }) {
  const parsed = InstallSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw error(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const { manager, packageSpec, binaryName } = parsed.data;
  const normalizedBinary = binaryName?.trim() || null;
  try {
    const result = await installCliPackage({
      manager,
      packageSpec,
      binaryName: normalizedBinary
    });
    persistCliInstall(
      {
        manager,
        packageSpec,
        binaryName: normalizedBinary
      },
      'success',
      result.warning
    );
    return json({
      ok: true,
      warning: result.warning,
      install: {
        manager,
        packageSpec
      },
      logs: result.logs
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    persistCliInstall(
      {
        manager,
        packageSpec,
        binaryName: normalizedBinary
      },
      'failed',
      message
    );
    throw error(400, message);
  }
}
