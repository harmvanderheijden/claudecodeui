# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web-based UI (desktop + mobile) for driving AI coding CLIs — **Claude Code**, **Cursor CLI**, and **Codex** — over the network. The browser talks to an Express + WebSocket backend that spawns/queries the underlying CLIs and streams results back. Published to npm as `@siteboon/claude-code-ui` with bins `claude-code-ui` and `cloudcli`.

## Commands

```bash
npm run dev        # Frontend (Vite :5173) + backend (Express :3001) concurrently — primary dev loop
npm run server     # Backend only (node server/index.js)
npm run client     # Vite dev server only
npm run build      # Production build to dist/
npm run start       # build + run server (serves dist/ statically)
npm run typecheck  # tsc --noEmit — the only static check; run before finishing TS/JS changes
```

There is **no test suite and no linter** configured. `typecheck` is the only automated gate. Node **22+** required (`.nvmrc` = v22). Vite proxies `/api`, `/ws`, and `/shell` from the client to the backend port, so the frontend talks to one origin in dev.

`postinstall` runs `scripts/fix-node-pty.js` (chmod the node-pty spawn-helper, a known macOS bug) and `scripts/copy-pdfjs-wasm.js` (copies OpenJPEG WASM into `public/` for PDF.js JPEG2000 decoding). If terminal spawning or PDF rendering breaks after a fresh install, re-run these.

## Architecture

### Multi-provider CLI abstraction

The backend integrates **three** coding agents behind a uniform WebSocket protocol. Each has its own server module:

- `server/claude-sdk.js` — Claude via `@anthropic-ai/claude-agent-sdk` (`query()`), **not** by shelling out to the `claude` binary. Maps UI options → SDK options (`mapCliOptionsToSDK`), handles tool-permission approval round-trips, image temp files, and MCP config loading.
- `server/cursor-cli.js` — Cursor agent (`spawnCursor`).
- `server/openai-codex.js` — Codex via `@openai/codex-sdk` (`queryCodex`).

Each module exports the same lifecycle quartet: `query/spawn`, `abort…Session`, `is…SessionActive`, `getActive…Sessions`. When adding provider behavior, keep this symmetry — the WebSocket router and frontend both branch on a `provider` field (`'claude' | 'cursor' | 'codex'`).

**Claude session modes (env `CLAUDE_PERSISTENT_SESSIONS`, default on).** By default `server/claude-persistent-sessions.js` (a server-root peer of `claude-sdk.js`) keeps ONE long-lived streaming `query()` per chat session alive across prompts via an input pump, so the Claude Code subprocess and its MCP servers stay warm (their in-memory state survives between prompts). Set `CLAUDE_PERSISTENT_SESSIONS=false` to opt out and fall back to the legacy one-shot path, where each prompt runs a string-prompt `query()` that spawns a fresh subprocess, `resume`s history from JSONL, and exits — restarting MCP servers (and losing their state) every prompt. The persistent module reuses `claude-sdk.js`'s exported helpers (incl. `createClaudeQueryHandlers` for the shared permission/notification logic). `index.js` composes the flag-gated Claude lifecycle functions into the chat WebSocket deps, so `chat-websocket.service.ts` is mode-agnostic. Lifecycle (idle timeout, LRU cap, graceful shutdown) is governed by `CLAUDE_SESSION_IDLE_TIMEOUT_MS` / `CLAUDE_MAX_PERSISTENT_SESSIONS`.

### WebSocket protocol (the core data path)

`server/index.js` runs two WebSocket servers on one HTTP server:
- **`/ws`** — chat/command channel. Inbound message `type` dispatches to a provider: `claude-command` / `cursor-command` / `codex-command`, plus control messages `abort-session`, `claude-permission-response`, `check-session-status`, `get-active-sessions`. Messages carry `provider` to select the backend.
- **`/shell`** — interactive PTY channel (node-pty), used by the in-browser terminal (`Shell.jsx`). Can launch a plain shell or attach to a CLI session.

Sessions and chat history are **not** stored by this app — they live in the CLI's own files: Claude in `~/.claude/projects/<encoded-path>/*.jsonl`, Cursor in `~/.cursor/chats/`, Codex in its own JSONL. The read/parse layer lives under `server/modules/projects/` (project discovery/management services + DB repositories) and `server/modules/providers/list/claude/` (JSONL transcript parsing, e.g. `claude-sessions.provider.ts`); it scans those directories, parses transcripts, generates display names, and reconciles them with manually-added projects.

> Note: the "Backend layout" and other structural sections below predate the upstream v1.34.0 merge, which restructured the backend into `server/modules/**` (TypeScript services + repositories). They're directionally useful but partially stale — verify against the tree. The Claude session-modes section above is current.

### Backend layout

- `server/index.js` — HTTP + WebSocket setup, static serving, and a few inline routes (files, filesystem browse, transcribe). Mounts all `server/routes/*` under `/api/*`.
- `server/routes/` — REST handlers: `git.js`, `auth.js`, `mcp.js`, `cursor.js`, `codex.js`, `agent.js`, `commands.js` (slash commands), `settings.js`, `taskmaster.js` (TaskMaster AI integration), `projects.js` (workspace path validation), `cli-auth.js`, `user.js`.
- `server/database/` — SQLite (`better-sqlite3`) via `db.js`; schema in `init.sql`. Stores **users, API keys, and credentials only** — see auth below. DB file defaults to `server/database/auth.db` (override with `DATABASE_PATH`).
- `server/middleware/auth.js`, `server/constants/config.js` (`IS_PLATFORM` flag), `server/utils/`.

### Auth model

**Single-user system.** First run creates the one user (bcrypt password). Two auth layers, both required for `/api/*`:
1. `validateApiKey` — checks the `API_KEY` env var (a static gate on the whole API surface).
2. `authenticateToken` — JWT per request; WebSocket uses `authenticateWebSocket`.

`/health` is the only unauthenticated endpoint. In Platform mode (`VITE_IS_PLATFORM=true`) a single DB user is assumed.

**Tools are disabled by default** — Claude Code tool permissions must be explicitly enabled per-tool in the UI settings; the backend enforces a permission approval handshake over the WebSocket before a tool runs.

### Workspace sandboxing

`server/routes/projects.js` exports `WORKSPACES_ROOT` (defaults to `os.homedir()`, override via `WORKSPACES_ROOT`) and `validateWorkspacePath()`, which resolves realpaths and rejects anything outside the root or in `FORBIDDEN_PATHS`. Any new endpoint that accepts a user-supplied filesystem path must run it through `validateWorkspacePath`.

### Frontend (React 18 + Vite + Tailwind, mostly TS)

- Entry `src/main.jsx` → `src/App.tsx` → `src/components/app/AppContent.tsx`. Provider nesting in `App.tsx`: I18n → Theme → Auth → **WebSocket** → TasksSettings → TaskMaster → ProtectedRoute → Router.
- `src/contexts/WebSocketContext.tsx` is the single client WebSocket; components consume `ws`, `sendMessage`, `latestMessage` from `useWebSocket()`.
- Layout = `Sidebar` (`components/sidebar/`) + `MainContent` (`components/main-content/`), which switches between tabs (chat / files / git / shell / tasks).
- **Chat tool rendering** (`src/components/chat/tools/`) is config-driven — see its `README.md`. All per-tool display lives in `configs/toolConfigs.ts`; `ToolRenderer.tsx` is the single router using two base patterns (`OneLineDisplay`, `CollapsibleDisplay`). Add a tool's display by adding a config entry, not by scattering conditionals.
- Chat state is split across hooks in `src/components/chat/hooks/` (composer, provider, realtime handlers, session, file mentions, slash commands).
- i18n via `react-i18next`; locales in `src/i18n/locales/`. New user-facing strings go through translation keys.

### Shared

`shared/modelConstants.js` is the single source of truth for model lists (Claude/Cursor/Codex). Note Claude uses **two formats**: SDK format (`sonnet`, `opus`) for the actual SDK calls, and API format (`claude-sonnet-4.5`) for slash-command display. Imported by both client and server.

## Conventions

- ESM throughout (`"type": "module"`); use `import`, not `require`.
- Frontend is mid-migration from `.jsx` to `.tsx` — new components should be `.tsx`. `tsconfig` has `allowJs` and `strict` on but `checkJs` off.
- The repo is GPL-3.0. `README.md` is canonical; localized READMEs (ko/zh-CN/ja) exist but need not be updated for code changes.
