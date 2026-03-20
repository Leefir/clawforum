/**
 * SubAgent - Independent ReAct agent for delegated tasks
 * 
 * SubAgent runs with restricted permissions and cannot spawn other agents.
 */

import { runReact } from '../react/loop.js';
import { ToolExecutor } from '../tools/executor.js';
import { ToolRegistry } from '../tools/registry.js';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { IMonitor } from '../../foundation/monitor/types.js';
import type { ILLMService } from '../../foundation/llm/index.js';
import { ToolTimeoutError } from '../../types/errors.js';
import { SUBAGENT_TIMEOUT_MS } from '../../constants.js';

export interface SubAgentOptions {
  agentId: string;
  prompt: string;
  clawDir: string;
  llm: ILLMService;
  registry: ToolRegistry;
  fs: IFileSystem;
  monitor?: IMonitor;
  maxSteps?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class SubAgent {
  private agentId: string;
  private prompt: string;
  private clawDir: string;
  private llm: ILLMService;
  private registry: ToolRegistry;
  private fs: IFileSystem;
  private monitor?: IMonitor;
  private maxSteps: number;
  private timeoutMs: number;
  private signal?: AbortSignal;
  private logPath: string;

  constructor(options: SubAgentOptions) {
    this.agentId = options.agentId;
    this.prompt = options.prompt;
    this.clawDir = options.clawDir;
    this.llm = options.llm;
    this.registry = options.registry;
    this.fs = options.fs;
    this.monitor = options.monitor;
    this.maxSteps = options.maxSteps ?? 20;
    this.timeoutMs = options.timeoutMs ?? SUBAGENT_TIMEOUT_MS; // 5 min default
    this.signal = options.signal;
    this.logPath = `tasks/results/${this.agentId}.log`;
  }

  /**
   * Run the subagent and return final text result
   */
  async run(): Promise<string> {
    const startTime = Date.now();
    
    // Create timeout controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, this.timeoutMs);

    // Combine with external signal if provided
    if (this.signal) {
      this.signal.addEventListener('abort', () => {
        timeoutController.abort();
      }, { once: true });
    }

    try {
      // Initialize executor with 'subagent' profile (spawn disabled)
      const executor = new ToolExecutor({
        registry: this.registry,
        clawDir: this.clawDir,
        fs: this.fs,
        llm: this.llm,
        monitor: this.monitor,
        profile: 'subagent',
      });

      // Setup messages
      const messages = [
        { role: 'user' as const, content: this.prompt },
      ];

      // Log start
      await this.appendToLog(`=== SubAgent ${this.agentId} started ===\n`);
      await this.appendToLog(`Prompt: ${this.prompt}\n`);

      // System prompt for subagent
      const systemPrompt = `You are a subagent assigned to complete a specific task.
You have access to tools: read, write, ls, search, exec, status.
You CANNOT spawn other subagents - use your available tools to complete the task yourself.
Work efficiently and return a clear, concise result.`;

      // Run ReAct loop
      const result = await runReact({
        messages,
        systemPrompt,
        llm: this.llm,
        executor,
        ctx: executor.getExecContext('subagent', { 
          clawId: this.agentId,
          dialogId: this.agentId,
          signal: timeoutController.signal,
          callerType: 'subagent',
        }),
        maxSteps: this.maxSteps,
        registry: this.registry,  // Enable parallel execution for readonly tools
        onToolCall: (name) => {
          this.appendToLog(`Tool called: ${name}\n`);
        },
      });

      clearTimeout(timeoutId);

      // Log completion
      const duration = Date.now() - startTime;
      await this.appendToLog(`=== Completed in ${duration}ms ===\n`);
      await this.appendToLog(`Stop reason: ${result.stopReason}\n`);
      await this.appendToLog(`Final text: ${result.finalText}\n`);

      // Extract final text result
      return result.finalText || '[No output produced]';
    } catch (error) {
      clearTimeout(timeoutId);

      if (timeoutController.signal.aborted && !(this.signal?.aborted)) {
        throw new ToolTimeoutError('subagent_run', this.timeoutMs);
      }

      // Log error
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.appendToLog(`=== Error: ${errMsg} ===\n`);

      throw error;
    }
  }

  /**
   * Append to log file (atomic append, no read-modify-write race)
   */
  private async appendToLog(text: string): Promise<void> {
    try {
      // 使用 IFileSystem.append 实现原子追加，避免竞态
      await this.fs.append(this.logPath, text);
    } catch {
      // Log failures are non-fatal
    }
  }
}
