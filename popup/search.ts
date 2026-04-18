import type {
  BridgeStatus,
  Capabilities,
  ExportRecord,
  SearchHit,
  SearchOpts,
} from '../src/shared/types';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeSnippet(html: string): string {
  // Snippet arrives as pre-escaped HTML with only <mark> tags.
  // Strip any tag that isn't <mark> or </mark> — leave entities intact.
  return html.replace(/<(?!\/?mark\b)[^>]*>/gi, '');
}

function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

type SearchResponse =
  | { ok: true; hits: SearchHit[] }
  | { ok: false; error: { code: string; message: string } };

type BridgeStatusResponse =
  | { ok: true; status: BridgeStatus; capabilities?: Capabilities }
  | { ok: false; status: BridgeStatus; error?: { code: string; message: string } };

type GetConversationFullResponse =
  | { ok: true; records: ExportRecord[] }
  | { ok: false; error: { code: string; message: string } };

type TriggerIngestResponse =
  | { ok: true; ingested: number; skipped: number; durationMs: number }
  | { ok: false; error: { code: string; message: string } };

let currentQuery = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentOpts: SearchOpts = {};
let activePlatforms: Set<string> = new Set();
let activeRole: 'user' | 'assistant' | undefined;

function getMainContent(): HTMLElement {
  return document.getElementById('main-content')!;
}

function renderInstallScreen(): void {
  const el = getMainContent();
  el.innerHTML = `
    <div class="install-screen">
      <h2>Search needs a small helper</h2>
      <p>Recall Bridge indexes your captured conversations locally so you can search them. It runs on your machine and never sends data anywhere.</p>
      <a class="install-link" href="https://github.com/ty-asuralo/recall-bridge/releases" target="_blank">Install Recall Bridge</a>
      <button class="btn-action secondary" id="btn-retry-install">Check again</button>
    </div>
  `;
  document.getElementById('btn-retry-install')!.addEventListener('click', () => {
    void initPage();
  });
}

function renderErrorScreen(message: string): void {
  const el = getMainContent();
  el.innerHTML = `
    <div class="install-screen">
      <h2>Could not connect</h2>
      <p>${escHtml(message)}</p>
      <button class="btn-action" id="btn-retry-error">Retry</button>
    </div>
  `;
  document.getElementById('btn-retry-error')!.addEventListener('click', () => {
    void initPage();
  });
}

function renderSearchUI(capabilities: Capabilities | undefined): void {
  const el = getMainContent();
  el.innerHTML = `
    <div class="search-input-wrap">
      <input class="search-input" id="search-input" type="search" placeholder="Search your conversations…" autocomplete="off" />
    </div>

    <div class="filters-toggle">
      <button class="btn-filters" id="btn-filters-toggle">Filters</button>
    </div>

    <div class="filters-panel" id="filters-panel">
      <div class="filter-row">
        <span class="filter-label">Platform</span>
        <span class="chip active" data-platform="all">All</span>
        <span class="chip" data-platform="claude"><span class="platform-dot-inline claude"></span>Claude</span>
        <span class="chip" data-platform="chatgpt"><span class="platform-dot-inline chatgpt"></span>ChatGPT</span>
        <span class="chip" data-platform="gemini"><span class="platform-dot-inline gemini"></span>Gemini</span>
      </div>
      <div class="filter-row">
        <span class="filter-label">Role</span>
        <span class="chip active" data-role="both">Both</span>
        <span class="chip" data-role="user">User</span>
        <span class="chip" data-role="assistant">Assistant</span>
      </div>
      <div class="filter-row">
        <span class="filter-label">Date</span>
        <div class="date-inputs">
          <input class="date-input" id="filter-since" type="date" />
          <span class="date-sep">→</span>
          <input class="date-input" id="filter-until" type="date" />
        </div>
      </div>
    </div>

    <div class="results" id="results">
      <div class="state-box" id="initial-state">
        <div>Type to search your captured conversations.</div>
      </div>
    </div>

    <div class="bridge-footer" id="bridge-footer">
      <div class="bridge-status-dot ready"></div>
      <span>${capabilities ? escHtml(capabilities.backend) + ' ' + escHtml(capabilities.backendVersion) : 'Connected'}</span>
      <span class="footer-spacer"></span>
      <button class="footer-link" id="btn-footer-rebuild">Rebuild index</button>
      <button class="footer-link" id="btn-footer-settings">Settings</button>
    </div>
  `;

  const input = document.getElementById('search-input') as HTMLInputElement;
  input.focus();

  // Filters toggle
  const filtersBtn = document.getElementById('btn-filters-toggle')!;
  const filtersPanel = document.getElementById('filters-panel')!;
  filtersBtn.addEventListener('click', () => {
    const open = filtersPanel.classList.toggle('open');
    filtersBtn.classList.toggle('active', open);
  });

  // Platform chips
  filtersPanel.querySelectorAll('[data-platform]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const plat = (chip as HTMLElement).dataset['platform']!;
      filtersPanel.querySelectorAll('[data-platform]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (plat === 'all') {
        activePlatforms = new Set();
        currentOpts = { ...currentOpts, platforms: undefined };
      } else {
        activePlatforms = new Set([plat]);
        currentOpts = { ...currentOpts, platforms: [plat as 'claude' | 'chatgpt' | 'gemini'] };
      }
      if (currentQuery) fireSearch();
    });
  });

  // Role chips
  filtersPanel.querySelectorAll('[data-role]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const role = (chip as HTMLElement).dataset['role']!;
      filtersPanel.querySelectorAll('[data-role]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (role === 'both') {
        activeRole = undefined;
        currentOpts = { ...currentOpts, role: undefined };
      } else {
        activeRole = role as 'user' | 'assistant';
        currentOpts = { ...currentOpts, role: activeRole };
      }
      if (currentQuery) fireSearch();
    });
  });

  // Date inputs
  document.getElementById('filter-since')!.addEventListener('change', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentOpts = { ...currentOpts, since: val ? new Date(val).getTime() : undefined };
    if (currentQuery) fireSearch();
  });
  document.getElementById('filter-until')!.addEventListener('change', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentOpts = { ...currentOpts, until: val ? new Date(val + 'T23:59:59').getTime() : undefined };
    if (currentQuery) fireSearch();
  });

  // Query input with debounce
  input.addEventListener('input', () => {
    const q = input.value.trim();
    currentQuery = q;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (!q) {
      renderInitialState();
      return;
    }
    debounceTimer = setTimeout(() => {
      fireSearch();
    }, 200);
  });

  // Footer actions
  document.getElementById('btn-footer-rebuild')!.addEventListener('click', () => {
    void triggerIngest(true);
  });
  document.getElementById('btn-footer-settings')!.addEventListener('click', () => {
    void chrome.windows.create({
      url: chrome.runtime.getURL('popup/settings.html'),
      type: 'popup',
      width: 400,
      height: 520,
    });
  });
}

function renderInitialState(): void {
  const results = document.getElementById('results');
  if (!results) return;
  results.innerHTML = `<div class="state-box"><div>Type to search your captured conversations.</div></div>`;
}

function renderLoadingState(): void {
  const results = document.getElementById('results');
  if (!results) return;
  results.innerHTML = `<div class="state-box"><span class="spinner"></span>Searching…</div>`;
}

function renderEmptyState(): void {
  const results = document.getElementById('results');
  if (!results) return;
  results.innerHTML = `
    <div class="state-box">
      <strong>No matches</strong>
      <div>Try broader terms or check that ingest has run.</div>
      <button class="btn-action secondary" id="btn-ingest-now">Ingest now</button>
    </div>
  `;
  document.getElementById('btn-ingest-now')!.addEventListener('click', () => {
    void triggerIngest(false);
  });
}

function renderErrorState(message: string): void {
  const results = document.getElementById('results');
  if (!results) return;
  results.innerHTML = `<div class="state-box"><strong style="color:#c00">Error</strong><div>${escHtml(message)}</div></div>`;
}

function renderHits(hits: SearchHit[]): void {
  const results = document.getElementById('results');
  if (!results) return;

  results.innerHTML = hits.map((hit, i) => {
    const r = hit.record;
    const snippet = sanitizeSnippet(hit.snippet || '');
    return `
      <div class="hit-card" data-index="${i}">
        <div class="hit-meta">
          <span class="platform-dot ${escHtml(r.platform)}"></span>
          <span class="hit-title">${escHtml(r.title || 'Untitled')}</span>
          <span class="hit-role">${escHtml(r.role)}</span>
          <span class="hit-time">${relativeTime(r.capturedAt)}</span>
        </div>
        <div class="hit-snippet">${snippet}</div>
        <div class="hit-thread" id="thread-${i}"></div>
      </div>
    `;
  }).join('');

  results.querySelectorAll('.hit-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      const hit = hits[i]!;
      const wasExpanded = card.classList.contains('expanded');
      results.querySelectorAll('.hit-card').forEach((c) => c.classList.remove('expanded'));
      if (!wasExpanded) {
        card.classList.add('expanded');
        void loadThread(hit.record.conversationId, i);
      }
    });
  });
}

async function loadThread(conversationId: string, index: number): Promise<void> {
  const threadEl = document.getElementById(`thread-${index}`);
  if (!threadEl) return;
  threadEl.innerHTML = `<div class="thread-loading"><span class="spinner"></span>Loading…</div>`;

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_CONVERSATION_FULL',
      conversationId,
    }) as GetConversationFullResponse;

    if (!resp.ok) {
      threadEl.innerHTML = `<div class="thread-error">${escHtml(resp.error.message)}</div>`;
      return;
    }

    if (!resp.records || resp.records.length === 0) {
      threadEl.innerHTML = `<div class="thread-loading">No messages found.</div>`;
      return;
    }

    threadEl.innerHTML = resp.records.map((rec) => `
      <div class="thread-msg ${escHtml(rec.role)}">
        <div class="thread-msg-role">${escHtml(rec.role)}</div>
        <div>${escHtml(rec.content)}</div>
      </div>
    `).join('');
  } catch (e) {
    threadEl.innerHTML = `<div class="thread-error">Failed to load conversation.</div>`;
  }
}

async function triggerIngest(rebuild: boolean): Promise<void> {
  const ingestBtn = document.getElementById('btn-ingest-now') as HTMLButtonElement | null;
  const rebuildBtn = document.getElementById('btn-footer-rebuild') as HTMLButtonElement | null;
  const activeBtn = ingestBtn ?? rebuildBtn;
  if (activeBtn) {
    activeBtn.disabled = true;
    activeBtn.textContent = 'Ingesting…';
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'TRIGGER_INGEST',
      rebuild,
    }) as TriggerIngestResponse;

    if (activeBtn) {
      if (resp.ok) {
        activeBtn.textContent = `Done (${resp.ingested} indexed)`;
        setTimeout(() => { activeBtn.textContent = 'Rebuild index'; activeBtn.disabled = false; }, 2500);
      } else {
        activeBtn.textContent = 'Failed';
        activeBtn.disabled = false;
      }
    }
  } catch {
    if (activeBtn) { activeBtn.textContent = 'Failed'; activeBtn.disabled = false; }
  }
}

function fireSearch(): void {
  if (!currentQuery) return;
  renderLoadingState();
  void doSearch(currentQuery, currentOpts);
}

async function doSearch(query: string, opts: SearchOpts): Promise<void> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'SEARCH_QUERY',
      query,
      opts,
    }) as SearchResponse;

    if (query !== currentQuery) return; // stale

    if (!resp.ok) {
      renderErrorState(resp.error.message);
      return;
    }

    if (resp.hits.length === 0) {
      renderEmptyState();
    } else {
      renderHits(resp.hits);
    }
  } catch (e) {
    renderErrorState('Search failed. Is Recall Bridge running?');
  }
}

async function initPage(): Promise<void> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_BRIDGE_STATUS',
    }) as BridgeStatusResponse;

    const status: BridgeStatus = resp.ok ? resp.status : (resp.status ?? 'error');

    if (status === 'not-installed') {
      renderInstallScreen();
    } else if (status === 'error' || !resp.ok) {
      const msg = (!resp.ok && resp.error) ? resp.error.message : 'Bridge returned an error.';
      renderErrorScreen(msg);
    } else {
      const caps = resp.ok ? resp.capabilities : undefined;
      renderSearchUI(caps);
    }
  } catch {
    renderErrorScreen('Could not reach the extension background. Try reopening this window.');
  }
}

document.getElementById('btn-close')!.addEventListener('click', () => window.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

void initPage();
