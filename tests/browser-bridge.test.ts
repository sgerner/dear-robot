import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const extensionDir = path.resolve('static/browser-bridge/extension');

describe('Dear Robot browser bridge bundle', () => {
  it('ships Chrome and Firefox manifests with the required bridge permissions', async () => {
    const chromeManifest = JSON.parse(
      await fs.readFile(path.join(extensionDir, 'manifest.json'), 'utf8')
    );
    const firefoxManifest = JSON.parse(
      await fs.readFile(path.join(extensionDir, 'manifest.firefox.json'), 'utf8')
    );

    for (const manifest of [chromeManifest, firefoxManifest]) {
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.permissions).toEqual(expect.arrayContaining(['tabs', 'downloads']));
      expect(manifest.content_scripts[0].matches).toContain('<all_urls>');
      expect(manifest.content_scripts[0].js).toContain('content.js');
    }
    expect(chromeManifest.background.service_worker).toBe('background.js');
    expect(firefoxManifest.background.scripts).toContain('background.js');
  });

  it('records credential fields as references instead of values', async () => {
    const content = await fs.readFile(path.join(extensionDir, 'content.js'), 'utf8');
    expect(content).toContain("return 'password'");
    expect(content).toContain("return 'username'");
    expect(content).toContain('value: secretRef ? null : target.value.slice(0, 4000)');
  });
});
