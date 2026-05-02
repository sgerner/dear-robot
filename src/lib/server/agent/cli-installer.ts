import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { env } from '$lib/server/env';

export type CliInstallManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pipx' | 'uv';

export type CliInstallRequest = {
  manager: CliInstallManager;
  packageSpec: string;
  binaryName?: string | null;
};

type CliInstallManifestEntry = {
  manager: CliInstallManager;
  packageSpec: string;
  binaryName: string | null;
  createdAt: string;
  updatedAt: string;
  lastInstallStatus: 'success' | 'failed' | 'never';
  lastInstallError: string | null;
};

type CliInstallManifest = {
  version: 1;
  tools: CliInstallManifestEntry[];
  updatedAt: string;
};

const PACKAGE_SPEC_PATTERN = /^[a-zA-Z0-9@._/+:\-=~]+$/;
const BINARY_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MANIFEST_FILENAME = 'cli-tools.manifest.json';
const BOOTSTRAP_LOG_FILENAME = 'cli-tools-bootstrap.log';

let startupBootstrapStarted = false;

function nowIso() {
  return new Date().toISOString();
}

function manifestPath() {
  return path.join(env.DATA_DIR, MANIFEST_FILENAME);
}

function bootstrapLogPath() {
  return path.join(env.DATA_DIR, BOOTSTRAP_LOG_FILENAME);
}

function ensureDataDir() {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
}

function readManifest(): CliInstallManifest {
  ensureDataDir();
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      tools: [],
      updatedAt: nowIso()
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CliInstallManifest;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tools)) {
      throw new Error('invalid manifest');
    }
    return parsed;
  } catch {
    return {
      version: 1,
      tools: [],
      updatedAt: nowIso()
    };
  }
}

function writeManifest(manifest: CliInstallManifest) {
  ensureDataDir();
  fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), 'utf8');
}

function installCommandFor(manager: CliInstallManager, packageSpec: string) {
  switch (manager) {
    case 'npm':
      return { command: 'npm', args: ['install', '-g', packageSpec] };
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-g', packageSpec] };
    case 'yarn':
      return { command: 'yarn', args: ['global', 'add', packageSpec] };
    case 'bun':
      return { command: 'bun', args: ['add', '-g', packageSpec] };
    case 'pipx':
      return { command: 'pipx', args: ['install', packageSpec] };
    case 'uv':
      return { command: 'uv', args: ['tool', 'install', packageSpec] };
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 120_000) stdout = stdout.slice(-120_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 120_000) stderr = stderr.slice(-120_000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function validateCliInstallInput(input: CliInstallRequest) {
  if (!PACKAGE_SPEC_PATTERN.test(input.packageSpec)) {
    throw new Error('Invalid package spec characters');
  }
  if (input.binaryName && !BINARY_PATTERN.test(input.binaryName)) {
    throw new Error('Invalid binary name');
  }
}

export async function installCliPackage(input: CliInstallRequest) {
  validateCliInstallInput(input);
  const managerCheck = await runCommand('which', [input.manager]);
  if (managerCheck.code !== 0) {
    throw new Error(`${input.manager} is not available in this container`);
  }

  const installCmd = installCommandFor(input.manager, input.packageSpec);
  const installResult = await runCommand(installCmd.command, installCmd.args);
  if (installResult.code !== 0) {
    throw new Error(
      `Install failed (${input.manager} ${input.packageSpec})\n${(installResult.stderr || installResult.stdout || '').slice(-2000)}`
    );
  }

  let warning: string | null = null;
  if (input.binaryName) {
    const binaryCheck = await runCommand('which', [input.binaryName]);
    if (binaryCheck.code !== 0) {
      warning = `Installed, but binary "${input.binaryName}" is not currently on PATH`;
    }
  }

  return {
    warning,
    logs: {
      stdout: installResult.stdout.slice(-4000),
      stderr: installResult.stderr.slice(-4000)
    }
  };
}

export function persistCliInstall(
  input: CliInstallRequest,
  status: 'success' | 'failed',
  errorMessage: string | null
) {
  const manifest = readManifest();
  const idx = manifest.tools.findIndex(
    (item) => item.manager === input.manager && item.packageSpec === input.packageSpec
  );
  const timestamp = nowIso();
  const entry: CliInstallManifestEntry = {
    manager: input.manager,
    packageSpec: input.packageSpec,
    binaryName: input.binaryName?.trim() || null,
    createdAt: idx >= 0 ? manifest.tools[idx].createdAt : timestamp,
    updatedAt: timestamp,
    lastInstallStatus: status,
    lastInstallError: errorMessage
  };
  if (idx >= 0) {
    manifest.tools[idx] = entry;
  } else {
    manifest.tools.push(entry);
  }
  manifest.updatedAt = timestamp;
  writeManifest(manifest);
}

export function listCliInstallManifest() {
  return readManifest();
}

function appendBootstrapLog(line: string) {
  ensureDataDir();
  fs.appendFileSync(bootstrapLogPath(), `${nowIso()} ${line}\n`, 'utf8');
}

export function applyCliManifestOnStartup() {
  if (startupBootstrapStarted) return;
  startupBootstrapStarted = true;
  const manifest = readManifest();
  if (!manifest.tools.length) return;
  void (async () => {
    appendBootstrapLog(`bootstrap start; tools=${manifest.tools.length}`);
    for (const tool of manifest.tools) {
      try {
        const result = await installCliPackage({
          manager: tool.manager,
          packageSpec: tool.packageSpec,
          binaryName: tool.binaryName
        });
        persistCliInstall(
          {
            manager: tool.manager,
            packageSpec: tool.packageSpec,
            binaryName: tool.binaryName
          },
          'success',
          result.warning
        );
        appendBootstrapLog(
          `installed ${tool.manager} ${tool.packageSpec}${result.warning ? ` warning=${result.warning}` : ''}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        persistCliInstall(
          {
            manager: tool.manager,
            packageSpec: tool.packageSpec,
            binaryName: tool.binaryName
          },
          'failed',
          message
        );
        appendBootstrapLog(
          `failed ${tool.manager} ${tool.packageSpec} error=${message.slice(0, 500)}`
        );
      }
    }
    appendBootstrapLog('bootstrap complete');
  })();
}
