/**
 * TaskSystem - SubAgent task lifecycle management
 * 
 * Manages subagent task queue and execution using directory-based persistence.
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { ITransport, InboxMessage } from '../../foundation/transport/index.js';
import { JsonlMonitor } from '../../foundation/monitor/index.js';
import { SubAgent } from '../subagent/agent.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerBuiltinTools } from '../tools/builtins/index.js';
import type { ILLMService } from '../../foundation/llm/index.js';

export interface SubAgentTask {
  id: string;
  prompt: string;
  skills: string[];
  tools: string[];
  timeout: number;
  maxSteps: number;
  parentClawId: string;
  createdAt: string;
}

interface TaskState {
  task: SubAgentTask;
  abortController: AbortController;
  promise: Promise<void>;
}

export class TaskSystem {
  private runningTasks: Map<string, TaskState> = new Map();
  private maxConcurrent: number;
  private monitor: JsonlMonitor;
  private registry: ToolRegistry;
  private llm?: ILLMService;

  constructor(
    private clawDir: string,
    private fs: IFileSystem,
    private transport: ITransport,
    options: { maxConcurrent?: number } = {}
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.monitor = new JsonlMonitor({ logsDir: path.join(clawDir, 'logs') });
    // Create tool registry for subagents
    this.registry = new ToolRegistry();
    registerBuiltinTools(this.registry);
  }

  async initialize(): Promise<void> {
    // Ensure task directories exist
    await this.fs.ensureDir('tasks/pending');
    await this.fs.ensureDir('tasks/running');
    await this.fs.ensureDir('tasks/done');
    await this.fs.ensureDir('tasks/results');
  }

  setLLMService(llm: ILLMService): void {
    this.llm = llm;
  }

  /**
   * Schedule a new subagent task
   * Returns taskId immediately, task executes asynchronously
   */
  async scheduleSubAgent(taskData: Omit<SubAgentTask, 'id' | 'createdAt'>): Promise<string> {
    if (this.runningTasks.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent tasks (${this.maxConcurrent}) reached`);
    }

    const taskId = randomUUID();
    const task: SubAgentTask = {
      ...taskData,
      id: taskId,
      createdAt: new Date().toISOString(),
    };

    // Save to running directory
    const taskPath = `tasks/running/${taskId}.json`;
    await this.fs.writeAtomic(taskPath, JSON.stringify(task, null, 2));

    // Start execution
    const abortController = new AbortController();
    const promise = this.executeTask(task, abortController.signal);

    this.runningTasks.set(taskId, { task, abortController, promise });

    // Log
    this.monitor.log('subagent_spawned', {
      taskId,
      parentClawId: task.parentClawId,
      maxSteps: task.maxSteps,
    });

    return taskId;
  }

  /**
   * Execute a task - internal method
   */
  private async executeTask(task: SubAgentTask, signal: AbortSignal): Promise<void> {
    try {
      if (!this.llm) {
        throw new Error('LLM service not set. Call setLLMService() before scheduling tasks.');
      }

      const subAgent = new SubAgent({
        agentId: task.id,
        prompt: task.prompt,
        clawDir: this.clawDir,
        llm: this.llm,
        registry: this.registry,
        fs: this.fs,
        maxSteps: task.maxSteps,
        timeoutMs: task.timeout * 1000,
        signal,
      });

      const result = await subAgent.run();

      // Send success result to parent inbox
      await this.sendResult(task, result, false);

      this.monitor.log('subagent_completed', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        resultLength: result.length,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Send error result to parent inbox
      await this.sendResult(task, errorMsg, true);

      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: errorMsg,
      });
    } finally {
      // Move from running to done
      await this.moveTaskToDone(task.id);
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * Send task result to parent claw's inbox
   */
  private async sendResult(task: SubAgentTask, result: string, isError: boolean): Promise<void> {
    try {
      const message: InboxMessage = {
        id: randomUUID(),
        type: 'message',
        from: 'subagent',
        to: task.parentClawId,
        content: JSON.stringify({ taskId: task.id, result, is_error: isError }),
        priority: isError ? 'high' : 'normal',
        timestamp: new Date().toISOString(),
      };

      await this.transport.sendInboxMessage(task.parentClawId, message);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: errMsg,
      });
    }
  }

  /**
   * Move task file from running to done
   */
  private async moveTaskToDone(taskId: string): Promise<void> {
    try {
      const runningPath = `tasks/running/${taskId}.json`;
      const donePath = `tasks/done/${taskId}.json`;
      
      const content = await this.fs.read(runningPath);
      await this.fs.writeAtomic(donePath, content);
      await this.fs.delete(runningPath);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.monitor.log('error', { taskId, error: errMsg });
    }
  }

  /**
   * List running task IDs
   */
  listRunning(): string[] {
    return Array.from(this.runningTasks.keys());
  }

  /**
   * Cancel a running task
   */
  async cancel(taskId: string): Promise<void> {
    const state = this.runningTasks.get(taskId);
    if (!state) {
      throw new Error(`Task ${taskId} not found`);
    }

    state.abortController.abort();
    
    try {
      await state.promise;
    } catch {
      // Expected on abort
    }

    await this.moveTaskToDone(taskId);
    this.runningTasks.delete(taskId);

    this.monitor.log('error', { taskId, reason: 'cancelled' });
  }

  /**
   * Shutdown - wait for all tasks to complete or timeout
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    // Signal all tasks to stop
    for (const state of this.runningTasks.values()) {
      state.abortController.abort();
    }

    // Wait for all tasks with timeout
    if (this.runningTasks.size > 0) {
      const promises = Array.from(this.runningTasks.values()).map(s => s.promise);
      await Promise.race([
        Promise.allSettled(promises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)),
      ]).catch(() => {
        // Timeout is acceptable
      });
    }

    this.runningTasks.clear();
    await this.monitor.close();
  }
}
