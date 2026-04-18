import * as esbuild from 'esbuild';

const isDev = process.argv.includes('--watch');

const shared = {
  bundle: true,
  target: 'chrome120',
  sourcemap: isDev ? 'inline' : false,
};

// Background service worker — ESM supported in MV3
const bgCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/background.ts'],
  outdir: 'dist',
  format: 'esm',
});

// Content scripts — must be IIFE (no native module support)
const contentCtx = await esbuild.context({
  ...shared,
  entryPoints: [
    'src/content_claude.ts',
    'src/content_chatgpt.ts',
    'src/content_gemini.ts',
  ],
  outdir: 'dist',
  format: 'iife',
});

// Popup scripts — IIFE loaded by HTML pages
const popupCtx = await esbuild.context({
  ...shared,
  entryPoints: ['popup/popup.ts', 'popup/export.ts', 'popup/settings.ts', 'popup/onboarding.ts', 'popup/conversations.ts', 'popup/panel.ts', 'popup/search.ts'],
  outdir: 'dist',
  format: 'iife',
});

const contexts = [bgCtx, contentCtx, popupCtx];

if (isDev) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching...');
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  console.log('build complete');
}
