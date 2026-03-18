# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Goal
Capture user conversations from claude.ai, chatgpt.com, and gemini.google.com and persist them locally as a platform-agnostic memory layer.

## Phase 1 scope
Capture only. No injection, no backend sync. Local storage only.

## Stack
- TypeScript + esbuild (or Vite)
- Chrome Extension Manifest V3
- chrome.storage.local for persistence
- No UI frameworks — vanilla TS for content scripts

## Commands
```bash
npm run build       # compile TS via esbuild/vite
npm run watch       # rebuild on change
npm run typecheck   # tsc --noEmit
```
Load unpacked from `dist/` in chrome://extensions (Developer mode).

## Architecture
- `content_claude.ts` / `content_chatgpt.ts` / `content_gemini.ts` — one content script per platform
- `extractor.ts` — shared DOM parsing and MutationObserver logic
- `background.ts` — dedup, session stitching, storage writes
- `popup.html` / `popup.ts` — read-only conversation viewer

## Key design decisions
- Selectors externalized to `selectors.json` (not hardcoded) for hot-fix without store resubmit
- Messages only written after streaming completes (watch for streaming indicator)
- SPA navigation handled via `history.pushState` monkey-patch
- Storage key layout: `"conversations"` (index), `"conv:{id}"` (one key per convo), `"meta"`
- Rolling eviction: keep last 100 conversations max

## Data model
See `src/shared/types.ts` — `Message`, `Conversation`, `Platform` types.

## Known fragile areas
- DOM selectors break on platform redeploys — always check `selectors.json` first
- Streaming detection is platform-specific — see `extractor.ts`
- SPA nav re-init must not duplicate messages already captured
