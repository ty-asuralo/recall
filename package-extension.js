/**
 * Packages the Recall extension for Chrome Web Store submission.
 * Builds fresh, then zips only the files the browser needs.
 *
 * Usage:
 *   node package-extension.js
 *
 * Output:
 *   recall-v{version}.zip
 */

import { execSync } from 'child_process';
import { createWriteStream, readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import archiver from 'archiver';

const ROOT = new URL('.', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const outFile = resolve(ROOT, `recall-v${version}.zip`);

// ── Files and folders to include ────────────────────────────────────────────
// Everything the browser loads at runtime — no source files, no tooling.
const INCLUDE = [
  'manifest.json',
  'selectors.json',
  'dist/',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'popup/about.html',
  'popup/export.html',
  'popup/onboarding.html',
  'popup/popup.html',
  'popup/settings.html',
];

// ── 1. Fresh production build ────────────────────────────────────────────────
console.log('Building...');
execSync('npm run build', { stdio: 'inherit' });

// ── 2. Verify required files exist ──────────────────────────────────────────
const missing = INCLUDE.filter((f) => !existsSync(resolve(ROOT, f)));
if (missing.length > 0) {
  console.error('Missing files:', missing);
  process.exit(1);
}

// ── 3. Zip ───────────────────────────────────────────────────────────────────
console.log(`Packaging recall-v${version}.zip...`);
const output = createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);

for (const entry of INCLUDE) {
  const abs = resolve(ROOT, entry);
  if (entry.endsWith('/')) {
    archive.directory(abs, entry);
  } else {
    archive.file(abs, { name: entry });
  }
}

await archive.finalize();

output.on('close', () => {
  const kb = Math.round(archive.pointer() / 1024);
  console.log(`Done: recall-v${version}.zip (${kb} KB)`);
});
