/**
 * phase 320: inbox message type constants consumed by Runtime intercept paths.
 *
 * Kept out of `runtime-audit-events.ts` so the audit-events snapshot lock
 * (which scans `audit-events.ts` files for `UPPER = 'lower'` literals) does
 * not pick up these non-audit constants.
 */

/**
 * Producer: CLI (`config provider set-primary|add|remove|move`).
 * Consumer: Runtime._drainOwnInbox 拦截路径 → llm.reloadConfig.
 */
export const RELOAD_LLM_CONFIG_MESSAGE_TYPE = 'reload_llm_config' as const;
