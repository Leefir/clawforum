/** Token reserve for thinking budget calculation */
export const THINKING_TOKEN_RESERVE = 1024;

/** Maximum duration for a single LLM stream call (ms) - 5 minutes */
export const STREAM_MAX_DURATION_MS = 5 * 60 * 1000;

/** Maximum retries for transient LLM failures in daemon loop */
export const LLM_MAX_RETRIES = 3;

/** Initial retry delay for LLM failures (ms) — doubles each retry up to max */
export const LLM_RETRY_INITIAL_DELAY_MS = 30_000;

/** Maximum retry delay for LLM failures (ms) — caps exponential backoff */
export const LLM_RETRY_MAX_DELAY_MS = 300_000;
