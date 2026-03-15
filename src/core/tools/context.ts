/**
 * ExecContextImpl - Execution context implementation
 * 
 * Provides context for tool execution including:
 * - Identity (clawId, clawDir)
 * - Permissions based on tool profile
 * - Dependencies (fs, monitor, llm)
 * - Execution tracking (stepNumber, elapsed time)
 */

import type { IFileSystem } from '../../foundation/fs/types.js';
import type { IMonitor } from '../../foundation/monitor/types.js';
import type { ILLMService } from '../../foundation/llm/index.js';
import type { ToolProfile } from '../../types/config.js';
import type { ExecContext, ToolPermissions } from './executor.js';
import { PERMISSION_PRESETS } from './executor.js';
import type { TaskSystem } from '../task/system.js';

/**
 * Options for creating execution context
 */
export interface ExecContextImplOptions {
  /** Claw identifier */
  clawId: string;
  
  /** Claw workspace directory */
  clawDir: string;
  
  /** Tool profile for permission control */
  profile: ToolProfile;
  
  /** File system instance */
  fs: IFileSystem;
  
  /** Optional monitor for logging */
  monitor?: IMonitor;
  
  /** Optional LLM service */
  llm?: ILLMService;
  
  /** Maximum allowed steps (ReAct loop limit) */
  maxSteps?: number;
  
  /** Optional abort signal */
  signal?: AbortSignal;
  
  /** Optional task system for spawn tool */
  taskSystem?: TaskSystem;
}

/**
 * Execution context implementation
 */
export class ExecContextImpl implements ExecContext {
  clawId: string;
  clawDir: string;
  profile: ToolProfile;
  permissions: ToolPermissions;
  fs: IFileSystem;
  monitor?: IMonitor;
  llm?: ILLMService;
  stepNumber: number;
  maxSteps: number;
  signal?: AbortSignal;
  taskSystem?: TaskSystem;
  
  private startTime: number;

  constructor(options: ExecContextImplOptions) {
    this.clawId = options.clawId;
    this.clawDir = options.clawDir;
    this.profile = options.profile;
    this.permissions = PERMISSION_PRESETS[options.profile];
    this.fs = options.fs;
    this.monitor = options.monitor;
    this.llm = options.llm;
    this.maxSteps = options.maxSteps ?? 100;
    this.signal = options.signal;
    this.taskSystem = options.taskSystem;
    this.stepNumber = 0;
    this.startTime = Date.now();
  }

  /**
   * Check if a specific permission is granted
   */
  hasPermission(permission: keyof ToolPermissions): boolean {
    return this.permissions[permission] ?? false;
  }

  /**
   * Get elapsed time since context creation
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Increment step counter
   * Called by ReAct loop before each step
   */
  incrementStep(): void {
    this.stepNumber++;
  }

  /**
   * Check if execution should continue
   */
  shouldContinue(): boolean {
    if (this.signal?.aborted) {
      return false;
    }
    if (this.stepNumber >= this.maxSteps) {
      return false;
    }
    return true;
  }
}
