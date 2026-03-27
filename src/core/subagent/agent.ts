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
import { SUBAGENT_TIMEOUT_MS, DEFAULT_MAX_STEPS } from '../../constants.js';
import { oneLine } from '../../cli/utils/string.js';
import { DEFAULT_SUBAGENT_SYSTEM_PROMPT } from '../../prompts/index.js';
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
  originClawId?: string;                     // 创建链路源头，传给子 SubAgent
  taskStreamWriter?: { write(event: Record<string, unknown>): void };
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
  private originClawId?: string;
  private taskStreamWriter?: { write(event: Record<string, unknown>): void };

  constructor(options: SubAgentOptions) {
    this.agentId = options.agentId;
    this.prompt = options.prompt;
    this.clawDir = options.clawDir;
    this.llm = options.llm;
    this.registry = options.registry;
    this.fs = options.fs;
    this.monitor = options.monitor;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
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
    this.originClawId = options.originClawId;
    this.taskStreamWriter = options.taskStreamWriter;
  }

  /**
   * Run the subagent and return final text result
   */
  async run(): Promise<string> {
    const startTime = Date.now();
    
    // Stream writer for per-task stream.jsonl
    const sw = this.taskStreamWriter;
    
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
        ? [
            ...this.messages,  // 继承历史上下文
            ...(this.prompt ? [{ role: 'user' as const, content: this.prompt }] : []),
          ]
        : [{ role: 'user' as const, content: this.prompt }];

      // Log start
      await this.appendToLog(`=== SubAgent ${this.agentId} started ===\n`);
      await this.appendToLog(`Prompt: ${this.prompt}\n`);

      // Step audit state (reset each step)
      let auditStep = 0;
      let auditStepTools: string[] = [];
      let auditStepStart = Date.now();
      const stepsLogPath = `tasks/results/${this.agentId}-steps.jsonl`;

      // System prompt for subagent (use custom or default from prompts module)
      const systemPrompt = this.systemPrompt ?? DEFAULT_SUBAGENT_SYSTEM_PROMPT;

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

      // Stream writer callbacks for per-task stream.jsonl
      const streamCallbacks = sw ? {
        onToolCall: (name: string) => {
          sw.write({ type: 'tool_call', name });
        },
        onToolResult: (name: string, result: { success: boolean; content?: string }, step: number, maxSteps: number) => {
          sw.write({
            type: 'tool_result',
            name,
            success: result.success,
            summary: oneLine(result.content ?? ''),
            step: step + 1,
            maxSteps,
          });
        },
        onBeforeLLMCall: () => { sw.write({ type: 'turn_start' }); },
      } : {};

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
            originClawId: this.originClawId,
          }),
          maxSteps: this.maxSteps,
          registry: this.registry,  // Enable parallel execution for readonly tools
          tools,                    // Enable native tool_use
          onTextDelta: resetIdle ? () => resetIdle() : undefined,
          onThinkingDelta: resetIdle ? () => resetIdle() : undefined,
          onToolCall: async (name) => {
            resetIdle?.();
            streamCallbacks.onToolCall?.(name);
            auditStepTools.push(name);
            await this.appendToLog(`Tool called: ${name}\n`);
          },
          onToolResult: (name, result, step, maxSteps) => {
            streamCallbacks.onToolResult?.(name, result, step, maxSteps);
          },
          onBeforeLLMCall: () => {
            streamCallbacks.onBeforeLLMCall?.();
          },
          onStepComplete: async () => {
            try {
              const entry = JSON.stringify({
                step: auditStep,
                ts: new Date().toISOString(),
                tools: auditStepTools,
                elapsedMs: Date.now() - auditStepStart,
              });
              await this.fs.append(stepsLogPath, entry + '\n');
            } catch (err) {
              this.monitor?.log('error', {
                context: 'SubAgent.onStepComplete',
                agentId: this.agentId,
                error: err instanceof Error ? err.message : String(err),
              });
              // 不 throw — audit 失败不终止任务
            }
            auditStep++;
            auditStepTools = [];
            auditStepStart = Date.now();
          },
        }),
        timeoutPromise,
      ]);

      // race 结束：若 runReact 先完成，abort 释放挂起的 timeout/idle promise 引用
      timeoutController.abort();
      clearTimeout(idleTimerId);

      // Log completion
      const duration = Date.now() - startTime;
      await this.appendToLog(`=== Completed in ${duration}ms ===\n`);
      await this.appendToLog(`Stop reason: ${result.stopReason}\n`);
      await this.appendToLog(`Final text: ${result.finalText}\n`);

      // Write turn_end and close stream
      sw?.write({ type: 'turn_end' });

      // 持久化 messages 供复盘子代理继承（best-effort，不影响主流程）
      try {
        await this.fs.writeAtomic(
          `tasks/results/${this.agentId}.messages.json`,
          JSON.stringify(messages),
        );
      } catch (e) {
        this.monitor?.log('error', {
          context: 'SubAgent.persistMessages',
          agentId: this.agentId,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Extract final text result
      return result.finalText || '[No output produced]';
    } catch (error) {
      // Re-throw ToolTimeoutError directly — the timeoutPromise already constructs it correctly.
      // Do NOT rely on timeoutController.signal.aborted: it is set to true at line 227 even when
      // runReact succeeds normally, so a post-race error (e.g. appendToLog) would be misclassified.
      if (error instanceof ToolTimeoutError) {
        throw error;
      }

      // Log error
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.appendToLog(`=== Error: ${errMsg} ===\n`);

      throw error;
    } finally {
      // 统一清理所有 timer，避免内存泄漏
      clearTimeout(timeoutId);
      clearTimeout(idleTimerId);
      // Write turn_end to task stream (idempotent if already written)
      sw?.write({ type: 'turn_end' });
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
