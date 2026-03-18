# Milestones

## v0.1.0 — MVP (2026-03-17)

Commit: `687596e`

First working end-to-end version of Recall. Captures user messages from Claude.ai and stores them locally as a portable memory layer.

### What's in it

**Capture**
- MV3 content script on claude.ai using MutationObserver
- Streaming-aware: 600ms debounce, skips capture mid-stream
- SPA navigation handled via `history.pushState` monkey-patch
- Selectors bundled at build time (claude.ai CSP blocks runtime fetch of `selectors.json`)

**Storage**
- `chrome.storage.local`: conversations, index, meta, settings
- IndexedDB: `FileSystemDirectoryHandle` (not JSON-serializable)
- Dedup by role+content, session stitching by URL
- Rolling eviction at 100 conversations
- Each message stamped with UUID, `seq`, and `capturedAt`

**Export**
- JSONL per platform/role: `{platform}/{platform}_{role}_{timestamp}.jsonl`
- Incremental cursor (`meta.lastExportedAt`) — only new messages each run
- File System Access API with persisted folder handle
- Auto export via `chrome.alarms` at 11:59 PM daily (opt-in)

**UI**
- Main popup: conversations grouped by platform, collapsible, sorted by `updatedAt`
- Export popup: reads settings, validates folder config, shows warnings
- Settings popup: Display (max convos per platform) + Export (folder path, auto export toggle)
- About popup

### What's not yet done
- ChatGPT and Gemini selectors (stubs only)
- S3 export (UI placeholder, not implemented)
- Query/retrieval layer above the exported JSONL
- Assistant message capture (user messages only for now)
