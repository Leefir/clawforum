/**
 * ClawRuntime - 组装所有模块的可运行 Claw 实例
 * 
 * 这是 Phase 1 的最终组装层，将以下模块整合为统一运行时：
 * - Foundation: NodeFileSystem, LLMService, JsonlMonitor, LocalTransport
 * - Core: Dialog, Tools, ReAct, Communication, Task, Skill, Contract
 */

import * as path from 'path';
import type { LLMServiceConfig } from '../foundation/llm/types.js';
import type { ToolProfile } from '../types/config.js';
import type { Message } from '../types/message.js';
import type { InboxMessage } from '../types/contract.js';
import type { OutboxWriteOptions } from './communication/outbox.js';
import type { SessionData } from './dialog/types.js';

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
  private options: ClawRuntimeOptions;
  private initialized = false;
  private running = false;

  // Foundation
  private fs!: NodeFileSystem;
  private monitor!: JsonlMonitor;
  private llm!: LLMService;
  private transport!: LocalTransport;

  // Core
  private sessionManager!: SessionManager;
  private contextInjector!: ContextInjector;
  private toolRegistry!: ToolRegistry;
  private taskSystem!: TaskSystem;
  private skillRegistry!: SkillRegistry;
  private contractManager!: ContractManager;
  private execContext!: ExecContextImpl;
  private toolExecutor!: ToolExecutorImpl;
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

    // 2. 创建 NodeFileSystem（runtime 层不强制权限，由具体工具检查）
    this.fs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });

    // 3. 创建 JsonlMonitor
    const logsDir = monitorDir || path.join(clawDir, 'logs');
    this.monitor = new JsonlMonitor({ logsDir });

    // 4. 创建 LLMService
    this.llm = new LLMService(llmConfig, this.monitor, clawId);

    // 5. 创建 LocalTransport（workspaceDir = clawDir 的父目录）
    const workspaceDir = path.dirname(clawDir);
    this.transport = new LocalTransport({ workspaceDir });
    await this.transport.initialize();

    // 6. 创建 SessionManager
    this.sessionManager = new SessionManager(this.fs, 'dialog', clawId);

    // 7. 创建 ContextInjector
    this.contextInjector = new ContextInjector(this.fs);

    // 8. 创建 ToolRegistry + 注册内置工具
    this.toolRegistry = new ToolRegistry();
    registerBuiltinTools(this.toolRegistry);

    // 9. 创建 TaskSystem
    this.taskSystem = new TaskSystem(clawDir, this.fs, this.transport);
    await this.taskSystem.initialize();
    this.taskSystem.setLLMService(this.llm);

    // 10. 创建 SkillRegistry（懒加载技能）
    this.skillRegistry = new SkillRegistry(this.fs, 'skills');
    await this.skillRegistry.loadAll();

    // 11. 创建 ContractManager
    this.contractManager = new ContractManager(clawDir, this.fs, this.monitor);

    // 12. 创建 ExecContextImpl（注入所有依赖）
    this.execContext = new ExecContextImpl({
      clawId,
      clawDir,
      profile: toolProfile!,
      fs: this.fs,
      monitor: this.monitor,
      llm: this.llm,
      maxSteps,
      taskSystem: this.taskSystem,
      skillRegistry: this.skillRegistry,
      contractManager: this.contractManager,
    });

    // 13. 创建 ToolExecutorImpl
    this.toolExecutor = new ToolExecutorImpl(this.toolRegistry);

    // 14. 创建 InboxWatcher + OutboxWriter
    this.inboxWatcher = new InboxWatcher(clawDir, this.fs);
    this.outboxWriter = new OutboxWriter(clawId, clawDir, this.fs);

    // 15. 创建活跃契约上下文（如果有）
    const activeContract = await this.contractManager.loadActive();
    if (activeContract) {
      // 将契约信息注入上下文
      const contractContext = this.formatContractContext(activeContract);
      // 这里可以扩展 ContextInjector 支持动态添加上下文
    }

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
   * 交互式对话（CLI 使用）
   */
  async chat(userMessage: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. 加载当前会话
    const session = await this.sessionManager.load();
    const messages = [...session.messages];

    // 2. 构建 systemPrompt
    const basePrompt = await this.contextInjector.buildSystemPrompt();
    const skillContext = this.skillRegistry.formatForContext();
    const systemPrompt = [basePrompt, skillContext].filter(Boolean).join('\n\n');

    // 3. 追加 user 消息
    messages.push({ role: 'user', content: userMessage });

    // 4. 运行 ReAct 循环（带增量存盘）
    const result = await runReact({
      messages,
      systemPrompt,
      llm: this.llm,
      executor: this.toolExecutor,
      ctx: this.execContext,
      maxSteps: this.options.maxSteps,
      onStepComplete: async () => {
        // 增量存盘
        await this.sessionManager.save(messages);
      },
    });

    // 5. 保存最终会话
    await this.sessionManager.save(messages);

    // 6. 返回最终文本
    return result.finalText;
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
  // Private helpers
  // ============================================================================

  private async ensureDirectories(clawDir: string): Promise<void> {
    const dirs = [
      'dialog',
      'dialog/archive',
      'inbox/pending',
      'inbox/done',
      'inbox/failed',
      'outbox/pending',
      'tasks/pending',
      'tasks/running',
      'tasks/done',
      'tasks/results',
      'memory',
      'contract',
      'skills',
      'clawspace',
      'logs',
    ];

    // 使用 Node fs 直接创建目录（因为 NodeFileSystem 还未初始化）
    const { promises: nodeFs } = await import('fs');
    for (const dir of dirs) {
      await nodeFs.mkdir(path.join(clawDir, dir), { recursive: true });
    }
  }

  private formatContractContext(contract: { id: string; title: string; goal: string }): string {
    return `## Active Contract\n- ID: ${contract.id}\n- Title: ${contract.title}\n- Goal: ${contract.goal}`;
  }
}
