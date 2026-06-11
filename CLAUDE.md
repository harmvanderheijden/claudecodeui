# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This is a **fork** of `siteboon/claudecodeui` (upstream), tracked at v1.34.0+. Fork-specific additions: document viewers (PDF/docx/markdown), persistent Claude sessions, and a few chat/markdown tweaks. `CLAUDE.md` is gitignored upstream but force-tracked here; expect to reconcile that at the next upstream merge.

## What this is

A web-based UI (desktop + mobile) for driving AI coding CLIs over the network. The browser talks to an Express + WebSocket backend that spawns/queries the underlying CLIs and streams results back. Published to npm as `@cloudcli-ai/cloudcli` (bins `claude-code-ui`, `cloudcli`). Five providers are supported: **Claude, Cursor, Codex, Gemini, OpenCode**.

## Commands

```bash
npm run dev          # server:dev (tsx) + client (vite) concurrently — primary dev loop
npm run server:dev   # backend only, via tsx (runs TS directly, no build step)
npm run client       # vite dev server only
npm run build        # build:client (vite → dist/) then build:server (tsc → dist-server/)
npm run server       # run the COMPILED backend (node dist-server/server/index.js)
npm run typecheck    # tsc --noEmit for BOTH tsconfig.json (client) and server/tsconfig.json
npm run lint         # eslint src/ server/   (lint:fix to autofix)
npm start            # build + run compiled server
```

Key facts:
- **Node 22+** (`.nvmrc`). The backend is a **TypeScript-with-allowJs** codebase compiled by `tsc` to `dist-server/` for production; dev runs it directly through `tsx`. Plain `.js` files (e.g. `server/claude-sdk.js`) are first-class — `allowJs: true, checkJs: false`.
- There is **no test runner wired into `package.json`** (some `*.test.ts`/`*.integration.test.ts` files exist but aren't run by a script). `typecheck` + `lint` are the automated gates.
- **Git hooks are enforced** (husky): pre-commit runs `lint-staged` (eslint on staged JS/TS), and commit messages must follow **Conventional Commits** (commitlint) — e.g. `feat: …`, `fix: …`. Non-conforming subjects are rejected.
- `postinstall` runs `scripts/fix-node-pty.js` (chmod node-pty's spawn-helper, a macOS bug) and `scripts/copy-pdfjs-wasm.js` (copies OpenJPEG WASM into `public/` for PDF.js). Re-run these if terminal spawning or PDF rendering breaks after install.
- Path alias **`@/`** exists in both tsconfigs but maps differently: `@/*` → `src/*` (frontend), `@/*` → `server/*` (backend). Vite also aliases `@` → `src`.

## Architecture

### Multi-provider CLI abstraction

Each provider has a **runtime module at `server/` root** that talks to its CLI/SDK and exposes the same lifecycle quartet (`query/spawn`, `abort…Session`, `is…SessionActive`, `getActive…Sessions`):
- `server/claude-sdk.js` — Claude via `@anthropic-ai/claude-agent-sdk` `query()` (not by shelling out). Maps UI options → SDK options (`mapCliOptionsToSDK`), runs the tool-permission approval round-trip (`createClaudeQueryHandlers`), handles image temp files and MCP config loading.
- `server/cursor-cli.js`, `server/openai-codex.js`, `server/gemini-cli.js` (+ `gemini-response-handler.js`), `server/opencode-cli.js`.

Higher-level provider concerns live in the **`server/modules/providers/`** module: `provider.registry.ts` (registration), `provider.routes.ts` (`/api/providers`), `list/<name>/*.provider.ts` (auth, MCP, skills, sessions, models per provider), and `shared/{base,mcp,skills}`. **See `server/modules/providers/README.md`** for the contracts. The WebSocket router and frontend both branch on a `provider` field (`'claude' | 'cursor' | 'codex' | 'gemini' | 'opencode'`).

**Claude session modes (env `CLAUDE_PERSISTENT_SESSIONS`, default ON — fork feature).** By default `server/claude-persistent-sessions.js` (a server-root peer of `claude-sdk.js`) keeps ONE long-lived streaming `query()` per chat session alive across prompts via an input pump, so the Claude Code subprocess and its MCP servers stay **warm** (their in-memory state survives between prompts). Set `CLAUDE_PERSISTENT_SESSIONS=false` to opt out and use the legacy one-shot path, where each prompt runs a string-prompt `query()` that spawns a fresh subprocess, `resume`s history from JSONL, and exits — restarting MCP servers every prompt. The persistent module reuses `claude-sdk.js`'s exported helpers (incl. `createClaudeQueryHandlers`). `index.js` composes the flag-gated Claude lifecycle into the chat WebSocket deps, so `chat-websocket.service.ts` is mode-agnostic. Lifecycle (idle timeout, LRU cap, graceful shutdown so MCP children aren't orphaned) is governed by `CLAUDE_SESSION_IDLE_TIMEOUT_MS` / `CLAUDE_MAX_PERSISTENT_SESSIONS`.

### WebSocket layer (the core data path)

`server/modules/websocket/` (createWebSocketServer + services; **see its README.md**) runs everything on one HTTP server across three paths:
- **`/ws`** — chat/command channel. `chat-websocket.service.ts` dispatches inbound `type` to a provider: `claude-command` / `cursor-command` / `codex-command` / `gemini-command` / `opencode-command`, plus control messages (`abort-session`, `claude-permission-response`, `check-session-status`, `get-active-sessions`). A `WebSocketWriter` (`send`, `setSessionId`, `updateWebSocket`) adapts the raw socket; `updateWebSocket` lets a session's output follow a **reconnected** client (page refresh) via `reconnectSessionWriter`.
- **`/shell`** — interactive PTY (node-pty) for the in-browser terminal; sessions tracked by `server/sessionManager.js`.
- **`/plugin-ws`** — proxy to plugin-provided WebSocket servers.

### Sessions, projects, and the database

The DB (`better-sqlite3`, `server/modules/database/`: `connection.ts`, `schema.ts`, `migrations.ts`, `repositories/*`) is a **metadata/index layer**, not the chat store. Transcript content still lives in the **CLI's own JSONL files** (Claude `~/.claude/projects/<encoded>/*.jsonl`, Cursor `~/.cursor/chats/`, Codex/others their own). The DB indexes that: the `sessions` table holds `provider`, `project_path`, **`jsonl_path`**, `custom_name` (this is how session rename works), `isArchived`, timestamps; `projects` holds project metadata; `scan_state` tracks last filesystem scan. Other tables: `users`, `api_keys`, `user_credentials`, `push_subscriptions`, `vapid_keys`, `user_notification_preferences`, `app_config`. JSONL parsing/normalization lives in `server/modules/providers/list/claude/claude-sessions.provider.ts` (and peers); DB path defaults to `server/database/auth.db` (override `DATABASE_PATH`).

### REST routing

Mounted under `/api/*` in `server/index.js`. Two styles coexist (migration in progress): legacy handlers in **`server/routes/`** (`auth`, `git`, `cursor`, `gemini`, `commands`, `settings`, `taskmaster`, `mcp-utils`, `plugins`, `user`, `agent`) and module-owned routers (`/api/projects` → `modules/projects/projects.routes`, `/api/providers` → `modules/providers/provider.routes`).

### Auth model

**Single-user.** First run creates the one user (bcrypt). Two layers gate `/api/*`: `validateApiKey` (static `API_KEY` env check over the whole API) then `authenticateToken` (per-request JWT); WebSockets use `authenticateWebSocket` (`server/middleware/auth.js` + `modules/websocket/services/websocket-auth.service.ts`). `/health` is the only unauthenticated route. Claude tools are **disabled by default** — permissions are granted per-tool in the UI and enforced by the WebSocket approval handshake (`canUseTool`). `IS_PLATFORM` (`VITE_IS_PLATFORM`) toggles hosted-vs-OSS behavior.

### Notable subsystems

- **Plugins**: `/api/plugins` + `/plugin-ws`, `server/utils/plugin-loader.js` & `plugin-process-manager.js` (child processes, torn down on shutdown).
- **Web push notifications**: VAPID keys + `push_subscriptions`, `server/services/notification-orchestrator.js`, frontend `useWebPush`.
- **TaskMaster AI** integration (`server/routes/taskmaster.js`, `src/components/task-master/`).

### Frontend (React 18 + Vite + Tailwind, mostly TS)

- Entry `src/main.jsx` → `src/App.tsx` → `src/components/app/AppContent.tsx`. Provider nesting: I18n → Theme → Auth → **WebSocket** → Plugins → TasksSettings → TaskMaster → Router (additional contexts like Permission/PaletteOps wrap lower in the tree).
- `src/contexts/WebSocketContext.tsx` is the single client socket (`ws`, `sendMessage`, `latestMessage`). Session state is centralized in `src/stores/useSessionStore.ts` (a custom hook-based store, not a state library).
- Layout = `sidebar/` + `main-content/`, switching between chat / files / git / shell / tasks. Major component areas: `chat/`, `code-editor/`, `viewers/` (fork PDF/docx/markdown — routed via `code-editor/view/EditorSidebar.tsx`), `git-panel/`, `file-tree/`, `mcp/`, `plugins/`, `command-palette/`, `provider-auth/`, `settings/`, `task-master/`.
- **Chat tool rendering** (`src/components/chat/tools/`) is config-driven — see its `README.md`: all per-tool display lives in `configs/toolConfigs.ts`; `ToolRenderer.tsx` routes via `OneLineDisplay`/`CollapsibleDisplay`. Add a tool by adding a config entry, not scattering conditionals.
- i18n via `react-i18next` (`src/i18n/locales/`); new user-facing strings go through translation keys.

### Shared code

- `server/shared/` — backend-internal shared (`utils.ts` incl. `createNormalizedMessage`, `types.ts`, `interfaces.ts`). The eslint **boundaries** plugin (`eslint.config.js`) enforces what `server/modules/**` may import; importing unclassified server-root files from inside a module fails `boundaries/no-unknown` (this is why `claude-persistent-sessions.js` lives at server root as a peer of `claude-sdk.js`, not inside the module tree).
- `shared/` (repo root) — code shared with the client build (e.g. `networkHosts.js`, used by `vite.config.js`).

## Conventions

- ESM throughout (`"type": "module"`); use `import`, not `require`.
- Backend is mid-migration to TypeScript modules under `server/modules/**`; new backend code should prefer a module + `.ts`, but `.js` peers are fine for runtime files alongside `claude-sdk.js`. Frontend is migrating `.jsx` → `.tsx`; new components should be `.tsx`.
- **Conventional Commit messages are mandatory** (commit-msg hook). Keep changes lint-clean (pre-commit runs eslint via lint-staged).
- GPL-3.0. `README.md` is canonical; localized READMEs (ko/zh-CN/ja) need not track code changes.

## Fork-specific environment flags

```
CLAUDE_PERSISTENT_SESSIONS=true        # warm-MCP persistent sessions (default on; 'false' to disable)
CLAUDE_SESSION_IDLE_TIMEOUT_MS=1800000 # idle teardown of a persistent session (default 30m)
CLAUDE_MAX_PERSISTENT_SESSIONS=10      # LRU cap on resident persistent sessions
```
