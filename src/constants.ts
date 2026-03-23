// ============================================================================
// ClawForum Internal Constants
// ============================================================================
// Centralized location for all magic numbers and internal constants.
// Organized by functional domain for maintainability.
// ============================================================================

// ----------------------------------------------------------------------------
// System Identities
// ----------------------------------------------------------------------------

/** Motion claw identifier - the root orchestrator claw */
export const MOTION_CLAW_ID = 'motion';

// ----------------------------------------------------------------------------
// Process Management
// ----------------------------------------------------------------------------

/** Max time to wait for process spawn confirmation (ms) — polls every 50ms */
export const PROCESS_SPAWN_CONFIRM_MS = 3000;

/** Grace period for SIGTERM before SIGKILL (ms) */
export const SIGTERM_GRACE_MS = 5000;

/** Delay between process restart attempts (ms) */
export const RESTART_DELAY_MS = 1000;

// ----------------------------------------------------------------------------
// File System Tools
// ----------------------------------------------------------------------------

/** Maximum lines to read in read tool */
export const READ_MAX_LINES = 200;

/** Maximum characters to read in read tool */
export const READ_MAX_CHARS = 8000;

/** Maximum entries to list in ls tool */
export const LS_MAX_ENTRIES = 100;

/** Size limits for write tool by location: [soft_limit, hard_limit] in bytes */
export const WRITE_SIZE_LIMITS: Record<string, [number, number]> = {
  'MEMORY.md': [50 * 1024, 200 * 1024],
  'memory/': [100 * 1024, 500 * 1024],
  'clawspace/': [5 * 1024 * 1024, 20 * 1024 * 1024],
  'default': [1 * 1024 * 1024, 5 * 1024 * 1024],
};

/** Number of versions to retain in .versions/ directory */
export const WRITE_VERSION_RETENTION = 10;

// ----------------------------------------------------------------------------
// Execution Tools
// ----------------------------------------------------------------------------

/** Maximum stdout capture for exec tool */
export const EXEC_MAX_STDOUT = 8000;

/** Maximum stderr capture for exec tool */
export const EXEC_MAX_STDERR = 500;

/** Minimum timeout for exec command (ms) */
export const EXEC_TIMEOUT_MIN_MS = 1000;

/** Maximum timeout for exec command (ms) */
export const EXEC_TIMEOUT_MAX_MS = 120000;

/** Default timeout for exec command (ms) */
export const EXEC_DEFAULT_TIMEOUT_MS = 30000;

// ----------------------------------------------------------------------------
// Subagent System
// ----------------------------------------------------------------------------

/** Default timeout for subagent tasks (ms) - 5 minutes */
export const SUBAGENT_TIMEOUT_MS = 300000;

/** Default timeout for subagent tasks (seconds) - 5 minutes */
export const SPAWN_DEFAULT_TIMEOUT_S = 300;

// ----------------------------------------------------------------------------
// Communication
// ----------------------------------------------------------------------------

/** Maximum inbox queue size */
export const INBOX_MAX_QUEUE_SIZE = 1000;

// ----------------------------------------------------------------------------
// Contract/State Management
// ----------------------------------------------------------------------------

/** Maximum retries for file lock acquisition */
export const LOCK_MAX_RETRIES = 3;

/** Delay between lock retry attempts (ms) */
export const LOCK_RETRY_DELAY_MS = 100;

// ----------------------------------------------------------------------------
// LLM Integration
// ----------------------------------------------------------------------------

/** Token reserve for thinking budget calculation */
export const THINKING_TOKEN_RESERVE = 1024;

/** Default max tokens for LLM calls */
export const REACT_DEFAULT_MAX_TOKENS = 4096;

/** Session context token limit for sliding window truncation.
 * Leaves ~100k tokens for system prompt + output in 200k context models. */
export const SESSION_CONTEXT_MAX_TOKENS = 100_000;

// ----------------------------------------------------------------------------
// Daemon / CLI
// ----------------------------------------------------------------------------

/** Interval for heartbeat health checks (ms) */
export const HEARTBEAT_CHECK_INTERVAL_MS = 5000;

/** Default fallback timeout for daemon operations (ms) */
export const DAEMON_FALLBACK_TIMEOUT_MS = 30000;

/** Delay after interrupt recovery before processing next message (ms) */
export const INTERRUPT_RECOVERY_DELAY_MS = 1000;

// ----------------------------------------------------------------------------
// LLM Stream
// ----------------------------------------------------------------------------

/** Maximum duration for a single LLM stream call (ms) - 5 minutes */
export const STREAM_MAX_DURATION_MS = 5 * 60 * 1000;

// ----------------------------------------------------------------------------
// Contract
// ----------------------------------------------------------------------------

/** 契约 LLM 验收流式空闲超时 (ms) — 30 秒无 chunk 则中断 */
export const CONTRACT_LLM_IDLE_TIMEOUT_MS = 30_000;

/** 契约脚本验收超时 (ms) */
export const CONTRACT_SCRIPT_TIMEOUT_MS = 60_000;

/** 契约 LLM verifier SubAgent 最大步数 */
export const CONTRACT_VERIFIER_MAX_STEPS = 50;
