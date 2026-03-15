/**
 * ClawRuntime - 组装所有模块的可运行 Claw 实例
 * 
 * 这是 Phase 1 的最终组装层，将以下模块整合为统一运行时：
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
import { runReact } from './react/loop.js';
import { InboxWatcher } from './communication/inbox.js';
import { OutboxWriter } from './communication/outbox.js';
import { TaskSystem } from './task/system.js';
import { SkillRegistry } from './skill/registry.js';
import { ContractManager } from './contract/manager.js';
import { CLAW_SUBDIRS } from '../types/paths.js';

/**
 * ClawRuntime 构造选项
 */
export interface ClawRuntimeOptions {
  clawId: string;
  clawDir: string;
  llmConfig: LLMServiceConfig;
  monitorDir?: string;
  maxSteps?: number;
  toolProfile?: ToolProfile;
}

/**
 * ClawRuntime - 完整的 Claw 运行时实例
 */
export class ClawRuntime {
  protected options: ClawRuntimeOptions;
  protected initialized = false;
  private running = false;
  private currentAbortController: AbortController | null = null;

  // Foundation
  /**
   * @protected 允许 MotionRuntime 等子类读取系统文件（SOUL.md, REVIEW.md 等）
   * 注意：子类不应直接写入，保持运行时封装性
   */
  protected systemFs!: NodeFileSystem;  // 系统组件使用（无权限检查）
  private clawFs!: NodeFileSystem;    // 工具使用（有权限检查）
  private monitor!: JsonlMonitor;
  protected llm!: LLMService;
  private transport!: LocalTransport;

  // Core
  protected sessionManager!: SessionManager;
  /**
   * @protected 允许 MotionRuntime 等子类调用 buildParts() 自定义提示词注入顺序
   * 注意：子类只读使用，不应修改 injector 状态
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
      maxSteps: 100,
      toolProfile: 'full',
      ...options,
    };
  }

  /**
   * 初始化所有模块
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { clawId, clawDir, llmConfig, monitorDir, maxSteps, toolProfile } = this.options;

    // 1. 创建目录结构
    await this.ensureDirectories(clawDir);

    // 2. 创建两个 NodeFileSystem 实例
    // systemFs: 系统组件使用（dialog/, contract/ 等），不强制权限
    this.systemFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    // clawFs: 工具使用，强制权限检查
    this.clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

    // 2.5 启动时清理孤立临时文件（best-effort）
    this.systemFs.cleanupTempFiles().catch(err => {
      console.warn('[runtime] Failed to cleanup temp files:', err);
    });

    // 3. 创建 JsonlMonitor
    const logsDir = monitorDir || path.join(clawDir, 'logs');
    this.monitor = new JsonlMonitor({ logsDir });

    // 4. 创建 LLMService
    this.llm = new LLMService(llmConfig, this.monitor, clawId);

    // 5. 创建 LocalTransport（workspaceDir = clawDir 的父目录）
    const workspaceDir = path.dirname(clawDir);
    this.transport = new LocalTransport({ workspaceDir });
    await this.transport.initialize();

    // 6. 创建 SessionManager（使用 systemFs，系统组件需要写 dialog/）
    this.sessionManager = new SessionManager(this.systemFs, 'dialog', clawId);

    // 7. 创建 ToolRegistry + 注册内置工具
    this.toolRegistry = new ToolRegistry();
    registerBuiltinTools(this.toolRegistry);

    // 8. 创建 TaskSystem
    this.taskSystem = new TaskSystem(clawDir, this.systemFs, this.transport);
    await this.taskSystem.initialize();
    this.taskSystem.setLLMService(this.llm);

    // 9. 创建 SkillRegistry（懒加载技能）
    this.skillRegistry = new SkillRegistry(this.systemFs, 'skills');
    await this.skillRegistry.loadAll();

    // 10. 创建 ContractManager
    this.contractManager = new ContractManager(clawDir, this.systemFs, this.monitor);

    // 11. 创建 ContextInjector（注入 skillRegistry 和 contractManager）
    this.contextInjector = new ContextInjector({
      fs: this.systemFs,
      skillRegistry: this.skillRegistry,
      contractManager: this.contractManager,
    });

    // 12. 创建 ExecContextImpl（注入所有依赖，工具使用 clawFs）
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
    });

    // 13. 创建 ToolExecutorImpl
    this.toolExecutor = new ToolExecutorImpl(this.toolRegistry);

    // 14. 创建 InboxWatcher + OutboxWriter（系统组件使用 systemFs）
    this.inboxWatcher = new InboxWatcher(clawDir, this.systemFs);
    this.outboxWriter = new OutboxWriter(clawId, clawDir, this.systemFs);

    this.initialized = true;
  }

  /**
   * 启动后台事件循环
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.initialized) {
      await this.initialize();
    }

    // 启动 InboxWatcher
    await this.inboxWatcher.start(this.handleMessage.bind(this));

    // 如果有暂停的活跃契约，恢复执行
    const active = await this.contractManager.loadActive();
    if (active && active.status === 'paused') {
      await this.contractManager.resume(active.id);
    }

    this.running = true;
  }

  /**
   * 优雅停止
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // 停止 InboxWatcher
    await this.inboxWatcher.stop();

    // 关闭 TaskSystem
    await this.taskSystem.shutdown(30_000);

    // 关闭 LLMService
    await this.llm.close();

    this.running = false;
  }

  /**
   * MVP 对齐：恢复暂停的契约（抽取自 start()）
   */
  async resumeContractIfPaused(): Promise<void> {
    const active = await this.contractManager.loadActive();
    if (active && active.status === 'paused') {
      await this.contractManager.resume(active.id);
    }
  }

  /**
   * 读取并 drain 自身 inbox/pending/*.md
   * 已 rename 到 done/（LLM 调用前），返回注入消息
   * @protected 供子类 MotionRuntime 复用
   */
  protected async _drainOwnInbox(): Promise<{ injected: Message[]; count: number }> {
    const inboxDir = path.join(this.options.clawDir, 'inbox');
    const pendingDir = path.join(inboxDir, 'pending');
    const doneDir = path.join(inboxDir, 'done');

    // 读取所有待处理消息
    let files: string[] = [];
    try {
      files = await fs.readdir(pendingDir);
      files = files.filter(f => f.endsWith('.md'));
    } catch {
      return { injected: [], count: 0 };
    }

    if (files.length === 0) return { injected: [], count: 0 };

    // 按 priority + filename 排序
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

    // 排序：priority 升序，然后 filename 升序
    fileInfos.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });

    // 移入 done/（在 LLM 调用前，MVP 行为）
    for (const info of fileInfos) {
      try {
        await fs.rename(
          path.join(pendingDir, info.name),
          path.join(doneDir, `${Date.now()}_${info.name}`)
        );
      } catch {
        // Continue even if move fails
      }
    }

    // 构建消息注入
    const injected: Message[] = [];
    for (const info of fileInfos) {
      const from = info.meta.from ?? info.meta.source ?? 'unknown';
      injected.push({
        role: 'user',
        content: `[inbox 消息 from ${from}]\n${info.body}`,
      });
    }

    return { injected, count: fileInfos.length };
  }

  /**
   * 在给定 messages 上执行 LLM react 循环并保存 session
   * @protected 供子类 MotionRuntime 复用
   */
  protected async _runReact(messages: Message[]): Promise<void> {
    const tools = this.toolRegistry.formatForLLM(
      this.toolRegistry.getForProfile(this.options.toolProfile ?? 'full')
    );
    const systemPrompt = await this.buildSystemPrompt();
    await runReact({
      messages,
      systemPrompt,
      llm: this.llm,
      executor: this.toolExecutor,
      ctx: this.execContext,
      tools,
      maxSteps: this.options.maxSteps,
      onStepComplete: async () => {
        await this.sessionManager.save(messages);
      },
    });
    await this.sessionManager.save(messages);
  }

  /**
   * MVP 对齐：批量处理 inbox 消息（批处理轮询代替事件驱动）
   * @returns 注入的消息数（0 = 无待处理）
   */
  async processBatch(): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const { injected, count } = await this._drainOwnInbox();
    if (count === 0) return 0;

    const session = await this.sessionManager.load();
    const messages = [...session.messages, ...injected];
    await this._runReact(messages);

    return count;
  }

  /**
   * 交互式对话（CLI 使用）
   */
  async chat(
    userMessage: string, 
    options?: { 
      onToolCall?: (toolName: string) => void;
      onBeforeLLMCall?: () => void;
      onToolResult?: (toolName: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
    }
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. 加载当前会话
    const session = await this.sessionManager.load();
    const messages = [...session.messages];

    // 2. 构建 systemPrompt（已包含 AGENTS.md + MEMORY.md + skills + contract）
    const systemPrompt = await this.buildSystemPrompt();

    // 3. 追加 user 消息
    messages.push({ role: 'user', content: userMessage });

    // 4. 获取工具定义
    const tools = this.toolRegistry.formatForLLM(
      this.toolRegistry.getForProfile(this.options.toolProfile ?? 'full')
    );

    // 5. 运行 ReAct 循环（带增量存盘）
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
        maxSteps: this.options.maxSteps,
        onToolCall: options?.onToolCall,
        onBeforeLLMCall: options?.onBeforeLLMCall,
        onToolResult: options?.onToolResult,
        onStepComplete: async () => {
          // 增量存盘
          await this.sessionManager.save(messages);
        },
      });

      // 保存最终会话
      await this.sessionManager.save(messages);

      // 返回最终文本
      return result.finalText;
    } finally {
      this.currentAbortController = null;
      this.execContext.signal = undefined;
    }
  }

  /**
   * 中断当前正在进行的 chat() 调用
   */
  abort(): void {
    this.currentAbortController?.abort();
  }

  /**
   * 处理 inbox 消息（内部方法）
   */
  private async handleMessage(msg: InboxMessage): Promise<void> {
    // 将消息转为对话
    const userMessage = `[${msg.from}] ${msg.content}`;
    
    try {
      const response = await this.chat(userMessage);
      
      // 写入 outbox
      await this.outboxWriter.write({
        type: 'response',
        to: msg.from,
        content: response,
        contract_id: msg.contract_id,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 写入错误响应
      await this.outboxWriter.write({
        type: 'response',
        to: msg.from,
        content: `Error processing message: ${errorMsg}`,
        contract_id: msg.contract_id,
      });
    }
  }

  /**
   * 获取运行时状态（用于诊断）
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

  // ============================================================================
  // Protected methods (可被子类覆盖)
  // ============================================================================

  /**
   * 构建系统提示词（可被子类覆盖以自定义注入顺序）
   * 默认行为：AGENTS.md + MEMORY.md + skills + contract
   */
  protected async buildSystemPrompt(): Promise<string> {
    return this.contextInjector.buildSystemPrompt();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async ensureDirectories(clawDir: string): Promise<void> {
    // 使用共享常量（与 createCommand 保持一致）
    // 使用 Node fs 直接创建目录（因为 NodeFileSystem 还未初始化）
    const { promises: nodeFs } = await import('fs');
    for (const dir of CLAW_SUBDIRS) {
      await nodeFs.mkdir(path.join(clawDir, dir), { recursive: true });
    }
  }

}
