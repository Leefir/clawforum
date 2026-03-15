/**
 * Tool Executor - Execution context and tool interface
 * Phase 0: Interface definitions only
 * 
 * Design principles:
 * - Tools are pure functions with side effects via FileSystem
 * - ExecContext provides all dependencies (fs, monitor, permissions)
 * - Tool permissions enforced at execution time
 */

import type { JSONSchema7 } from '../../types/message.js';
import type { IMonitor } from '../../foundation/monitor/index.js';
import type { IFileSystem } from '../../foundation/fs/index.js';
import type { ILLMService } from '../../foundation/llm/index.js';
import type { ToolProfile } from '../../types/config.js';

// Re-export for convenience
export type { JSONSchema7 };

/**
 * Tool permissions - What a tool can do
 */
export interface ToolPermissions {
  /** Can read files */
  read: boolean;
  
  /** Can write/modify files */
  write: boolean;
  
  /** Can execute shell commands */
  execute: boolean;
  
  /** Can spawn subagents */
  spawn: boolean;
  
  /** Can send messages to other Claws */
  send: boolean;
  
  /** Can access network */
  network: boolean;
  
  /** Can access system paths outside claw space */
  system: boolean;
}

/**
 * Permission presets for tool profiles
 */
export const PERMISSION_PRESETS: Record<ToolProfile, ToolPermissions> = {
  full: {
    read: true,
    write: true,
    execute: true,
    spawn: true,
    send: true,
    network: false,  // Network disabled even in full mode for security
    system: false,
  },
  readonly: {
    read: true,
    write: false,
    execute: false,
    spawn: false,
    send: false,
    network: false,
    system: false,
  },
  subagent: {
    read: true,
    write: true,
    execute: false,
    spawn: false,  // Subagent cannot spawn more subagents
    send: true,    // Can send back to parent
    network: false,
    system: false,
  },
  dream: {
    read: true,
    write: true,
    execute: false,
    spawn: false,
    send: false,
    network: false,
    system: false,
  },
};

/**
 * Execution context - Passed to all tool executions
 * 
 * Contains all dependencies and context needed for tool execution
 */
export interface ExecContext {
  // ========================================================================
  // Identity
  // ========================================================================
  
  /** Claw ID */
  clawId: string;
  
  /** Claw workspace directory */
  clawDir: string;
  
  /** Current contract ID (if executing within a contract) */
  contractId?: string;
  
  /** Parent Claw ID (if this is a subagent) */
  parentClawId?: string;
  
  // ========================================================================
  // Dependencies
  // ========================================================================
  
  /** File system interface */
  fs: IFileSystem;
  
  /** LLM service (for tools that need LLM) */
  llm?: ILLMService;
  
  /** Monitor for logging */
  monitor?: IMonitor;
  
  // ========================================================================
  // Permissions
  // ========================================================================
  
  /** Current tool profile */
  profile: ToolProfile;
  
  /** Detailed permissions */
  permissions: ToolPermissions;
  
  /** Check if a specific permission is granted */
  hasPermission(permission: keyof ToolPermissions): boolean;
  
  // ========================================================================
  // Execution State
  // ========================================================================
  
  /** Current step number in ReAct loop */
  stepNumber: number;
  
  /** Maximum allowed steps */
  maxSteps: number;
  
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  
  /** Get elapsed time since execution started */
  getElapsedMs(): number;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Success indicator */
  success: boolean;
  
  /** Result content (shown to LLM) */
  content: string;
  
  /** Error message (if success is false) */
  error?: string;
  
  /** Additional metadata (not shown to LLM) */
  metadata?: {
    filesAffected?: string[];
    durationMs?: number;
    [key: string]: unknown;
  };
}

/**
 * Tool interface - All tools implement this
 */
export interface ITool {
  /** Tool name (must be unique) */
  name: string;
  
  /** Human-readable description (shown to LLM) */
  description: string;
  
  /** JSON Schema for input validation */
  schema: JSONSchema7;
  
  /** Required permissions for this tool */
  requiredPermissions: (keyof ToolPermissions)[];
  
  /** Whether this tool is read-only (can be executed in parallel) */
  readonly: boolean;
  
  /**
   * Execute the tool
   * @param args - Validated arguments
   * @param ctx - Execution context
   * @returns Tool result
   */
  execute(
    args: Record<string, unknown>, 
    ctx: ExecContext
  ): Promise<ToolResult>;
}

/**
 * Tool registry interface
 */
export interface IToolRegistry {
  /**
   * Register a tool
   * @param tool - Tool to register
   */
  register(tool: ITool): void;
  
  /**
   * Unregister a tool
   * @param name - Tool name
   */
  unregister(name: string): void;
  
  /**
   * Get a tool by name
   * @param name - Tool name
   * @returns Tool or undefined if not found
   */
  get(name: string): ITool | undefined;
  
  /**
   * Get all registered tools
   */
  getAll(): ITool[];
  
  /**
   * Get tools available for a profile
   * @param profile - Tool profile
   */
  getForProfile(profile: ToolProfile): ITool[];
  
  /**
   * Check if tool exists
   * @param name - Tool name
   */
  has(name: string): boolean;
  
  /**
   * Format tools for LLM API
   * @param tools - Tools to format
   * @returns Tool definitions for LLM
   */
  formatForLLM(tools: ITool[]): Array<{
    name: string;
    description: string;
    input_schema: JSONSchema7;
  }>;
}

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
  /** Tool name */
  toolName: string;
  
  /** Tool arguments */
  args: Record<string, unknown>;
  
  /** Execution context */
  ctx: ExecContext;
  
  /** Timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/**
 * Tool executor interface - Handles tool execution with parallelization
 */
export interface IToolExecutor {
  /**
   * Execute a single tool
   * @param options - Execution options
   * @returns Tool result
   */
  execute(options: ToolExecutionOptions): Promise<ToolResult>;
  
  /**
   * Execute multiple read-only tools in parallel
   * @param batch - Array of tool calls
   * @param ctx - Execution context
   * @returns Array of results (in same order)
   */
  executeParallel(
    batch: Array<{ toolName: string; args: Record<string, unknown> }>,
    ctx: ExecContext
  ): Promise<ToolResult[]>;
  
  /**
   * Validate tool arguments against schema
   * @param toolName - Tool name
   * @param args - Arguments to validate
   * @returns Validation result
   */
  validateArgs(
    toolName: string, 
    args: Record<string, unknown>
  ): { valid: boolean; errors?: string[] };
}
