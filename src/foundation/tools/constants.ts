/**
 * @module L2.Tools
 * Tool execution constants.
 *
 * `DEFAULT_TOOL_TIMEOUT_MS` — L2 唯一 own「tool wall-clock 限」资源（phase 1026 design ratify α / phase 1027 兑现）。
 * caller: ToolExecutor ctor fallback + config-defaults plane anchor + cli init config.yaml default.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
