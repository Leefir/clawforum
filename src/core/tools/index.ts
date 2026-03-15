/**
 * Tools module
 * Phase 1: Tool registry and executor framework
 */

// Registry
export { ToolRegistry } from './registry.js';

// Executor (interfaces + implementation)
export {
  ToolExecutorImpl,
  ToolExecutor,
  PERMISSION_PRESETS,
} from './executor.js';

// Context
export { ExecContextImpl } from './context.js';

// Profiles
export { TOOL_PROFILES } from './profiles.js';

// Types (from executor.ts - Phase 0 interfaces)
export type {
  ToolPermissions,
  ToolResult,
  ExecContext,
  ITool,
  IToolRegistry,
  IToolExecutor,
  ExecuteOptions,
} from './executor.js';

export type { ExecContextImplOptions } from './context.js';

// Task system
export { TaskSystem, type SubAgentTask } from '../task/system.js';

// SubAgent
export { SubAgent, type SubAgentOptions } from '../subagent/agent.js';

// Builtin tools
export { registerBuiltinTools } from './builtins/index.js';
