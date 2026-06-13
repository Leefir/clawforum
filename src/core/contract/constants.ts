/** Maximum retries for file lock acquisition */
export const LOCK_MAX_RETRIES = 20;

/** Delay between lock retry attempts (ms) */
export const LOCK_RETRY_DELAY_MS = 500;

/** Lock held longer than this is considered stale and force-cleared (ms) */
export const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** 契约脚本验收超时 (ms) */
export const CONTRACT_SCRIPT_TIMEOUT_MS = 60_000;

/**
 * Auditor prompt 显示 footprint reads 前 N 项 cap.
 * verifier LLM 看到的 footprint reads 截断、防 prompt token 灌爆 + 20 是行业经验 top-N display 默认。
 */
export const FOOTPRINT_READS_TOP_N = 20;

/**
 * 默认 verification attempts before escalation.
 * Derivation: 3 = 1 initial + 2 retry / 经验值平衡 fast-fail vs flaky 重试; 双源调用方共享.
 */
export const DEFAULT_VERIFICATION_ATTEMPTS = 3;
