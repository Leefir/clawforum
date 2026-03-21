/**
 * ContractManager - Contract lifecycle management
 *
 * Manages contract loading, progress tracking, acceptance, and status transitions.
 */

// TODO(phase3): Implement contract dependency checks - MVP has check_dependencies() method (contract B starts only after contract A completes)

import * as yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fsNative from 'fs';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { IMonitor } from '../../foundation/monitor/types.js';
import type { ILLMService } from '../../foundation/llm/index.js';
import type { Contract, SubTask, ContractStatus, SubtaskStatus } from '../../types/contract.js';
import { ToolError, ToolTimeoutError } from '../../types/errors.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LOCK_MAX_RETRIES, LOCK_RETRY_DELAY_MS, CONTRACT_SCRIPT_TIMEOUT_MS, CONTRACT_LLM_IDLE_TIMEOUT_MS } from '../../constants.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';
import { SubAgent } from '../subagent/agent.js';
import { ToolRegistry } from '../tools/registry.js';

const execFileAsync = promisify(execFile);

// Contract default value constants
const CONTRACT_DEFAULTS = {
  schema_version: 1,
  auth_level: 'auto' as const,
  deliverables: [] as string[],
};

// YAML contract file structure (exported for CLI use)
export interface ContractYaml {
  schema_version?: number;
  id?: string;
  title: string;
  goal: string;
  deliverables?: string[];
  subtasks: Array<{
    id: string;
    description: string;
  }>;
  acceptance?: Array<
    | { subtask_id: string; type: 'script'; script_file?: string }
    | { subtask_id: string; type: 'llm'; prompt_file?: string }
  >;
  auth_level?: 'auto' | 'notify' | 'confirm';
  escalation?: {
    max_retries?: number;  // 默认 3
  };
}

// Progress data structure
export interface ProgressData {
  contract_id: string;
  status: ContractStatus;
  subtasks: Record<string, {
    status: SubtaskStatus;
    completed_at?: string;
    evidence?: string;
    artifacts?: string[];
    retry_count?: number;           // 默认 0，每次验收失败 +1
    last_failed_feedback?: string;  // 截断到 200 字符
  }>;
  started_at?: string;
  checkpoint?: string | null;
}

export interface AcceptanceResult {
  passed: boolean;
  feedback: string;
  allCompleted?: boolean;  // 仅 passed=true 时有意义
  async?: boolean;         // true 时代表验收已提交后台，结果由 inbox 通知
}

export class ContractManager {
  private fs: IFileSystem;
  private clawDir: string;
  private monitor?: IMonitor;
  private llm?: ILLMService;
  private verifierRegistry?: ToolRegistry;
  private activeDir = 'contract/active';
  private pausedDir = 'contract/paused';
  private archiveDir = 'contract/archive';

  constructor(
    clawDir: string,
    fs: IFileSystem,
    monitor?: IMonitor,
    llm?: ILLMService,
    verifierRegistry?: ToolRegistry,
  ) {
    this.clawDir = clawDir;
    this.fs = fs;
    this.monitor = monitor;
    this.llm = llm;
    this.verifierRegistry = verifierRegistry;
  }

  /**
   * Returns the directory prefix where the contract currently resides (active, paused, or archive)
   */
  private async contractDir(contractId: string): Promise<string> {
    if (await this.fs.exists(`${this.activeDir}/${contractId}/progress.json`)) {
      return this.activeDir;
    }
    if (await this.fs.exists(`${this.pausedDir}/${contractId}/progress.json`)) {
      return this.pausedDir;
    }
    if (await this.fs.exists(`${this.archiveDir}/${contractId}/progress.json`)) {
      return this.archiveDir;
    }
    throw new ToolError(`Contract "${contractId}" not found`);
  }

  /**
   * Acquire a file lock (exclusive creation mode)
   * Uses writeAtomic + exists check to simulate exclusive creation
   */
  private async acquireLock(lockPath: string): Promise<void> {
    for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
      try {
        // wx flag = O_EXCL: 文件存在时原子性失败，无 TOCTOU
        const absoluteLockPath = path.join(this.clawDir, lockPath);
        await fsNative.promises.mkdir(path.dirname(absoluteLockPath), { recursive: true });
        await fsNative.promises.writeFile(
          absoluteLockPath,
          JSON.stringify({ pid: process.pid, time: Date.now() }),
          { flag: 'wx' }
        );
        return; // 成功获取锁
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err; // 非竞争错误，向上抛
        // EEXIST = 锁被其他进程持有，等待重试
        if (i < LOCK_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY_MS));
        }
      }
    }
    throw new ToolError(`Failed to acquire lock after ${LOCK_MAX_RETRIES} retries: ${lockPath}`);
  }

  /**
   * Release the file lock
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await this.fs.delete(lockPath);
    } catch (e) {
      // Ignore deletion failure (may have already been cleaned up by another process)
      this.monitor?.log('error', {
        context: 'ContractManager.releaseLock',
        lockPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Lock-protected progress.json update
   */
  private async withProgressLock<T>(contractId: string, fn: () => Promise<T>): Promise<T> {
    const dir = await this.contractDir(contractId);
    const lockPath = `${dir}/${contractId}/progress.lock`;
    await this.acquireLock(lockPath);
    try {
      return await fn();
    } finally {
      await this.releaseLock(lockPath);
    }
  }

  /**
   * Load the currently active contract (returns the most recent contract in the active/ directory)
   */
  async loadActive(): Promise<Contract | null> {
    const exists = await this.fs.exists(this.activeDir);
    if (!exists) return null;

    // Scan the contract/active/ directory — contracts inside are active (do not check the status field)
    const entries = await this.fs.list(this.activeDir, { includeDirs: true });
    
    let latest: { name: string; startedAt: string } | null = null;
    
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      
      const progressPath = `${this.activeDir}/${entry.name}/progress.json`;
      const hasProgress = await this.fs.exists(progressPath);
      if (!hasProgress) continue;

      try {
        const progressData = JSON.parse(await this.fs.read(progressPath)) as ProgressData;
        // Contracts in the active/ directory are active — trust directory location, do not check the status field
        const startedAt = progressData.started_at ?? '';
        if (!latest || startedAt > latest.startedAt) {
          latest = { name: entry.name, startedAt };
        }
      } catch (error) {
        // Distinguish file-not-found (ENOENT, skip normally) from other errors (JSON parse failure, corruption, etc.)
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          console.warn(`[contract] progress.json corrupted: ${entry.name}`, error);
          if (this.monitor) {
            this.monitor.log('error', {
              context: 'ContractManager.loadActive',
              contract: entry.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        continue;
      }
    }

    return latest ? this.loadContract(latest.name) : null;
  }

  /**
   * Load the currently paused contract (returns the most recent contract in the paused/ directory)
   */
  async loadPaused(): Promise<Contract | null> {
    const exists = await this.fs.exists(this.pausedDir);
    if (!exists) return null;

    const entries = await this.fs.list(this.pausedDir, { includeDirs: true });
    let latest: { name: string; startedAt: string } | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const progressPath = `${this.pausedDir}/${entry.name}/progress.json`;
      const hasProgress = await this.fs.exists(progressPath);
      if (!hasProgress) continue;

      try {
        const data = JSON.parse(await this.fs.read(progressPath)) as ProgressData;
        const startedAt = data.started_at ?? '';
        if (!latest || startedAt > latest.startedAt) {
          latest = { name: entry.name, startedAt };
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          console.warn(`[contract] progress.json corrupted: ${entry.name}`, error);
          this.monitor?.log('error', {
            context: 'ContractManager.loadPaused',
            contract: entry.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
    }

    return latest ? this.loadContract(latest.name) : null;
  }

  /**
   * Create a new contract
   */
  async create(contractYaml: ContractYaml): Promise<string> {
    const contractId = contractYaml.id || `${Date.now()}-${randomUUID().slice(0, 8)}`;

    // Archive any existing active contract (prevents conflicts with multiple running contracts)
    const existing = await this.loadActive();
    if (existing && existing.id !== contractId) {
      console.log(`[contract] Archiving existing contract ${existing.id} for new contract ${contractId}`);
      await this.moveToArchive(existing.id);
    }

    await this.fs.ensureDir(`${this.activeDir}/${contractId}`);

    // Write contract.yaml (populate defaults; write id to ensure consistency)
    const content = yaml.dump({
      schema_version: contractYaml.schema_version ?? CONTRACT_DEFAULTS.schema_version,
      id: contractId,
      title: contractYaml.title,
      goal: contractYaml.goal,
      deliverables: contractYaml.deliverables ?? CONTRACT_DEFAULTS.deliverables,
      subtasks: contractYaml.subtasks,
      acceptance: contractYaml.acceptance ?? [],
      auth_level: contractYaml.auth_level ?? CONTRACT_DEFAULTS.auth_level,
    });
    await this.fs.writeAtomic(`${this.activeDir}/${contractId}/contract.yaml`, content);

    // Write initial progress.json
    const progress: ProgressData = {
      contract_id: contractId,
      status: 'running',
      subtasks: Object.fromEntries(
        contractYaml.subtasks.map(st => [st.id, { status: 'todo' as SubtaskStatus }])
      ),
      started_at: new Date().toISOString(),
      checkpoint: null,
    };
    try {
      await this.fs.writeAtomic(
        `${this.activeDir}/${contractId}/progress.json`,
        JSON.stringify(progress, null, 2)
      );
    } catch (err) {
      // 清理孤立的 contract.yaml，避免残留在 active/
      await this.fs.delete(`${this.activeDir}/${contractId}/contract.yaml`).catch(() => {});
      throw err;
    }

    this.monitor?.log('contract_created', { contractId });
    return contractId;
  }

  /**
   * Read the progress of a contract
   */
  async getProgress(contractId: string): Promise<ProgressData> {
    const dir = await this.contractDir(contractId);
    const progressPath = `${dir}/${contractId}/progress.json`;
    const content = await this.fs.read(progressPath);
    return JSON.parse(content) as ProgressData;
  }

  /**
   * Mark a subtask as complete and trigger acceptance
   * 
   * If acceptance is configured, runs asynchronously and returns { async: true }
   * Result will be delivered via inbox message
   */
  async completeSubtask(params: {
    contractId: string;
    subtaskId: string;
    evidence: string;
    artifacts?: string[];
  }): Promise<AcceptanceResult> {
    const { contractId, subtaskId, evidence, artifacts } = params;

    // Load contract YAML to get acceptance configuration
    const contractYaml = await this.loadContractYaml(contractId);
    
    // Run acceptance check
    const acceptanceConfig = contractYaml.acceptance?.find(
      a => a.subtask_id === subtaskId
    );

    // No acceptance criteria configured: pass immediately (sync)
    if (!acceptanceConfig) {
      return this._completeSubtaskSync(contractId, subtaskId, evidence, artifacts);
    }

    // Has acceptance config: verify subtask exists, mark in_progress, then async
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      
      // Verify subtaskId exists
      if (!progress.subtasks[subtaskId]) {
        const validIds = Object.keys(progress.subtasks).join(', ');
        throw new ToolError(`Unknown subtask "${subtaskId}". Valid subtask IDs: ${validIds}`);
      }
      
      // Mark as in_progress during acceptance verification
      progress.subtasks[subtaskId] = {
        ...progress.subtasks[subtaskId], // 保留 retry_count / last_failed_feedback
        status: 'in_progress',
        evidence,
        artifacts,
      };
      
      await this.saveProgress(contractId, progress);
      
      this.monitor?.log('contract_acceptance_started', {
        contractId,
        subtaskId,
      });
    });

    // Start background acceptance (fire-and-forget)
    this._runAcceptanceInBackground(params, contractYaml, acceptanceConfig)
      .catch(err => this._writeAcceptanceError(contractId, subtaskId, err));

    // Return immediately with async flag
    return { passed: false, feedback: '', async: true };
  }

  /**
   * Synchronous completion (no acceptance configured)
   */
  private async _completeSubtaskSync(
    contractId: string,
    subtaskId: string,
    evidence: string,
    artifacts?: string[],
  ): Promise<AcceptanceResult> {
    let allCompleted = false;
    let result: AcceptanceResult = { passed: true, feedback: 'No acceptance criteria configured' };
    const contractYaml = await this.loadContractYaml(contractId);
    
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      
      // Verify subtaskId exists
      if (!progress.subtasks[subtaskId]) {
        const validIds = Object.keys(progress.subtasks).join(', ');
        result = { passed: false, feedback: `Unknown subtask "${subtaskId}". Valid subtask IDs: ${validIds}` };
        this.monitor?.log('error', {
          context: 'ContractManager._completeSubtaskSync',
          contractId,
          subtaskId,
          message: 'Unknown subtaskId',
        });
        return;
      }
      
      progress.subtasks[subtaskId] = {
        ...progress.subtasks[subtaskId],
        status: 'completed',
        completed_at: new Date().toISOString(),
        evidence,
        artifacts,
      };

      // Check whether all subtasks are complete
      allCompleted = await this.checkAllCompleted(contractId, progress);
      if (allCompleted) {
        progress.status = 'completed';
        await this.updateContractStatus(contractId, 'completed');
      }

      await this.saveProgress(contractId, progress);
      
      this.monitor?.log('contract_updated', {
        contractId,
        subtaskId,
        status: allCompleted ? 'completed' : 'running',
      });
    });

    // Archive and notify Motion outside the lock (best-effort)
    if (allCompleted) {
      const title = contractYaml.title;
      try {
        await this.moveToArchive(contractId);
      } catch (err) {
        console.error('[contract] moveToArchive failed:', err);
      }
      this.notifyMotionCompletion(contractId, title);
    }
    
    return { ...result, allCompleted };
  }

  /**
   * Run acceptance verification in background
   */
  private async _runAcceptanceInBackground(
    params: { contractId: string; subtaskId: string; evidence: string; artifacts?: string[] },
    contractYaml: ContractYaml,
    acceptanceConfig: { subtask_id: string; type: 'script'; script_file?: string } | { subtask_id: string; type: 'llm'; prompt_file?: string },
  ): Promise<void> {
    const { contractId, subtaskId, evidence, artifacts = [] } = params;
    
    // Get subtask description from contract YAML
    const subtaskDef = contractYaml.subtasks.find(st => st.id === subtaskId);
    const subtaskDesc = subtaskDef?.description || subtaskId;
    
    // Run acceptance check
    const contractAbsDir = path.join(this.clawDir, await this.contractDir(contractId), contractId);
    let result: AcceptanceResult;
    let structuredResult: { passed: boolean; reason: string; issues?: string[] } | undefined;

    if (acceptanceConfig.type === 'script') {
      const scriptFile = acceptanceConfig.script_file;
      if (!scriptFile) {
        result = { passed: false, feedback: 'acceptance config script 类型缺少 script_file' };
        this.monitor?.log('error', {
          context: 'ContractManager._runAcceptanceInBackground',
          contractId,
          subtaskId,
          message: 'acceptance config missing script_file',
        });
      } else {
        result = await this.runScriptAcceptance(scriptFile, contractAbsDir);
      }
    } else {
      const promptFile = acceptanceConfig.prompt_file;
      if (!promptFile) {
        result = { passed: false, feedback: 'acceptance config llm 类型缺少 prompt_file' };
        this.monitor?.log('error', {
          context: 'ContractManager._runAcceptanceInBackground',
          contractId,
          subtaskId,
          message: 'acceptance config missing prompt_file',
        });
      } else {
        result = await this.runLLMAcceptance(
          promptFile,
          contractAbsDir,
          contractId,
          subtaskId,
          subtaskDesc,
          evidence,
          artifacts,
        );
        // Try to parse structured result from feedback for better formatting
        try {
          const jsonMatch = result.feedback.match(/```json\s*([\s\S]*?)\s*```/) || result.feedback.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            structuredResult = JSON.parse(jsonStr) as { passed: boolean; reason: string; issues?: string[] };
          }
        } catch {
          // Ignore parse errors, use simple feedback
        }
      }
    }

    // Handle acceptance result
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      const subtask = progress.subtasks[subtaskId];
      
      if (!subtask) {
        this.monitor?.log('error', {
          context: 'ContractManager._runAcceptanceInBackground',
          contractId,
          subtaskId,
          error: 'subtask missing from progress after in_progress mark',
        });
        return;
      }
      
      if (result.passed) {
        // Mark completed
        subtask.status = 'completed';
        subtask.completed_at = new Date().toISOString();
        
        // Check all completed
        const allCompleted = await this.checkAllCompleted(contractId, progress);
        if (allCompleted) {
          progress.status = 'completed';
          await this.updateContractStatus(contractId, 'completed');
        }
        
        await this.saveProgress(contractId, progress);
        
        // Write inbox notification to claw
        await this._writeAcceptanceInbox(contractId, subtaskId, 'passed', allCompleted);
        
        // Notify Motion if all completed
        if (allCompleted) {
          try {
            await this.moveToArchive(contractId);
          } catch (err) {
            console.error('[contract] moveToArchive failed:', err);
          }
          this.notifyMotionCompletion(contractId, contractYaml.title);
        }
      } else {
        // Rejected - track retry count and feedback
        subtask.retry_count = (subtask.retry_count || 0) + 1;
        subtask.last_failed_feedback = result.feedback.slice(0, 200);
        
        // Reset to todo for retry
        subtask.status = 'todo';
        
        await this.saveProgress(contractId, progress);
        
        // Format rejection feedback
        const maxRetries = contractYaml.escalation?.max_retries ?? 3;
        const acceptanceFile = acceptanceConfig.type === 'script' 
          ? acceptanceConfig.script_file ?? 'unknown'
          : acceptanceConfig.prompt_file ?? 'unknown';
        const formattedFeedback = structuredResult
          ? this.formatRejectionFeedback(
              subtaskId,
              subtaskDesc,
              structuredResult.reason,
              structuredResult.issues || [],
              subtask.retry_count,
              maxRetries,
              acceptanceConfig.type,
              acceptanceFile,
            )
          : result.feedback;
        
        // Write inbox rejection notification
        await this._writeAcceptanceInbox(contractId, subtaskId, 'rejected', false, formattedFeedback, subtask.retry_count);
        
        // Escalate if too many retries
        if (subtask.retry_count >= maxRetries) {
          this.notifyMotionEscalation(contractId, subtaskId, result.feedback, subtask.retry_count);
        }
      }
    });
  }

  /**
   * Write acceptance result to claw inbox
   */
  private async _writeAcceptanceInbox(
    contractId: string,
    subtaskId: string,
    verdict: 'passed' | 'rejected',
    allCompleted: boolean,
    feedback?: string,
    retryCount?: number,
  ): Promise<void> {
    const msgId = randomUUID();
    const now = new Date();
    const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
    const uuid8 = msgId.slice(0, 8);
    const filename = `${ts}_${verdict === 'rejected' ? 'high' : 'normal'}_${uuid8}.md`;
    
    const extraFields: Record<string, string> = {
      contract_id: contractId,
      subtask_id: subtaskId,
      verdict,
    };
    if (retryCount !== undefined) extraFields.retry_count = String(retryCount);
    
    let body: string;
    if (verdict === 'passed') {
      body = allCompleted 
        ? `Subtask ${subtaskId} accepted. All subtasks complete!`
        : `Subtask ${subtaskId} accepted.`;
    } else {
      body = feedback || 'No feedback provided';
    }
    
    const content = [
      '---',
      `id: ${ts}-${uuid8}`,
      `type: ${verdict === 'passed' ? 'acceptance_result' : 'acceptance_rejection'}`,
      `from: contract_system`,
      `to: claw`,
      `priority: ${verdict === 'rejected' ? 'high' : 'normal'}`,
      `timestamp: ${now.toISOString()}`,
      ...Object.entries(extraFields).map(([k, v]) => `${k}: ${v}`),
      '---',
      '',
      body,
    ].join('\n');
    
    await this.fs.ensureDir('inbox/pending');
    await this.fs.writeAtomic(`inbox/pending/${filename}`, content);
  }

  /**
   * Write acceptance error to claw inbox (best-effort)
   */
  private async _writeAcceptanceError(contractId: string, subtaskId: string, error: unknown): Promise<void> {
    try {
      const msgId = randomUUID();
      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = msgId.slice(0, 8);
      const filename = `${ts}_high_${uuid8}.md`;
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      const content = [
        '---',
        `id: ${ts}-${uuid8}`,
        `type: acceptance_error`,
        `from: contract_system`,
        `to: claw`,
        `priority: high`,
        `timestamp: ${now.toISOString()}`,
        `contract_id: ${contractId}`,
        `subtask_id: ${subtaskId}`,
        '---',
        '',
        `Acceptance verification failed with error: ${errorMsg.slice(0, 500)}`,
      ].join('\n');
      
      await this.fs.ensureDir('inbox/pending');
      await this.fs.writeAtomic(`inbox/pending/${filename}`, content);
    } catch (e) {
      // Best-effort: log but don't throw
      console.error('[contract] Failed to write acceptance error to inbox:', e);
      this.monitor?.log('error', {
        context: 'ContractManager._writeAcceptanceError',
        contractId,
        subtaskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Format rejection feedback for claw with structured information
   */
  private formatRejectionFeedback(
    subtaskId: string,
    subtaskDesc: string,
    reason: string,
    issues: string[],
    retryCount: number,
    maxRetries: number,
    acceptanceType: string,
    acceptanceFile: string,
  ): string {
    const issuesList = issues.length > 0
      ? issues.map(i => `- ${i}`).join('\n')
      : '- (未提供具体问题)';

    return [
      `## 验收失败 — ${subtaskId}`,
      '',
      `**子任务：** ${subtaskDesc}`,
      '',
      '**失败原因：**',
      reason,
      '',
      '**需要修正的问题：**',
      issuesList,
      '',
      `**验收标准：** ${acceptanceType} (${acceptanceFile})`,
      '',
      `已失败 ${retryCount}/${maxRetries} 次。`,
    ].join('\n');
  }

  /**
   * Notify Motion of subtask escalation (too many retries)
   */
  private notifyMotionEscalation(
    contractId: string,
    subtaskId: string,
    lastFeedback: string,
    retryCount: number,
  ): void {
    try {
      const clawId = path.basename(this.clawDir);
      const motionInbox = path.resolve(this.clawDir, '..', '..', 'motion', 'inbox', 'pending');

      writeInboxMessage({
        inboxDir: motionInbox,
        type: 'contract_escalation',
        source: clawId,
        priority: 'high',
        extraFields: {
          contract_id: contractId,
          subtask_id: subtaskId,
          retry_count: String(retryCount),
        },
        body: `Subtask "${subtaskId}" has failed ${retryCount} times.\n\nLast feedback:\n${lastFeedback}`,
      });
    } catch (e) {
      this.monitor?.log('error', {
        context: 'ContractManager.notifyMotionEscalation',
        contractId,
        subtaskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Notify Motion of LLM acceptance timeout
   */
  private notifyMotionAcceptanceTimeout(contractId: string, subtaskId: string): void {
    try {
      const clawId = path.basename(this.clawDir);
      const motionInbox = path.resolve(this.clawDir, '..', '..', 'motion', 'inbox', 'pending');

      writeInboxMessage({
        inboxDir: motionInbox,
        type: 'acceptance_timeout',
        source: clawId,
        priority: 'high',
        extraFields: { contract_id: contractId, subtask_id: subtaskId },
        body: `LLM acceptance verifier timed out for subtask "${subtaskId}".`,
      });
    } catch (e) {
      this.monitor?.log('error', {
        context: 'ContractManager.notifyMotionAcceptanceTimeout',
        contractId,
        subtaskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Pause a contract (move from active/ to paused/)
   */
  async pause(contractId: string, checkpointNote: string): Promise<void> {
    const dir = await this.contractDir(contractId);
    if (dir !== this.activeDir) {
      throw new ToolError(`Cannot pause contract "${contractId}": not in active/`);
    }
    // Update progress inside the lock
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      progress.status = 'paused';
      progress.checkpoint = checkpointNote;
      await this.saveProgress(contractId, progress);
    });
    // Move directory to reflect the new status
    await this.fs.ensureDir(this.pausedDir);
    await this.fs.move(
      `${this.activeDir}/${contractId}`,
      `${this.pausedDir}/${contractId}`
    );
    this.monitor?.log('contract_updated', { contractId, status: 'paused', checkpoint: checkpointNote });
  }

  /**
   * Resume a contract (move from paused/ to active/)
   */
  async resume(contractId: string): Promise<Contract> {
    const dir = await this.contractDir(contractId);
    if (dir !== this.pausedDir) {
      throw new ToolError(`Cannot resume contract "${contractId}": not in paused/`);
    }
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      progress.status = 'running';
      progress.checkpoint = null;
      await this.saveProgress(contractId, progress);
    });
    await this.fs.move(
      `${this.pausedDir}/${contractId}`,
      `${this.activeDir}/${contractId}`
    );
    this.monitor?.log('contract_updated', { contractId, status: 'running' });
    return this.loadContract(contractId);
  }

  /**
   * Cancel a contract (move from active/ or paused/ to archive/)
   */
  async cancel(contractId: string, reason: string): Promise<void> {
    const dir = await this.contractDir(contractId);
    if (dir === this.archiveDir) {
      throw new ToolError(`Cannot cancel contract "${contractId}": already archived`);
    }
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      progress.status = 'cancelled';
      progress.checkpoint = `cancelled: ${reason}`;
      await this.saveProgress(contractId, progress);
    });
    await this.fs.ensureDir(this.archiveDir);
    await this.fs.move(`${dir}/${contractId}`, `${this.archiveDir}/${contractId}`);
    this.monitor?.log('contract_updated', { contractId, status: 'cancelled', reason });
  }

  /**
   * Move a contract from active/ or paused/ to archive/
   */
  private async moveToArchive(contractId: string): Promise<void> {
    const dir = await this.contractDir(contractId);
    if (dir === this.archiveDir) return; // Already in archive
    const dst = `${this.archiveDir}/${contractId}`;
    await this.fs.ensureDir(this.archiveDir);
    await this.fs.move(`${dir}/${contractId}`, dst);
  }

  /**
   * Check whether all subtasks are complete
   */
  async isComplete(contractId: string): Promise<boolean> {
    const progress = await this.getProgress(contractId);
    return this.checkAllCompleted(contractId, progress);
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async loadContractYaml(contractId: string): Promise<ContractYaml> {
    const dir = await this.contractDir(contractId);
    const contractPath = `${dir}/${contractId}/contract.yaml`;
    const content = await this.fs.read(contractPath);
    return yaml.load(content) as ContractYaml;
  }

  private async loadContract(contractId: string): Promise<Contract> {
    const yamlContract = await this.loadContractYaml(contractId);
    const progress = await this.getProgress(contractId);

    // Convert YAML format to the Contract interface (using unified defaults)
    return {
      id: yamlContract.id ?? contractId,
      title: yamlContract.title,
      description: yamlContract.goal,
      status: progress.status,
      priority: 'normal',
      creator: 'system',
      goal: yamlContract.goal,
      deliverables: yamlContract.deliverables ?? CONTRACT_DEFAULTS.deliverables,
      subtasks: yamlContract.subtasks.map(st => ({
        id: st.id,
        description: st.description,
        status: progress.subtasks[st.id]?.status || 'todo',
        created_at: progress.started_at || new Date().toISOString(),
        updated_at: progress.subtasks[st.id]?.completed_at || new Date().toISOString(),
      })),
      auth_level: yamlContract.auth_level ?? CONTRACT_DEFAULTS.auth_level,
      created_at: progress.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async saveProgress(contractId: string, progress: ProgressData): Promise<void> {
    const dir = await this.contractDir(contractId);
    const progressPath = `${dir}/${contractId}/progress.json`;
    await this.fs.writeAtomic(progressPath, JSON.stringify(progress, null, 2));
  }

  private async updateContractStatus(contractId: string, status: ContractStatus): Promise<void> {
    // In Phase 1, the contract YAML is read-only; status changes are recorded in progress.json
    // In a real project, you may need to update the status field in the contract file itself
    this.monitor?.log(status === 'completed' ? 'contract_completed' : 'contract_updated', {
      contractId,
      status,
    });
  }

  private async checkAllCompleted(contractId: string, progress: ProgressData): Promise<boolean> {
    const contractYaml = await this.loadContractYaml(contractId);
    return contractYaml.subtasks.every(st => 
      progress.subtasks[st.id]?.status === 'completed'
    );
  }

  private async runScriptAcceptance(
    scriptFile: string,
    contractAbsDir: string,
  ): Promise<AcceptanceResult> {
    // 路径安全：script_file 必须在契约目录内
    const resolved = path.resolve(contractAbsDir, scriptFile);
    if (!resolved.startsWith(contractAbsDir + path.sep)) {
      return { passed: false, feedback: `路径安全拒绝: script_file 必须在契约目录内` };
    }

    console.log(`[contract] Running acceptance script: ${scriptFile} (cwd: ${contractAbsDir})`);
    
    try {
      await execFileAsync('sh', [resolved], {
        cwd: contractAbsDir,
        timeout: CONTRACT_SCRIPT_TIMEOUT_MS,
        encoding: 'utf-8',
      });
      return { passed: true, feedback: 'Script acceptance passed' };
    } catch (err: any) {
      const stderr = err?.stderr ?? err?.message ?? String(err);
      const isTimeout = err?.killed === true;
      const prefix = isTimeout ? '验收脚本超时' : '验收失败';
      return { passed: false, feedback: `${prefix}:\n${stderr}` };
    }
  }

  /**
   * Run LLM acceptance verification using SubAgent
   */
  private async runLLMAcceptance(
    promptFile: string,
    contractAbsDir: string,
    contractId: string,
    subtaskId: string,
    subtaskDesc: string,
    evidence: string,
    artifacts: string[],
  ): Promise<AcceptanceResult> {
    // LLM not injected
    if (!this.llm) {
      return { passed: false, feedback: 'LLM 验收未配置（llm 未注入）' };
    }

    // Path security check
    const resolved = path.resolve(contractAbsDir, promptFile);
    if (!resolved.startsWith(contractAbsDir + path.sep)) {
      return { passed: false, feedback: '路径安全拒绝: prompt_file 必须在契约目录内' };
    }

    try {
      // Read prompt template
      const relativePath = path.relative(this.clawDir, resolved);
      if (relativePath.startsWith('..')) {
        return { passed: false, feedback: '路径安全拒绝: prompt_file 解析后逃出 claw 目录' };
      }
      const promptTemplate = await this.fs.read(relativePath);

      // Inject variables
      const filledPrompt = promptTemplate
        .replace(/\{\{evidence\}\}/g, evidence)
        .replace(/\{\{artifacts\}\}/g, artifacts.join(', '))
        .replace(/\{\{subtask_description\}\}/g, subtaskDesc);

      // Create SubAgent for verification
      const agent = new SubAgent({
        agentId: `verifier-${contractId}-${subtaskId}`,
        prompt: filledPrompt,
        clawDir: this.clawDir,
        llm: this.llm,
        registry: this.verifierRegistry || new ToolRegistry(),
        fs: this.fs as any,
        idleTimeoutMs: CONTRACT_LLM_IDLE_TIMEOUT_MS,
        onIdleTimeout: () => this.notifyMotionAcceptanceTimeout(contractId, subtaskId),
      });

      // Run verification
      const text = await agent.run();

      // Extract JSON from response (supports ```json ... ``` wrapping)
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { passed: false, feedback: `LLM 返回格式错误: 无法解析 JSON\n${text.slice(0, 500)}` };
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const result = JSON.parse(jsonStr) as { passed: boolean; reason: string; issues?: string[] };

      return {
        passed: result.passed,
        feedback: jsonStr, // 返回完整 JSON，供上层解析 structuredResult
      };
    } catch (err) {
      if (err instanceof ToolTimeoutError) {
        return { passed: false, feedback: '验收子代理超时' };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { passed: false, feedback: `LLM 验收失败: ${msg}` };
    }
  }

  /**
   * Notify Motion of contract completion (best-effort)
   */
  private notifyMotionCompletion(contractId: string, contractTitle: string): void {
    try {
      const clawId = path.basename(this.clawDir);
      const motionInbox = path.resolve(this.clawDir, '..', '..', 'motion', 'inbox', 'pending');

      writeInboxMessage({
        inboxDir: motionInbox,
        type: 'review_request',
        source: clawId,
        priority: 'low',
        extraFields: { claw_id: clawId, contract_id: contractId },
        body: `Contract "${contractTitle}" has completed. Please perform a retrospective analysis.`,
      });
    } catch (e) {
      this.monitor?.log('error', {
        context: 'ContractManager.notifyMotionCompletion',
        contractId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
