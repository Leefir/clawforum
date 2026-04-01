/**
 * ClawRuntime - assembles all modules into a runnable Claw instance
 *
 * This is the final assembly layer for Phase 1, integrating the following modules into a unified runtime:
 * - Foundation: NodeFileSystem, LLMService, JsonlMonitor, LocalTransport
 * - Core: Dialog, Tools, ReAct, Communication, Task, Skill, Contract
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import type { LLMServiceConfig } from '../foundation/llm/types.js';
import type { ToolProfile } from '../types/config.js';
import type { Message } from '../types/message.js';
import type { InboxMessage, Priority } from '../types/contract.js';
import type { OutboxWriteOptions } from './communication/outbox.js';
import type { SessionData } from './dialog/types.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

import { NodeFileSystem } from '../foundation/fs/node-fs.js';
import { LLMService } from '../foundation/llm/service.js';
import { JsonlMonitor } from '../foundation/monitor/monitor.js';
import { LocalTransport } from '../foundation/transport/local.js';

import { SessionManager } from './dialog/session.js';
import { ContextInjector } from './dialog/injector.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutorImpl } from './tools/executor.js';
import { ExecContextImpl } from './tools/context.js';
import { registerBuiltinTools } from './tools/builtins/index.js';
import { DispatchTool } from './tools/builtins/dispatch.js';
import { readTool } from './tools/builtins/read.js';
import { lsTool } from './tools/builtins/ls.js';
import { searchTool } from './tools/builtins/search.js';
import { execTool } from './tools/builtins/exec.js';
import { runReact } from './react/loop.js';
import { InboxWatcher } from './communication/inbox.js';
import { OutboxWriter } from './communication/outbox.js';
import { TaskSystem } from './task/system.js';
import { SkillRegistry } from './skill/registry.js';
import { ContractManager } from './contract/manager.js';
import { CLAW_SUBDIRS } from '../types/paths.js';
import { MaxStepsExceededError } from '../types/errors.js';
import { MOTION_CLAW_ID, DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_MAX_STEPS } from '../constants.js';

/**
 * ClawRuntime constructor options
 */
export interface ClawRuntimeOptions {
  clawId: string;
  clawDir: string;
  llmConfig: LLMServiceConfig;
  monitorDir?: string;
  maxSteps?: number;
  toolProfile?: ToolProfile;
  toolTimeoutMs?: number;
  subagentMaxSteps?: number;
  maxConcurrentTasks?: number;
  idleTimeoutMs?: number;  // 覆盖 DEFAULT_LLM_IDLE_TIMEOUT_MS（0 = 禁用）
}

/** Inbox message info for onInboxMessages callback */
export interface InboxMessageInfo {
  meta: Record<string, string>;
  body: string;
}

/** daemon streaming callbacks (used by processBatch / _runReact) */
export interface StreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onTextEnd?: () => void;
  onThinkingDelta?: (delta: string) => void;
  onToolCall?: (toolName: string, toolUseId: string) => void;
  onToolResult?: (toolName: string, toolUseId: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
  onBeforeLLMCall?: () => void;
  onInboxDrained?: (sources: Array<{ text: string; type: string }>) => void;  // inbox has been drained; passes message summaries with type
  onInboxMessages?: (infos: InboxMessageInfo[]) => Promise<void>;  // inbox messages detected (for review_request handling)
}

/**
 * ClawRuntime - fully assembled Claw runtime instance
 */
export class ClawRuntime {
  protected options: ClawRuntimeOptions;
  protected initialized = false;
  private running = false;
  private currentAbortController: AbortController | null = null;

  // Foundation
  /**
   * @protected allows subclasses such as MotionRuntime to read system files (SOUL.md, REVIEW.md, etc.)
   * Note: subclasses should not write directly; preserve runtime encapsulation
   */
  protected systemFs!: NodeFileSystem;  // used by system components (no permission check)
  private clawFs!: NodeFileSystem;    // used by tools (with permission check)
  private monitor!: JsonlMonitor;
  protected llm!: LLMService;
  private transport!: LocalTransport;

  // Core
  protected sessionManager!: SessionManager;
  /**
   * @protected allows subclasses such as MotionRuntime to call buildParts() to customize prompt injection order
   * Note: subclasses should treat this as read-only and must not modify injector state
   */
  protected contextInjector!: ContextInjector;
  protected toolRegistry!: ToolRegistry;
  private taskSystem!: TaskSystem;
  private skillRegistry!: SkillRegistry;
  private contractManager!: ContractManager;
  protected execContext!: ExecContextImpl;
  protected toolExecutor!: ToolExecutorImpl;
  private inboxWatcher!: InboxWatcher;
  private outboxWriter!: OutboxWriter;

  constructor(options: ClawRuntimeOptions) {
    this.options = {
      maxSteps: DEFAULT_MAX_STEPS,
      toolProfile: 'full',
      toolTimeoutMs: 60000,
      maxConcurrentTasks: 3,
      ...options,
    };
  }

  /**
   * Initialize all modules
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { clawId, clawDir, llmConfig, monitorDir, maxSteps, toolProfile } = this.options;

    // 1. Create directory structure
    await this.ensureDirectories(clawDir);

    // 2. Create two NodeFileSystem instances
    // systemFs: used by system components (dialog/, contract/, etc.), no permission enforcement
    this.systemFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    // clawFs: used by tools, enforces permission checks
    this.clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

    // 2.5 Clean up orphaned temp files at startup (best-effort)
    this.systemFs.cleanupTempFiles().catch(err => {
      console.warn('[runtime] Failed to cleanup temp files:', err);
    });

    // 3. Create JsonlMonitor
    const logsDir = monitorDir || path.join(clawDir, 'logs');
    this.monitor = new JsonlMonitor({ logsDir });

    // 4. Create LLMService
    this.llm = new LLMService(llmConfig, this.monitor, clawId);

    // 5. Create LocalTransport (workspaceDir depends on claw type)
    // claw:   clawDir = .clawforum/claws/{name} → up 2 levels → .clawforum
    // motion: clawDir = .clawforum/motion       → up 1 level  → .clawforum
    const workspaceDir = clawId === MOTION_CLAW_ID
      ? path.resolve(clawDir, '..')
      : path.resolve(clawDir, '..', '..');
    this.transport = new LocalTransport({ workspaceDir });
    await this.transport.initialize();

    // 6. Create SessionManager (uses systemFs; system components need to write to dialog/)
    this.sessionManager = new SessionManager(this.systemFs, 'dialog', clawId, this.monitor);
    // Archive previous session on startup (best-effort; first start has no current.json)
    await this.sessionManager.archive().catch((err: any) => {
      if (err?.code !== 'ENOENT' && err?.code !== 'FS_NOT_FOUND') {
        console.warn('[runtime] Failed to archive session on startup:', err?.message);
      }
    });

    // 7. Create ToolRegistry and register built-in tools
    this.toolRegistry = new ToolRegistry();
    registerBuiltinTools(this.toolRegistry);
    // dispatch 需要构造参数，单独注册
    this.toolRegistry.register(new DispatchTool(
      () => this.buildSystemPrompt(),           // 每个 Claw 用自己的 system prompt
      () => this.toolRegistry.formatForLLM(this.toolRegistry.getAll()),  // Motion 完整工具列表
    ));

    // 8. Create TaskSystem
    this.taskSystem = new TaskSystem(clawDir, this.systemFs, {
      maxConcurrent: this.options.maxConcurrentTasks,
    });
    await this.taskSystem.initialize();
    this.taskSystem.setLLMService(this.llm);
    // Restored tasks can only be dispatched after the LLM service is set
    this.taskSystem.startDispatch();

    // 9. Create SkillRegistry (lazy-loads skills)
    this.skillRegistry = new SkillRegistry(this.systemFs, 'skills');
    await this.skillRegistry.loadAll();

    // 10. Create ContractManager (with LLM and verifier registry for acceptance)
    const verifierRegistry = new ToolRegistry();
    verifierRegistry.register(readTool);
    verifierRegistry.register(lsTool);
    verifierRegistry.register(searchTool);
    verifierRegistry.register(execTool);
    const motionInboxDir = path.join(workspaceDir, 'motion', 'inbox', 'pending');
    this.contractManager = new ContractManager(clawDir, clawId, this.systemFs, this.monitor, this.llm, verifierRegistry, motionInboxDir);

    // 11. Create ContextInjector (inject skillRegistry and contractManager)
    this.contextInjector = new ContextInjector({
      fs: this.systemFs,
      skillRegistry: this.skillRegistry,
      contractManager: this.contractManager,
    });

    // 12. Create OutboxWriter first (needed by ExecContextImpl)
    this.outboxWriter = new OutboxWriter(clawId, clawDir, this.systemFs);

    // Inject late-created dependencies into TaskSystem (created before SkillRegistry/ContractManager/OutboxWriter)
    this.taskSystem.setSkillRegistry(this.skillRegistry);
    this.taskSystem.setContractManager(this.contractManager);
    this.taskSystem.setOutboxWriter(this.outboxWriter);

    // 13. Create ExecContextImpl (inject all dependencies; tools use clawFs)
    this.execContext = new ExecContextImpl({
      clawId,
      clawDir,
      profile: toolProfile!,
      callerType: 'claw',
      fs: this.clawFs,
      monitor: this.monitor,
      llm: this.llm,
      maxSteps,
      taskSystem: this.taskSystem,
      skillRegistry: this.skillRegistry,
      contractManager: this.contractManager,
      subagentMaxSteps: this.options.subagentMaxSteps,
      outboxWriter: this.outboxWriter,
    });

    // 14. Create ToolExecutorImpl
    this.toolExecutor = new ToolExecutorImpl(this.toolRegistry, this.options.toolTimeoutMs);

    // 15. Create InboxWatcher
    this.inboxWatcher = new InboxWatcher(clawDir, this.systemFs);

    this.initialized = true;
  }

  /**
   * Start the background event loop
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.initialized) {
      await this.initialize();
    }

    // Start InboxWatcher
    await this.inboxWatcher.start(this.handleMessage.bind(this));

    // Resume execution if there is a paused contract
    const paused = await this.contractManager.loadPaused();
    if (paused) {
      await this.contractManager.resume(paused.id);
    }

    this.running = true;
  }

  /**
   * Graceful shutdown
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Stop InboxWatcher
    await this.inboxWatcher.stop();

    // Shut down TaskSystem
    await this.taskSystem.shutdown(30_000);

    // Close LLMService
    await this.llm.close();

    this.running = false;
  }

  /**
   * MVP alignment: resume a paused contract (extracted from start())
   */
  async resumeContractIfPaused(): Promise<void> {
    const paused = await this.contractManager.loadPaused();
    if (paused) {
      await this.contractManager.resume(paused.id);
    }
  }

  /**
   * Format the injection text for an inbox message by its type.
   * user_chat: no prefix (user typed in the chat)
   * user_inbox_message: [user inbox message] prefix (user sent a message via CLI)
   * system events: [system message] prefix
   */
  protected async formatInboxMessage(type: string, from: string, body: string): Promise<string> {
    switch (type) {
      case 'user_chat':
        return body;
      case 'user_inbox_message':
        return `[user inbox message]\n${body}`;
      case 'crash_notification':
        return `[system message] Claw "${from}" process exited abnormally.\n${body}`;
      case 'heartbeat': {
        const base = '[system message] Heartbeat triggered. Please perform a routine check.';
        try {
          const checklist = (await this.systemFs.read('HEARTBEAT.md')).trim();
          return checklist ? `${base}\n\n${checklist}` : base;
        } catch {
          return base;
        }
      }
      case 'message':
      default:
        return `[system message] ${body}`;
    }
  }

  /**
   * Read and drain inbox/pending/*.md for this instance.
   * Files are moved to the done directory immediately after reading (messages are already in memory).
   * @protected available for reuse by subclass MotionRuntime
   */
  protected async _drainOwnInbox(): Promise<{
    injected: Message[];
    sources: Array<{ text: string; type: string }>;
    count: number;
    infos: Array<{ meta: Record<string, string>; body: string }>;
  }> {
    const inboxDir = path.join(this.options.clawDir, 'inbox');
    const pendingDir = path.join(inboxDir, 'pending');
    const doneDir = path.join(inboxDir, 'done');

    // Read all pending messages
    let files: string[] = [];
    try {
      const allFiles = await fs.readdir(pendingDir);
      // Log non-.md files for operational troubleshooting
      const skipped = allFiles.filter(f => !f.endsWith('.md') && !f.startsWith('.'));
      if (skipped.length > 0) {
        console.warn(`[inbox] Skipping non-.md files: ${skipped.join(', ')}`);
      }
      files = allFiles.filter(f => f.endsWith('.md'));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[inbox] Failed to read pending dir: ${err?.message}`);
      }
      return { injected: [], sources: [], count: 0, infos: [] };
    }

    if (files.length === 0) return { injected: [], sources: [], count: 0, infos: [] };

    // Sort by priority then filename
    const PRIORITY_ORDER: Record<string, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const fileInfos: Array<{ name: string; priority: number; content: string; meta: Record<string, string>; body: string }> = [];
    for (const name of files) {
      try {
        const content = await fs.readFile(path.join(pendingDir, name), 'utf-8');
        const { meta, body } = parseFrontmatter(content);
        const priority = PRIORITY_ORDER[meta.priority] ?? 3;
        fileInfos.push({ name, priority, content, meta, body });
      } catch {
        // Skip invalid files
      }
    }

    // Sort: priority ascending, then filename ascending
    fileInfos.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });

    // Move to done immediately after reading (messages are in memory; original files no longer needed)
    await fs.mkdir(doneDir, { recursive: true });
    for (const info of fileInfos) {
      try {
        await fs.rename(
          path.join(pendingDir, info.name),
          path.join(doneDir, `${Date.now()}_${info.name}`)
        );
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn(`[inbox] Failed to move ${info.name} to done:`, err?.message);
        }
        // ENOENT = 文件可能已被其他进程移走，正常情况
      }
    }

    // Build message injections (choose template by type)
    // All inbox messages are merged into a single user turn to prevent consecutive
    // same-role messages, which are invalid in the Anthropic API.
    // user_chat messages are placed last so they aren't buried under system messages.

    // Filter: only inject messages addressed to this agent
    const injectedInfos = fileInfos.filter(info => {
      const to = info.meta.to;
      return !to || to === this.options.clawId;
    });

    // Audit log: record all messages (including skipped ones)
    const auditPath = path.join(this.options.clawDir, 'logs', 'audit.log');
    await fs.mkdir(path.dirname(auditPath), { recursive: true });
    for (const info of fileInfos) {
      const skipped = injectedInfos.indexOf(info) === -1;
      const entry = {
        ts: new Date().toISOString(),
        event: skipped ? 'inbox_skip' : 'inbox_inject',
        file: info.name,
        type: info.meta.type ?? 'message',
        source: info.meta.source ?? info.meta.from ?? 'unknown',
        to: info.meta.to ?? '',
        priority: info.meta.priority ?? 'unknown',
      };
      fs.appendFile(auditPath, JSON.stringify(entry) + '\n').catch(e =>
        this.monitor?.log('error', {
          context: 'Runtime.auditLog',
          file: info.name,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    }

    const systemParts: string[] = [];
    const userChatParts: string[] = [];
    const sources: Array<{ text: string; type: string }> = [];
    for (const info of injectedInfos) {
      const from = info.meta.from ?? info.meta.source ?? 'unknown';
      const type = info.meta.type ?? 'message';
      const formatted = await this.formatInboxMessage(type, from, info.body);
      if (type === 'user_chat') {
        userChatParts.push(formatted);
      } else {
        systemParts.push(formatted);
      }
      sources.push({
        text: formatted.replace(/\r?\n/g, ' '),
        type,
      });
    }
    const allParts = [...systemParts, ...userChatParts];
    const injected: Message[] = allParts.length > 0
      ? [{ role: 'user', content: allParts.join('\n\n') }]
      : [];

    // Extract metadata for error notification and review_request handling
    const infos = injectedInfos.map(info => ({
      meta: info.meta,
      body: info.body,
    }));

    return { injected, sources, count: injectedInfos.length, infos };
  }

  /**
   * Run the LLM ReAct loop over the given messages and save the session.
   * @protected available for reuse by subclass MotionRuntime
   */
  protected async _runReact(messages: Message[], callbacks?: StreamCallbacks): Promise<void> {
    this.execContext.dialogMessages = messages;
    const tools = this.toolRegistry.formatForLLM(
      this.toolRegistry.getForProfile(this.options.toolProfile ?? 'full')
    );
    const systemPrompt = await this.buildSystemPrompt();

    // Idle timeout: abort if no token output for idleTimeoutMs (0 = disabled)
    const idleTimeoutMs = this.options.idleTimeoutMs ?? DEFAULT_LLM_IDLE_TIMEOUT_MS;
    let idleTimerId: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = idleTimeoutMs > 0 ? () => {
      clearTimeout(idleTimerId);
      idleTimerId = setTimeout(
        () => this.currentAbortController?.abort({ type: 'idle_timeout', ms: idleTimeoutMs }),
        idleTimeoutMs
      );
    } : undefined;
    resetIdle?.();

    try {
      await runReact({
        messages: messages,
        systemPrompt,
        llm: this.llm,
        executor: this.toolExecutor,
        ctx: this.execContext,
        tools,
        registry: this.toolRegistry,  // Enable parallel execution for readonly tools
        maxSteps: this.options.maxSteps,
        onStepComplete: async () => {
          await this.sessionManager.save(messages);
        },
        onTextDelta: (d) => { resetIdle?.(); callbacks?.onTextDelta?.(d); },
        onTextEnd: callbacks?.onTextEnd,
        onThinkingDelta: (d) => { resetIdle?.(); callbacks?.onThinkingDelta?.(d); },
        onToolCall: (n, id) => { resetIdle?.(); callbacks?.onToolCall?.(n, id); },
        onToolResult: callbacks?.onToolResult,
        onBeforeLLMCall: callbacks?.onBeforeLLMCall,
      });
    } finally {
      clearTimeout(idleTimerId);
    }
    await this.sessionManager.save(messages);
  }

  /**
   * MVP alignment: batch-process inbox messages (polling-based batch instead of event-driven)
   * @returns number of injected messages (0 = nothing pending)
   */
  async processBatch(callbacks?: StreamCallbacks): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const { injected, sources, count, infos } = await this._drainOwnInbox();
    if (count === 0) return 0;

    // Notify daemon-loop which messages were injected
    if (callbacks?.onInboxDrained) {
      callbacks.onInboxDrained(sources);
    }

    // Notify daemon-loop of inbox messages for review_request handling
    if (callbacks?.onInboxMessages && infos.length > 0) {
      try {
        await callbacks.onInboxMessages(
          infos.map(i => ({ meta: i.meta as Record<string, string>, body: i.body ?? '' })),
        );
      } catch (e) {
        console.warn('[runtime] onInboxMessages handler failed:', e instanceof Error ? e.message : String(e));
      }
    }

    const session = await this.sessionManager.load();
    const messages = [...session.messages, ...injected];

    // Save injected messages immediately so interrupt doesn't lose them
    await this.sessionManager.save(messages);

    // AbortController support (same as chat() mode)
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.execContext.signal = abortController.signal;
    try {
      await this._runReact(messages, callbacks);
      return count;
    } catch (err) {
      // Note: do NOT save messages here - _runReact modifies messages in-place
      // and may leave them in an invalid state (e.g., tool_use without tool_result).
      // Valid states are already covered by:
      // 1. The save at line 486 (before _runReact) - preserves injected messages
      // 2. onStepComplete callback - saves after each complete step
      // Notify each inbox sender so they're not left hanging
      if (err instanceof MaxStepsExceededError) {
        const errorMsg = err.message;
        for (const info of infos) {
          if (info.meta.from) {
            await this.outboxWriter.write({
              type: 'response',
              to: info.meta.from,
              content: `Error: ${errorMsg}`,
              contract_id: info.meta.contract_id,
            }).catch(e => console.error('[runtime] Failed to write error response:', e));
          }
        }
      } else if (!(err instanceof Error && err.message === 'Execution aborted')) {
        // Non-interrupt error (LLM crash, tool error, etc.) — notify senders
        const errorMsg = err instanceof Error ? err.message : String(err);
        for (const info of infos) {
          if (info.meta.from) {
            await this.outboxWriter.write({
              type: 'response',
              to: info.meta.from,
              content: `Error: ${errorMsg}`,
              contract_id: info.meta.contract_id,
            }).catch(e => console.error('[runtime] Failed to write error response:', e));
          }
        }
      }
      // Log unexpected errors to audit (aborts and MaxSteps are expected control flow)
      if (
        !(err instanceof Error && err.message === 'Execution aborted') &&
        !(err instanceof MaxStepsExceededError)
      ) {
        this.monitor?.log('error', {
          context: 'Runtime.processBatch',
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      throw err;
    } finally {
      this.currentAbortController = null;
      this.execContext.signal = undefined;
    }
  }

  /**
   * Process a single synthetic message directly (without draining inbox).
   * Used by daemon-loop for in-process startup trigger — message is never persisted to disk.
   */
  async processWithMessage(msg: Message, callbacks?: StreamCallbacks): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    const session = await this.sessionManager.load();
    const messages = [...session.messages, msg];
    await this.sessionManager.save(messages);

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.execContext.signal = abortController.signal;
    try {
      await this._runReact(messages, callbacks);
    } catch (err) {
      // Note: do NOT save messages here - see processBatch catch block for explanation
      throw err;
    } finally {
      this.currentAbortController = null;
      this.execContext.signal = undefined;
    }
  }

  /**
   * Retry the last turn without draining inbox.
   * Used by daemon-loop to recover from transient LLM errors.
   */
  async retryLastTurn(callbacks?: StreamCallbacks): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    const session = await this.sessionManager.load();
    if (session.messages.length === 0) return;

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.execContext.signal = abortController.signal;
    try {
      await this._runReact(session.messages, callbacks);
    } finally {
      this.currentAbortController = null;
      this.execContext.signal = undefined;
    }
  }

  /**
   * Interactive conversation (used by CLI)
   */
  async chat(
    userMessage: string,
    options?: {
      onToolCall?: (toolName: string, toolUseId: string) => void;
      onBeforeLLMCall?: () => void;
      onToolResult?: (toolName: string, toolUseId: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
      onTextDelta?: (delta: string) => void;  // streaming text delta
      onThinkingDelta?: (delta: string) => void;  // streaming thinking delta
    }
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. Load the current session
    const session = await this.sessionManager.load();
    const messages = [...session.messages];

    // 2. Build systemPrompt (already includes AGENTS.md + MEMORY.md + skills + contract)
    const systemPrompt = await this.buildSystemPrompt();

    // 3. Append the user message
    messages.push({ role: 'user', content: userMessage });

    // 4. Get tool definitions
    const tools = this.toolRegistry.formatForLLM(
      this.toolRegistry.getForProfile(this.options.toolProfile ?? 'full')
    );

    // 5. Run the ReAct loop (with incremental session saves)
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.execContext.signal = abortController.signal;
    try {
      const result = await runReact({
        messages,
        systemPrompt,
        llm: this.llm,
        executor: this.toolExecutor,
        ctx: this.execContext,
        tools,
        registry: this.toolRegistry,  // Enable parallel execution for readonly tools
        maxSteps: this.options.maxSteps,
        onToolCall: options?.onToolCall,
        onBeforeLLMCall: options?.onBeforeLLMCall,
        onToolResult: options?.onToolResult,
        onTextDelta: options?.onTextDelta,  // pass through streaming text delta
        onThinkingDelta: options?.onThinkingDelta,  // pass through streaming thinking delta
        onStepComplete: async () => {
          // Incremental session save
          await this.sessionManager.save(messages);
        },
      });

      // Save the final session
      await this.sessionManager.save(messages);

      // Return the final text
      return result.finalText;
    } finally {
      this.currentAbortController = null;
      this.execContext.signal = undefined;
    }
  }

  /**
   * Abort the currently running chat() call
   */
  abort(): void {
    this.currentAbortController?.abort();
  }

  /**
   * Handle an inbox message (internal method)
   */
  private async handleMessage(msg: InboxMessage): Promise<void> {
    // Convert message to conversation input
    const userMessage = `[${msg.from}] ${msg.content}`;

    try {
      const response = await this.chat(userMessage);

      // Write to outbox
      await this.outboxWriter.write({
        type: 'response',
        to: msg.from,
        content: response,
        contract_id: msg.contract_id,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      try {
        // Write error response
        await this.outboxWriter.write({
          type: 'response',
          to: msg.from,
          content: `Error processing message: ${errorMsg}`,
          contract_id: msg.contract_id,
        });
      } catch (writeErr) {
        this.monitor?.log('error', {
          context: 'Runtime.handleMessage',
          originalError: errorMsg,
          writeError: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
        throw writeErr;
      }
    }
  }

  /**
   * Get runtime status (for diagnostics)
   */
  getStatus(): {
    initialized: boolean;
    running: boolean;
    clawId: string;
  } {
    return {
      initialized: this.initialized,
      running: this.running,
      clawId: this.options.clawId,
    };
  }

  /**
   * Get TaskSystem instance (for retrospective scheduling)
   */
  getTaskSystem(): TaskSystem {
    return this.taskSystem;
  }

  // ============================================================================
  // Protected methods (may be overridden by subclasses)
  // ============================================================================

  /**
   * Build the system prompt (may be overridden by subclasses to customize injection order).
   * Default behavior: AGENTS.md + MEMORY.md + skills + contract
   */
  protected async buildSystemPrompt(): Promise<string> {
    return this.contextInjector.buildSystemPrompt();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async ensureDirectories(clawDir: string): Promise<void> {
    // Use the shared constant (consistent with createCommand)
    // Use Node fs directly to create directories (NodeFileSystem is not yet initialized)
    const { promises: nodeFs } = await import('fs');
    for (const dir of CLAW_SUBDIRS) {
      await nodeFs.mkdir(path.join(clawDir, dir), { recursive: true });
    }
  }

  /**
   * Set callback for contract notifications (subtask_completed, acceptance_failed, etc.)
   */
  setContractNotifyCallback(cb: (type: string, data: Record<string, unknown>) => void): void {
    this.contractManager?.setOnNotify(cb);
  }

  setParentStreamWriter(writer: { write(event: Record<string, unknown>): void }): void {
    this.execContext.parentStreamWriter = writer;
  }

}
