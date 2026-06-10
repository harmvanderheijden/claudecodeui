/**
 * Persistent Claude Sessions
 *
 * Opt-in alternative to the per-prompt query path in claude-sdk.js. When
 * CLAUDE_PERSISTENT_SESSIONS is enabled, each chat session keeps ONE long-lived
 * streaming `query()` (and therefore one Claude Code subprocess) alive across
 * prompts, instead of spawning a fresh subprocess via `resume` on every prompt.
 *
 * Why: a fresh subprocess re-initializes all MCP servers from scratch, which
 * resets any in-memory state those servers hold. A persistent subprocess keeps
 * the MCP servers warm for the lifetime of the session.
 *
 * Mechanism: the SDK accepts `prompt: AsyncIterable<SDKUserMessage>` (streaming
 * input mode). We feed it from an input "pump" we can push new user turns into.
 * One consumer loop runs for the whole session; each turn ends with a `result`
 * message, at which point we emit the per-turn `complete` event and park the
 * loop until the next prompt is pushed.
 *
 * Lifecycle is explicit here (unlike the one-shot path, which tears down after
 * each turn): idle timeout, an LRU cap on resident sessions, and graceful
 * teardown on shutdown so MCP child processes are not orphaned.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

import {
  mapCliOptionsToSDK,
  loadMcpConfig,
  handleImages,
  cleanupTempFiles,
  extractTokenBudget,
  transformMessage,
  createClaudeQueryHandlers,
} from './claude-sdk.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunStopped, notifyRunFailed } from './services/notification-orchestrator.js';
import { createNormalizedMessage } from './shared/utils.js';
import {
  CLAUDE_SESSION_IDLE_TIMEOUT_MS,
  CLAUDE_MAX_PERSISTENT_SESSIONS,
} from './constants/config.js';

// Resident sessions keyed by Claude session id. A brand-new session is added
// only once its id arrives on the first SDK message.
const persistentSessions = new Map();

/**
 * A small async-generator-backed queue. The generator yields queued user
 * messages and parks (awaits) when empty; push() enqueues a turn and wakes it;
 * end() closes the stream so the SDK subprocess exits.
 */
function createInputPump() {
  const queue = [];
  let wake = null;
  let ended = false;
  async function* generator() {
    while (true) {
      if (queue.length) {
        yield queue.shift();
        continue;
      }
      if (ended) return;
      await new Promise((resolve) => { wake = resolve; });
    }
  }
  return {
    generator: generator(),
    push(text) {
      queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      if (wake) { wake(); wake = null; }
    },
    end() {
      ended = true;
      if (wake) { wake(); wake = null; }
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function clearIdleTimer(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function startIdleTimer(session) {
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    console.log(`[persistent-claude] session ${session.id} idle for ${CLAUDE_SESSION_IDLE_TIMEOUT_MS}ms, tearing down`);
    endSession(session.id, 'idle').catch((error) =>
      console.error(`[persistent-claude] idle teardown error for ${session.id}:`, error)
    );
  }, CLAUDE_SESSION_IDLE_TIMEOUT_MS);
  // Don't let the idle timer keep the process alive on its own.
  if (typeof session.idleTimer.unref === 'function') session.idleTimer.unref();
}

/**
 * Evict least-recently-used resident sessions until we're back under the cap.
 * Prefers idle sessions; never evicts a session with a turn in flight.
 */
async function enforceSessionCap() {
  if (persistentSessions.size <= CLAUDE_MAX_PERSISTENT_SESSIONS) return;
  const evictable = [...persistentSessions.values()]
    .filter((s) => s.status !== 'active' && !s.currentTurn)
    .sort((a, b) => a.lastActivity - b.lastActivity);
  while (persistentSessions.size > CLAUDE_MAX_PERSISTENT_SESSIONS && evictable.length) {
    const victim = evictable.shift();
    console.log(`[persistent-claude] cap exceeded, evicting LRU session ${victim.id}`);
    await endSession(victim.id, 'evicted').catch(() => {});
  }
}

/**
 * Public entry point used in place of queryClaudeSDK when persistent sessions
 * are enabled. Decides whether to push into a resident session or create one.
 */
async function queryClaudeSDKPersistent(command, options = {}, writer) {
  const { sessionId } = options;
  const resident = sessionId ? persistentSessions.get(sessionId) : null;

  if (resident && resident.status !== 'ended') {
    // A project switch (different cwd) genuinely requires a new subprocess and
    // a fresh MCP set; tear the old one down and recreate.
    if (resident.cwd !== options.cwd) {
      await endSession(resident.id, 'cwd-change');
    } else {
      return runOnResidentSession(resident, command, options, writer);
    }
  }

  return createAndRunSession(command, options, writer);
}

async function createAndRunSession(command, options, writer) {
  let resolvedModel;
  try {
    resolvedModel = await providerModelsService.resolveResumeModel('claude', options.sessionId, options.model);
  } catch {
    resolvedModel = options.model;
  }

  const sdkOptions = mapCliOptionsToSDK({ ...options, model: resolvedModel || options.model });

  const mcpServers = await loadMcpConfig(options.cwd);
  if (mcpServers) sdkOptions.mcpServers = mcpServers;

  const session = {
    id: options.sessionId || null,
    queryInstance: null,
    pump: createInputPump(),
    writer,
    sdkOptions,
    cwd: options.cwd,
    model: sdkOptions.model,
    permissionMode: sdkOptions.permissionMode || 'default',
    status: 'starting',
    lastActivity: Date.now(),
    idleTimer: null,
    currentTurn: null,
    isNewSession: !options.sessionId,
    sessionCreatedSent: false,
    interrupting: false,
    userId: writer?.userId || null,
    sessionSummary: options.sessionSummary,
    loopPromise: null,
  };

  const handlers = createClaudeQueryHandlers({
    sdkOptions,
    getWriter: () => session.writer,
    getSessionId: () => session.id || options.sessionId || null,
    sessionSummary: options.sessionSummary,
    userId: session.userId,
  });
  sdkOptions.hooks = handlers.notificationHook;
  sdkOptions.canUseTool = handlers.canUseTool;

  // The Query constructor reads this synchronously; raise it from the SDK's 5s
  // default so interactive tool prompts have time to round-trip to the UI.
  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';
  try {
    try {
      session.queryInstance = query({ prompt: session.pump.generator, options: sdkOptions });
    } catch (hookError) {
      console.warn('[persistent-claude] query init failed with hooks, retrying without:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      session.queryInstance = query({ prompt: session.pump.generator, options: sdkOptions });
    }
  } finally {
    if (prevStreamTimeout !== undefined) process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    else delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  }

  // If resuming a known session id, register up front so a quick follow-up
  // prompt finds it. New sessions are registered once their id arrives.
  if (session.id) persistentSessions.set(session.id, session);

  session.loopPromise = consumeLoop(session, options);
  await enforceSessionCap();

  return runTurn(session, command, options);
}

async function runOnResidentSession(session, command, options, writer) {
  // Adopt the current socket (handles reconnects / a new tab for the session).
  session.writer = writer;
  await applyRuntimeOptionChanges(session, options);
  return runTurn(session, command, options);
}

/**
 * Apply the option changes that the SDK supports mid-session without a restart:
 * model and permission mode via control requests, and the allow/deny tool lists
 * by mutating the live sdkOptions object that canUseTool reads.
 */
async function applyRuntimeOptionChanges(session, options) {
  const next = mapCliOptionsToSDK({ ...options, model: options.model || session.model });

  session.sdkOptions.allowedTools = next.allowedTools;
  session.sdkOptions.disallowedTools = next.disallowedTools;
  session.sdkOptions.permissionMode = next.permissionMode || 'default';

  if (next.model && next.model !== session.model) {
    try {
      await session.queryInstance.setModel(next.model);
      session.model = next.model;
    } catch (error) {
      console.warn(`[persistent-claude] setModel failed for ${session.id}:`, error?.message || error);
    }
  }

  const nextMode = next.permissionMode || 'default';
  if (nextMode !== session.permissionMode) {
    try {
      await session.queryInstance.setPermissionMode(nextMode);
      session.permissionMode = nextMode;
    } catch (error) {
      console.warn(`[persistent-claude] setPermissionMode failed for ${session.id}:`, error?.message || error);
    }
  }
}

/**
 * Push one user prompt and return a promise that resolves when that turn's
 * `result` is processed. Mirrors the await semantics of the one-shot path so the
 * websocket handler's `await queryClaudeSDK(...)` still resolves per prompt.
 */
async function runTurn(session, command, options) {
  if (session.currentTurn) {
    session.writer.send(createNormalizedMessage({
      kind: 'error',
      content: 'A prompt is already in progress for this session.',
      sessionId: session.id,
      provider: 'claude',
    }));
    return;
  }

  const imageResult = await handleImages(command, options.images, session.cwd);

  const turn = createDeferred();
  turn.tempImagePaths = imageResult.tempImagePaths;
  turn.tempDir = imageResult.tempDir;
  // `complete` carries isNewSession only for the very first turn of a new session.
  turn.isNewSession = session.isNewSession && !session.sessionCreatedSent;

  session.currentTurn = turn;
  session.status = 'active';
  session.lastActivity = Date.now();
  clearIdleTimer(session);

  session.pump.push(imageResult.modifiedCommand);
  return turn.promise;
}

/**
 * The single long-lived consumer loop for a session. Routes every SDK message to
 * the (swappable) writer and treats each `result` as a turn boundary.
 */
async function consumeLoop(session, options) {
  try {
    for await (const message of session.queryInstance) {
      // Capture + register the session id from the first message that carries it.
      if (message.session_id && !session.id) {
        session.id = message.session_id;
        persistentSessions.set(session.id, session);
        if (typeof session.writer.setSessionId === 'function') {
          session.writer.setSessionId(session.id);
        }
        if (session.isNewSession && !session.sessionCreatedSent) {
          session.sessionCreatedSent = true;
          session.writer.send(createNormalizedMessage({
            kind: 'session_created',
            newSessionId: session.id,
            sessionId: session.id,
            provider: 'claude',
          }));
        }
      }

      const transformed = transformMessage(message);
      const sid = session.id || options.sessionId || null;
      const normalized = sessionsService.normalizeMessage('claude', transformed, sid);
      for (const msg of normalized) {
        if (transformed.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformed.parentToolUseId;
        }
        session.writer.send(msg);
      }

      const tokenBudget = extractTokenBudget(message);
      if (tokenBudget) {
        session.writer.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget,
          sessionId: sid,
          provider: 'claude',
        }));
      }

      if (message.type === 'result') {
        await finishTurn(session);
      }
    }
    // Generator returned: input was ended (teardown) or the subprocess exited.
    handleLoopEnd(session, null);
  } catch (error) {
    console.error(`[persistent-claude] loop error for session ${session.id}:`, error);
    handleLoopEnd(session, error);
  }
}

async function finishTurn(session) {
  const turn = session.currentTurn;
  session.currentTurn = null;
  session.status = 'idle';
  session.lastActivity = Date.now();

  if (turn) await cleanupTempFiles(turn.tempImagePaths, turn.tempDir);

  // When we initiated an interrupt, the abort handler owns the `complete` event
  // (with aborted:true). Otherwise emit the per-turn completion here.
  if (!session.interrupting) {
    session.writer.send(createNormalizedMessage({
      kind: 'complete',
      exitCode: 0,
      isNewSession: turn?.isNewSession || false,
      sessionId: session.id,
      provider: 'claude',
    }));
    notifyRunStopped({
      userId: session.userId,
      provider: 'claude',
      sessionId: session.id,
      sessionName: session.sessionSummary,
      stopReason: 'completed',
    });
  }
  session.interrupting = false;

  startIdleTimer(session);
  if (turn?.resolve) turn.resolve();
}

function handleLoopEnd(session, error) {
  clearIdleTimer(session);
  const turn = session.currentTurn;
  session.currentTurn = null;
  session.status = 'ended';

  if (error) {
    session.writer.send(createNormalizedMessage({
      kind: 'error',
      content: error.message || String(error),
      sessionId: session.id,
      provider: 'claude',
    }));
    notifyRunFailed({
      userId: session.userId,
      provider: 'claude',
      sessionId: session.id,
      sessionName: session.sessionSummary,
      error,
    });
  }

  // If a prompt was still awaiting, release it so the caller doesn't hang.
  if (turn) {
    if (!session.interrupting) {
      session.writer.send(createNormalizedMessage({
        kind: 'complete',
        exitCode: error ? 1 : 0,
        sessionId: session.id,
        provider: 'claude',
      }));
    }
    if (turn.tempImagePaths) cleanupTempFiles(turn.tempImagePaths, turn.tempDir).catch(() => {});
    if (turn.resolve) turn.resolve();
  }

  if (session.id) persistentSessions.delete(session.id);
}

/**
 * Abort the in-flight turn but keep the session (and its MCP servers) resident
 * and warm, so the next prompt continues in the same subprocess. Returns true if
 * a session was found.
 */
async function abortClaudePersistentSession(sessionId) {
  const session = persistentSessions.get(sessionId);
  if (!session) return false;

  try {
    if (session.currentTurn && session.status === 'active') {
      session.interrupting = true;
      await session.queryInstance.interrupt();
    }
    return true;
  } catch (error) {
    console.error(`[persistent-claude] interrupt failed for ${sessionId}:`, error);
    session.interrupting = false;
    return false;
  }
}

/**
 * Fully tear down a session: end its input stream so the subprocess (and MCP
 * servers) exit, and drop it from the registry. Used for idle timeout, LRU
 * eviction, project switches, and shutdown.
 */
async function endSession(sessionId, reason = 'ended') {
  const session = persistentSessions.get(sessionId);
  if (!session) return false;

  console.log(`[persistent-claude] ending session ${sessionId} (${reason})`);
  clearIdleTimer(session);
  session.status = 'ended';
  persistentSessions.delete(sessionId);

  try {
    // Interrupt any in-flight turn first so the subprocess stops promptly, then
    // close the input stream to let it exit cleanly.
    if (session.currentTurn) {
      session.interrupting = true;
      await session.queryInstance.interrupt().catch(() => {});
    }
    session.pump.end();
    // Bound how long we wait for the loop to drain before moving on.
    await Promise.race([
      session.loopPromise,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (error) {
    console.error(`[persistent-claude] error ending session ${sessionId}:`, error);
  }
  return true;
}

async function endAllClaudePersistentSessions() {
  const ids = [...persistentSessions.keys()];
  await Promise.allSettled(ids.map((id) => endSession(id, 'shutdown')));
}

function reconnectPersistentSessionWriter(sessionId, newRawWs) {
  const session = persistentSessions.get(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[persistent-claude] writer swapped for session ${sessionId}`);
  return true;
}

function isClaudePersistentSessionActive(sessionId) {
  const session = persistentSessions.get(sessionId);
  return Boolean(session) && session.status !== 'ended';
}

function hasClaudePersistentSession(sessionId) {
  return persistentSessions.has(sessionId);
}

function getActiveClaudePersistentSessions() {
  return [...persistentSessions.keys()];
}

export {
  queryClaudeSDKPersistent,
  abortClaudePersistentSession,
  endSession as endClaudePersistentSession,
  endAllClaudePersistentSessions,
  reconnectPersistentSessionWriter,
  isClaudePersistentSessionActive,
  hasClaudePersistentSession,
  getActiveClaudePersistentSessions,
};
