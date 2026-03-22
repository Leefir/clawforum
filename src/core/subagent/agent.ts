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
import type { ToolDefinition } from '../../types/message.js';
import { ToolTimeoutError } from '../../types/errors.js';
import { SUBAGENT_TIMEOUT_MS } from '../../constants.js';
import type { TaskSystem } from '../task/system.js';
import type { OutboxWriter } from '../communication/outbox.js';
import type { ContractManager } from '../contract/manager.js';
import type { Message } from '../../types/message.js';

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
  toolsForLLM?: ToolDefinition[];  // Pre-filtered tool list for LLM, overrides registry.getAll()
  idleTimeoutMs?: number;
  onIdleTimeout?: () => void;
  systemPrompt?: string;                    // 替换 run() 里硬编码的默认 system prompt
  callerType?: 'subagent' | 'dispatcher';  // 默认 'subagent'
  taskSystem?: TaskSystem;                  // dispatcher 调 spawn 需要，透传给 ToolExecutor
  outboxWriter?: OutboxWriter;              // send 工具需要
  contractManager?: ContractManager;        // contract create / done 工具需要
  subagentMaxSteps?: number;                 // 传给子 SubAgent
  messages?: Message[];                      // 若提供，直接用；否则从 prompt 构建
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
  private toolsForLLM?: ToolDefinition[];
  private idleTimeoutMs?: number;
  private onIdleTimeout?: () => void;
  private systemPrompt?: string;
  private callerType?: 'subagent' | 'dispatcher';
  private taskSystem?: TaskSystem;
  private outboxWriter?: OutboxWriter;
  private contractManager?: ContractManager;
  private subagentMaxSteps?: number;
  private messages?: Message[];

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
    this.toolsForLLM = options.toolsForLLM;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.onIdleTimeout = options.onIdleTimeout;
    this.systemPrompt = options.systemPrompt;
    this.callerType = options.callerType;
    this.taskSystem = options.taskSystem;
    this.outboxWriter = options.outboxWriter;
    this.contractManager = options.contractManager;
    this.subagentMaxSteps = options.subagentMaxSteps;
    this.messages = options.messages;
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

    // Idle timeout: abort if no LLM activity for idleTimeoutMs
    let idleTimerId: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = this.idleTimeoutMs
      ? () => {
          clearTimeout(idleTimerId);
          idleTimerId = setTimeout(() => {
            this.onIdleTimeout?.();
            timeoutController.abort();
          }, this.idleTimeoutMs!);
        }
      : undefined;

    // 立即启动 idle 计时（等待第一个 chunk）
    resetIdle?.();

    // Combine with external signal if provided
    if (this.signal) {
      this.signal.addEventListener('abort', () => {
        timeoutController.abort();
      }, { once: true });
    }

    try {
      // Initialize executor with appropriate profile (spawn disabled for subagent, enabled for dispatcher)
      const callerType = this.callerType ?? 'subagent';
      const executorProfile = callerType === 'dispatcher' ? 'full' : 'subagent';
      const executor = new ToolExecutor({
        registry: this.registry,
        clawDir: this.clawDir,
        fs: this.fs,
        llm: this.llm,
        monitor: this.monitor,
        taskSystem: this.taskSystem,
        outboxWriter: this.outboxWriter,
        contractManager: this.contractManager,
        subagentMaxSteps: this.subagentMaxSteps ?? this.maxSteps,
        profile: executorProfile,
      });

      // Setup messages（若传入 messages 则直接使用，否则从 prompt 构建）
      const messages: Message[] = this.messages
        ? [...this.messages]   // 浅拷贝，避免 runReact 原地 mutate 污染原数组
        : [{ role: 'user' as const, content: this.prompt }];

      // Log start
      await this.appendToLog(`=== SubAgent ${this.agentId} started ===\n`);
      await this.appendToLog(`Prompt: ${this.prompt}\n`);

      // System prompt for subagent (use custom or default)
      const systemPrompt = this.systemPrompt ??
        `You are a subagent assigned to complete a specific task.
You CANNOT spawn other subagents - use your available tools to complete the task yourself.
Work efficiently and return a clear, concise result.`;

      // Format tools for LLM native tool_use (use pre-filtered list if provided)
      const tools = this.toolsForLLM
        ?? this.registry.formatForLLM(this.registry.getAll());

      // Run ReAct loop，用 Promise.race 强制超时
      // （不能只靠 signal 传播：collectStreamResponse 内部阻塞时检查不到 signal）
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutController.signal.addEventListener('abort', () => {
          reject(new ToolTimeoutError('subagent_run', this.timeoutMs));
        }, { once: true });
      });
      timeoutPromise.catch(() => {}); // 防止 race 胜出后的孤立 rejection

      const result = await Promise.race([
        runReact({
          messages,
          systemPrompt,
          llm: this.llm,
          executor,
          ctx: executor.getExecContext(executorProfile, {
            clawId: this.agentId,
            signal: timeoutController.signal,
            callerType,
          }),
          maxSteps: this.maxSteps,
          registry: this.registry,  // Enable parallel execution for readonly tools
          tools,                    // Enable native tool_use
          onTextDelta: resetIdle ? () => resetIdle() : undefined,
          onThinkingDelta: resetIdle ? () => resetIdle() : undefined,
          onToolCall: async (name) => {
            resetIdle?.();
            await this.appendToLog(`Tool called: ${name}\n`);
          },
        }),
        timeoutPromise,
      ]);

      // Log completion
      const duration = Date.now() - startTime;
      await this.appendToLog(`=== Completed in ${duration}ms ===\n`);
      await this.appendToLog(`Stop reason: ${result.stopReason}\n`);
      await this.appendToLog(`Final text: ${result.finalText}\n`);

      // Extract final text result
      return result.finalText || '[No output produced]';
    } catch (error) {
      if (timeoutController.signal.aborted && !(this.signal?.aborted)) {
        throw new ToolTimeoutError('subagent_run', this.timeoutMs);
      }

      // Log error
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.appendToLog(`=== Error: ${errMsg} ===\n`);

      throw error;
    } finally {
      // 统一清理所有 timer，避免内存泄漏
      clearTimeout(timeoutId);
      clearTimeout(idleTimerId);
    }
  }

  /**
   * Append to log file (atomic append, no read-modify-write race)
   */
  private async appendToLog(text: string): Promise<void> {
    try {
      // 使用 IFileSystem.append 实现原子追加，避免竞态
      await this.fs.append(this.logPath, text);
    } catch (e) {
      // Log failures are non-fatal
      this.monitor?.log('error', {
        context: 'SubAgent.appendToLog',
        agentId: this.agentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
