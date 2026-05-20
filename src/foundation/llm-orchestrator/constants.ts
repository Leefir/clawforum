/** Token reserve for thinking budget calculation */
export const THINKING_TOKEN_RESERVE = 1024;

/** Maximum duration for a single LLM stream call (ms) - 5 minutes */
export const STREAM_MAX_DURATION_MS = 5 * 60 * 1000;

/** Maximum idle timeout for SSE stream parsers (ms) — independent from stream duration */
export const STREAM_IDLE_MAX_MS = 60_000;

/**
 * @deprecated Only used by daemon-loop, does not control orchestrator retry.
 * Orchestrator retry is configured via LLMOrchestratorConfig.maxAttempts / retryDelayMs.
 */
export const LLM_MAX_RETRIES = 3;

/**
 * @deprecated Only used by daemon-loop, does not control orchestrator retry.
 * Orchestrator retry is configured via LLMOrchestratorConfig.maxAttempts / retryDelayMs.
 */
export const LLM_RETRY_INITIAL_DELAY_MS = 30_000;

/**
 * @deprecated Only used by daemon-loop, does not control orchestrator retry.
 * Orchestrator retry is configured via LLMOrchestratorConfig.maxAttempts / retryDelayMs.
 */
export const LLM_RETRY_MAX_DELAY_MS = 300_000;
