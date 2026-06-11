/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: Persistent Claude sessions
 *
 * When enabled, a Claude chat session keeps ONE long-lived streaming `query()`
 * (and therefore one Claude Code subprocess) alive across prompts, instead of
 * spawning a fresh subprocess per prompt via `resume`. This keeps MCP servers
 * warm between prompts so their in-memory state survives a multi-turn session.
 *
 * Read once at launch. Enabled by default; set CLAUDE_PERSISTENT_SESSIONS=false
 * to opt out and fall back to the legacy per-prompt behavior.
 */
export const CLAUDE_PERSISTENT_SESSIONS = process.env.CLAUDE_PERSISTENT_SESSIONS !== 'false';

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * How long a persistent Claude session may sit idle (no new prompt) before its
 * subprocess and MCP servers are torn down to free resources. Default 30 min.
 * Only relevant when CLAUDE_PERSISTENT_SESSIONS is enabled.
 */
export const CLAUDE_SESSION_IDLE_TIMEOUT_MS = parsePositiveInt(
  process.env.CLAUDE_SESSION_IDLE_TIMEOUT_MS,
  30 * 60 * 1000
);

/**
 * Maximum number of persistent Claude sessions kept resident at once. When the
 * cap is exceeded, the least-recently-used session is evicted (its subprocess
 * and MCP servers terminated). Default 10.
 */
export const CLAUDE_MAX_PERSISTENT_SESSIONS = parsePositiveInt(
  process.env.CLAUDE_MAX_PERSISTENT_SESSIONS,
  10
);