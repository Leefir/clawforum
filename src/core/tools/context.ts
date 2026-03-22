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
import type { SkillRegistry } from '../skill/registry.js';
import type { ContractManager } from '../contract/manager.js';
import type { OutboxWriter } from '../communication/outbox.js';
import type { Message } from '../../types/message.js';

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
  
  /** Caller type for spawn recursion prevention */
  callerType?: 'claw' | 'subagent' | 'dispatcher';
  
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
  
  /** Optional skill registry for skill tool */
  skillRegistry?: SkillRegistry;
  
  /** Optional contract manager for done tool */
  contractManager?: ContractManager;
  
  /** Max steps for subagents created via spawn tool */
  subagentMaxSteps?: number;
  
  /** Outbox writer for send tool */
  outboxWriter?: OutboxWriter;
  
  /** 当前对话 messages（供 dispatch 工具读取） */
  dialogMessages?: Message[];
  /** 创建链路的源头 clawId，由 dispatch/spawn 传播 */
  originClawId?: string;
}

/**
 * Execution context implementation
 */
export class ExecContextImpl implements ExecContext {
  clawId: string;
  clawDir: string;
  profile: ToolProfile;
  callerType: 'claw' | 'subagent' | 'dispatcher';
  permissions: ToolPermissions;
  fs: IFileSystem;
  monitor?: IMonitor;
  llm?: ILLMService;
  stepNumber: number;
  maxSteps: number;
  signal?: AbortSignal;
  taskSystem?: TaskSystem;
  skillRegistry?: SkillRegistry;
  contractManager?: ContractManager;
  subagentMaxSteps: number;
  outboxWriter?: OutboxWriter;
  dialogMessages?: Message[];
  originClawId?: string;
  
  private startTime: number;

  constructor(options: ExecContextImplOptions) {
    this.clawId = options.clawId;
    this.clawDir = options.clawDir;
    this.profile = options.profile;
    this.callerType = options.callerType ?? 'claw';
    this.permissions = PERMISSION_PRESETS[options.profile];
    this.fs = options.fs;
    this.monitor = options.monitor;
    this.llm = options.llm;
    this.maxSteps = options.maxSteps ?? 100;
    this.signal = options.signal;
    this.taskSystem = options.taskSystem;
    this.skillRegistry = options.skillRegistry;
    this.contractManager = options.contractManager;
    this.subagentMaxSteps = options.subagentMaxSteps ?? options.maxSteps ?? 100;
    this.outboxWriter = options.outboxWriter;
    this.dialogMessages = options.dialogMessages;
    this.originClawId = options.originClawId;
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
   * 是否为 Motion 创建链路上的 agent（Motion 本体或其 subagent）
   */
  get isMotionChain(): boolean {
    return this.clawId === 'motion' || this.originClawId === 'motion';
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

}
