// ============================================================================
// ClawForum Internal Constants
// ============================================================================
// Centralized location for all magic numbers and internal constants.
// Organized by functional domain for maintainability.
// ============================================================================

// ----------------------------------------------------------------------------
// Process Management
// ----------------------------------------------------------------------------

/** Time to wait for process spawn confirmation (ms) */
export const PROCESS_SPAWN_CONFIRM_MS = 500;

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

// ----------------------------------------------------------------------------
// Subagent System
// ----------------------------------------------------------------------------

/** Default timeout for subagent tasks (ms) - 5 minutes */
export const SUBAGENT_TIMEOUT_MS = 300000;

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

// ----------------------------------------------------------------------------
// Daemon / CLI
// ----------------------------------------------------------------------------

/** Interval for heartbeat health checks (ms) */
export const HEARTBEAT_CHECK_INTERVAL_MS = 5000;
