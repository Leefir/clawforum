/**
 * TaskSystem - SubAgent task lifecycle management
 * 
 * Manages subagent task queue and execution using directory-based persistence.
 * Uses a pending queue + dispatcher pattern for concurrency control.
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { ITransport } from '../../foundation/transport/index.js';
import { JsonlMonitor } from '../../foundation/monitor/index.js';
import { SubAgent } from '../subagent/agent.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerBuiltinTools } from '../tools/builtins/index.js';
import type { ILLMService } from '../../foundation/llm/index.js';
import type { ToolResult } from '../tools/executor.js';

export interface SubAgentTask {
  kind: 'subagent';
  id: string;
  prompt: string;
  skills: string[];
  tools: string[];
  timeout: number;
  maxSteps: number;
  parentClawId: string;
  createdAt: string;
}

export interface ToolTask {
  kind: 'tool';
  id: string;
  toolName: string;
  parentClawId: string;
  createdAt: string;
  isIdempotent: boolean;  // Determines if retry is allowed
  maxRetries: number;     // Max retry attempts (default 2)
  retryCount: number;     // Current retry count (initial 0)
}

interface TaskState {
  task: SubAgentTask | ToolTask;
  abortController: AbortController;
  promise: Promise<void>;
}

export class TaskSystem {
  private runningTasks: Map<string, TaskState> = new Map();
  private maxConcurrent: number;
  private monitor: JsonlMonitor;
  private registry: ToolRegistry;
  private llm?: ILLMService;
  
  // Pending queue for tasks waiting to be executed
  private pendingQueue: Array<SubAgentTask | ToolTask> = [];
  // Store tool callbacks separately (not serializable to disk)
  private pendingCallbacks: Map<string, () => Promise<ToolResult>> = new Map();

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
    
    // Cold-start recovery: load existing pending and running tasks
    await this.recoverTasks();
    
    // Note: startDispatch() should be called after setLLMService() to avoid race conditions
  }

  /**
   * Start dispatching pending tasks.
   * Must be called after setLLMService() for subagent tasks to work correctly.
   */
  startDispatch(): void {
    this._dispatch();
  }

  /**
   * Recover tasks from filesystem on startup
   * - Pending tasks: load into queue
   * - Running tasks: move back to pending (they need to be re-executed)
   */
  private async recoverTasks(): Promise<void> {
    try {
      // First, move any running tasks back to pending (they were interrupted)
      const runningEntries = await this.fs.list('tasks/running');
      for (const entry of runningEntries) {
        if (entry.name.endsWith('.json')) {
          try {
            const content = await this.fs.read(entry.path);
            const task = JSON.parse(content) as SubAgentTask | ToolTask;
            // Move to pending
            const pendingPath = `tasks/pending/${task.id}.json`;
            await this.fs.writeAtomic(pendingPath, content);
            await this.fs.delete(entry.path);
            this.pendingQueue.push(task);
            this.monitor.log('task_recovered', {
              taskId: task.id,
              kind: task.kind,
              from: 'running',
              to: 'pending',
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.monitor.log('error', {
              error: `Failed to recover running task: ${errMsg}`,
              path: entry.path,
            });
          }
        }
      }
      
      // Load pending tasks
      const pendingEntries = await this.fs.list('tasks/pending');
      for (const entry of pendingEntries) {
        if (entry.name.endsWith('.json')) {
          try {
            const content = await this.fs.read(entry.path);
            const task = JSON.parse(content) as SubAgentTask | ToolTask;
            this.pendingQueue.push(task);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.monitor.log('error', {
              error: `Failed to load pending task: ${errMsg}`,
              path: entry.path,
            });
          }
        }
      }
      
      // Sort pending queue by createdAt to maintain order
      this.pendingQueue.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      this.monitor.log('task_recovery_complete', {
        pendingCount: this.pendingQueue.length,
        runningCount: this.runningTasks.size,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.monitor.log('error', {
        error: `Task recovery failed: ${errMsg}`,
      });
    }
  }

  setLLMService(llm: ILLMService): void {
    this.llm = llm;
  }

  /**
   * Schedule a new subagent task
   * Returns taskId immediately, task enters pending queue and will be dispatched
   */
  async scheduleSubAgent(taskData: Omit<SubAgentTask, 'id' | 'createdAt'>): Promise<string> {
    const taskId = randomUUID();
    const task: SubAgentTask = {
      ...taskData,
      id: taskId,
      createdAt: new Date().toISOString(),
    };

    // Save to pending directory
    const taskPath = `tasks/pending/${taskId}.json`;
    await this.fs.writeAtomic(taskPath, JSON.stringify(task, null, 2));

    // Add to pending queue
    this.pendingQueue.push(task);

    // Log
    this.monitor.log('subagent_scheduled', {
      taskId,
      parentClawId: task.parentClawId,
      maxSteps: task.maxSteps,
      queuePosition: this.pendingQueue.length,
    });

    // Trigger dispatch
    this._dispatch();

    return taskId;
  }

  /**
   * Schedule a new tool task for async execution
   * Returns taskId immediately, task enters pending queue and will be dispatched
   */
  async scheduleTool(
    toolName: string,
    executeCallback: () => Promise<ToolResult>,
    parentClawId: string,
    options?: { isIdempotent?: boolean; maxRetries?: number }
  ): Promise<string> {
    const taskId = randomUUID();
    const isIdempotent = options?.isIdempotent ?? false;
    const task: ToolTask = {
      kind: 'tool',
      id: taskId,
      toolName,
      parentClawId,
      createdAt: new Date().toISOString(),
      isIdempotent,
      maxRetries: isIdempotent ? (options?.maxRetries ?? 2) : 0,
      retryCount: 0,
    };

    // Store callback first (before any async operations)
    this.pendingCallbacks.set(taskId, executeCallback);

    // Save to pending directory
    const taskPath = `tasks/pending/${taskId}.json`;
    await this.fs.writeAtomic(taskPath, JSON.stringify(task, null, 2));

    // Add to pending queue
    this.pendingQueue.push(task);

    // Log
    this.monitor.log('tool_task_scheduled', {
      taskId,
      parentClawId,
      toolName,
      queuePosition: this.pendingQueue.length,
    });

    // Trigger dispatch
    this._dispatch();

    return taskId;
  }

  /**
   * Dispatch pending tasks to running state
   * This is the core dispatcher that manages concurrency
   * 
   * CRITICAL: Must immediately occupy slot in runningTasks before any async
   * operation to prevent race conditions where _dispatch is called again.
   */
  private _dispatch(): void {
    // While we have capacity and pending tasks, move them to running
    while (this.runningTasks.size < this.maxConcurrent && this.pendingQueue.length > 0) {
      const task = this.pendingQueue.shift();
      if (!task) break;
      
      const abortController = new AbortController();
      
      // Start the task (this will handle file move + execution)
      const promise = this._startTask(task, abortController.signal);
      
      // IMMEDIATELY occupy slot - critical to prevent race conditions
      this.runningTasks.set(task.id, { task, abortController, promise });
    }
  }

  /**
   * Start a task: move from pending to running, then execute
   */
  private async _startTask(
    task: SubAgentTask | ToolTask,
    signal: AbortSignal
  ): Promise<void> {
    try {
      // Move file from pending to running (async operation)
      await this.movePendingToRunning(task.id);
      
      // Execute the task
      if (task.kind === 'tool') {
        const callback = this.pendingCallbacks.get(task.id);
        this.pendingCallbacks.delete(task.id); // Clean up
        
        if (callback) {
          await this.executeToolTask(task, callback, signal);
        } else {
          // Recovery case: callback lost after restart
          await this.sendToolResult(
            task, 
            'Task failed: daemon restarted while task was pending. Please re-submit the task.', 
            true
          );
          // Move to done
          await this.moveTaskToDone(task.id);
        }
      } else {
        await this.executeTask(task, signal);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.monitor.log('error', {
        taskId: task.id,
        error: `Task start/execution failed: ${errorMsg}`,
      });
      
      // Clean up callback if present
      this.pendingCallbacks.delete(task.id);
    } finally {
      // Remove from running and trigger next dispatch
      this.runningTasks.delete(task.id);
      this._dispatch();
    }
  }

  /**
   * Move task file from pending to running directory
   */
  private async movePendingToRunning(taskId: string): Promise<void> {
    const pendingPath = `tasks/pending/${taskId}.json`;
    const runningPath = `tasks/running/${taskId}.json`;
    
    const content = await this.fs.read(pendingPath);
    await this.fs.writeAtomic(runningPath, content);
    await this.fs.delete(pendingPath);
  }

  /**
   * Execute a task - internal method
   */
  private async executeTask(task: SubAgentTask, signal: AbortSignal): Promise<void> {
    try {
      if (!this.llm) {
        throw new Error('LLM service not set. Call setLLMService() before scheduling tasks.');
      }

      // Filter tools based on task.tools whitelist
      const allowedTools = task.tools.length > 0
        ? this.registry.getAll().filter(t => task.tools.includes(t.name))
        : this.registry.getAll();
      const toolsForLLM = this.registry.formatForLLM(allowedTools);

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
        toolsForLLM,
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
    }
  }

  /**
   * Execute a tool task - internal method
   * Implements retry logic for idempotent tools with exponential backoff
   */
  private async executeToolTask(
    task: ToolTask,
    executeCallback: () => Promise<ToolResult>,
    signal: AbortSignal,
  ): Promise<void> {
    let lastError: string | undefined;
    let success = false;
    const maxAttempts = task.maxRetries + 1; // Initial + retries

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check abort signal before each attempt
      if (signal.aborted) {
        lastError = 'Execution aborted';
        break;
      }

      try {
        const result = await executeCallback();
        // Success - send result and mark success
        await this.sendToolResult(task, result, false);
        success = true;
        this.monitor.log('tool_task_completed', {
          taskId: task.id,
          parentClawId: task.parentClawId,
          toolName: task.toolName,
          retriesUsed: attempt,
        });
        break; // Exit retry loop on success
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = errorMsg;

        // Check if we should retry
        if (attempt < task.maxRetries) {
          // Update retry count in task and persist to running file
          task.retryCount = attempt + 1;
          try {
            await this.fs.writeAtomic(
              `tasks/running/${task.id}.json`,
              JSON.stringify(task, null, 2)
            );
          } catch (writeErr) {
            // Non-critical: just log
            this.monitor.log('error', {
              taskId: task.id,
              error: `Failed to update retry count: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            });
          }

          this.monitor.log('tool_task_retry', {
            taskId: task.id,
            toolName: task.toolName,
            parentClawId: task.parentClawId,
            attempt: attempt + 1,
            maxRetries: task.maxRetries,
            error: errorMsg,
          });

          // Exponential backoff: 500ms, 1000ms, etc.
          const backoffMs = 500 * (attempt + 1);
          await new Promise(r => setTimeout(r, backoffMs));
          
          // Check abort signal after sleep
          if (signal.aborted) {
            lastError = 'Execution aborted during retry wait';
            break;
          }
        }
        // Continue to next retry attempt
      }
    }

    // If not successful after all attempts, send error result
    try {
      if (!success) {
        const finalError = lastError || 'Unknown error';
        await this.sendToolResult(
          task,
          task.maxRetries > 0 
            ? `Execution failed after ${task.retryCount} retries: ${finalError}`
            : finalError,
          true
        );

        this.monitor.log('error', {
          taskId: task.id,
          parentClawId: task.parentClawId,
          toolName: task.toolName,
          error: finalError,
          retriesExhausted: task.maxRetries > 0,
        });
      }
    } finally {
      // Always move from running to done, even if sendToolResult throws
      await this.moveTaskToDone(task.id);
    }
  }

  /**
   * Send tool task result to parent claw's inbox
   * Large outputs are offloaded to tasks/results/{taskId}.txt
   * Writes directly to inbox/pending/ in .md format (LocalTransport compatible)
   */
  private async sendToolResult(task: ToolTask, result: ToolResult | string, isError: boolean): Promise<void> {
    const fullContent = typeof result === 'string' ? result : result.content;
    
    // Try to write full result to tasks/results/
    let resultRef: string | undefined;
    try {
      const resultPath = `tasks/results/${task.id}.txt`;
      await this.fs.writeAtomic(resultPath, fullContent);
      resultRef = resultPath;
    } catch (writeErr) {
      // Degrade gracefully: resultRef remains undefined, send full content in inbox
      const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: `Failed to write result to file: ${errMsg}`,
      });
    }

    // Build summary based on error status
    const summary = isError
      ? fullContent.slice(0, 500)
      : fullContent.slice(0, 200) + (fullContent.length > 200 ? '…' : '');

    // Prepare message content
    const messageContent = resultRef
      ? JSON.stringify({
          taskId: task.id,
          toolName: task.toolName,
          summary,
          resultRef,
          is_error: isError,
        })
      : JSON.stringify({
          taskId: task.id,
          toolName: task.toolName,
          result: fullContent,
          is_error: isError,
        });

    // Write directly to inbox/pending/ in .md format (bypass transport path issues)
    try {
      const msgId = randomUUID();
      const priority = isError ? 'high' : 'normal';
      const filename = `${Date.now()}_${priority}_${msgId.slice(0, 8)}.md`;
      const fileContent = [
        '---',
        `id: ${msgId}`,
        `type: message`,
        `from: task_system`,
        `to: ${task.parentClawId}`,
        `priority: ${priority}`,
        `timestamp: ${new Date().toISOString()}`,
        '---',
        '',
        messageContent,
      ].join('\n');

      await this.fs.ensureDir('inbox/pending');
      await this.fs.writeAtomic(`inbox/pending/${filename}`, fileContent);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[task] Failed to write inbox message for tool task ${task.id}:`, err);
      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: `Failed to write inbox message: ${errMsg}`,
      });
    }
  }

  /**
   * Send task result to parent claw's inbox
   * Large outputs are offloaded to tasks/results/{taskId}.txt
   * Writes directly to inbox/pending/ in .md format (LocalTransport compatible)
   */
  private async sendResult(task: SubAgentTask, result: string, isError: boolean): Promise<void> {
    // Try to write full result to tasks/results/
    let resultRef: string | undefined;
    try {
      const resultPath = `tasks/results/${task.id}.txt`;
      await this.fs.writeAtomic(resultPath, result);
      resultRef = resultPath;
    } catch (writeErr) {
      // Degrade gracefully: resultRef remains undefined, send full content in inbox
      const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: `Failed to write result to file: ${errMsg}`,
      });
    }

    // Build summary based on error status
    const summary = isError
      ? result.slice(0, 500)
      : result.slice(0, 200) + (result.length > 200 ? '…' : '');

    // Prepare message content
    const messageContent = resultRef
      ? JSON.stringify({
          taskId: task.id,
          summary,
          resultRef,
          is_error: isError,
        })
      : JSON.stringify({
          taskId: task.id,
          result,
          is_error: isError,
        });

    // Write directly to inbox/pending/ in .md format (bypass transport path issues)
    try {
      const msgId = randomUUID();
      const priority = isError ? 'high' : 'normal';
      const filename = `${Date.now()}_${priority}_${msgId.slice(0, 8)}.md`;
      const fileContent = [
        '---',
        `id: ${msgId}`,
        `type: message`,
        `from: subagent`,
        `to: ${task.parentClawId}`,
        `priority: ${priority}`,
        `timestamp: ${new Date().toISOString()}`,
        '---',
        '',
        messageContent,
      ].join('\n');

      await this.fs.ensureDir('inbox/pending');
      await this.fs.writeAtomic(`inbox/pending/${filename}`, fileContent);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[task] Failed to write inbox message for task ${task.id}:`, err);
      this.monitor.log('error', {
        taskId: task.id,
        parentClawId: task.parentClawId,
        error: `Failed to write inbox message: ${errMsg}`,
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
   * List pending task IDs (for testing/monitoring)
   */
  listPending(): string[] {
    return this.pendingQueue.map(task => task.id);
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
      await state.promise;  // Wait for _startTask to complete (includes delete + moveTaskToDone + _dispatch)
    } catch {
      // Expected on abort
    }

    // Note: moveTaskToDone and runningTasks.delete are handled by _startTask.finally
    this.monitor.log('error', { taskId, reason: 'cancelled' });
  }

  /**
   * Shutdown - wait for all tasks to complete or timeout
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    // Signal all running tasks to stop
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
        console.warn('[task] Shutdown timeout, some tasks may not have stopped');
      });
    }

    this.runningTasks.clear();
    this.pendingQueue = [];
    this.pendingCallbacks.clear();
    await this.monitor.close();
  }
}
