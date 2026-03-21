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
import type { Contract, SubTask, ContractStatus, SubtaskStatus } from '../../types/contract.js';
import { ToolError } from '../../types/errors.js';
import { execSync } from 'child_process';
import { LOCK_MAX_RETRIES, LOCK_RETRY_DELAY_MS } from '../../constants.js';

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
  acceptance?: Array<{
    subtask_id: string;
    type: 'script' | 'llm';
    command?: string;
  }>;
  auth_level?: 'auto' | 'notify' | 'confirm';
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
  private activeDir = 'contract/active';
  private pausedDir = 'contract/paused';
  private archiveDir = 'contract/archive';

  constructor(clawDir: string, fs: IFileSystem, monitor?: IMonitor) {
    this.clawDir = clawDir;
    this.fs = fs;
    this.monitor = monitor;
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
    } catch {
      // Ignore deletion failure (may have already been cleaned up by another process)
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
      } catch (err) {
        console.warn(`[contract] Failed to parse progress for ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
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
    await this.fs.writeAtomic(
      `${this.activeDir}/${contractId}/progress.json`,
      JSON.stringify(progress, null, 2)
    );

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
    const contractYaml = await this.loadContractYaml(contractId);
    
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      
      // Verify subtaskId exists
      if (!progress.subtasks[subtaskId]) {
        const validIds = Object.keys(progress.subtasks).join(', ');
        throw new ToolError(`Unknown subtask "${subtaskId}". Valid subtask IDs: ${validIds}`);
      }
      
      progress.subtasks[subtaskId] = {
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
    
    return { passed: true, feedback: 'No acceptance criteria configured', allCompleted };
  }

  /**
   * Run acceptance verification in background
   */
  private async _runAcceptanceInBackground(
    params: { contractId: string; subtaskId: string; evidence: string; artifacts?: string[] },
    contractYaml: ContractYaml,
    acceptanceConfig: { subtask_id: string; type: 'script' | 'llm'; command?: string },
  ): Promise<void> {
    const { contractId, subtaskId, evidence, artifacts } = params;
    
    // Run acceptance check
    let result: AcceptanceResult;
    if (acceptanceConfig.type === 'script') {
      result = await this.runScriptAcceptance(acceptanceConfig.command || '');
    } else {
      // llm type - implemented in Phase 2
      result = { passed: true, feedback: 'LLM acceptance not implemented in Phase 1' };
    }

    // Handle acceptance result
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      const subtask = progress.subtasks[subtaskId];
      
      if (!subtask) return; // Should not happen
      
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
        // Rejected - track retry count
        const retryCount = (subtask as any).retry_count || 0;
        (subtask as any).retry_count = retryCount + 1;
        
        // Reset to todo for retry
        subtask.status = 'todo';
        
        await this.saveProgress(contractId, progress);
        
        // Write inbox rejection notification
        await this._writeAcceptanceInbox(contractId, subtaskId, 'rejected', false, result.feedback, retryCount + 1);
        
        // Escalate if too many retries
        if (retryCount + 1 >= 3) {
          this.notifyMotionEscalation(contractId, subtaskId, result.feedback);
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
      body = this.formatRejectionFeedback(feedback || 'No feedback provided');
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
    }
  }

  /**
   * Format rejection feedback for claw
   */
  private formatRejectionFeedback(feedback: string): string {
    return [
      'Acceptance Rejected',
      '==================',
      '',
      feedback,
      '',
      'Please review the feedback and resubmit when ready.',
    ].join('\n');
  }

  /**
   * Notify Motion of subtask escalation (too many retries)
   */
  private notifyMotionEscalation(contractId: string, subtaskId: string, feedback: string): void {
    try {
      const clawId = path.basename(this.clawDir);
      const motionInbox = path.resolve(this.clawDir, '..', '..', 'motion', 'inbox', 'pending');
      fsNative.mkdirSync(motionInbox, { recursive: true });

      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = randomUUID().slice(0, 8);
      const filename = `${ts}_escalation_${uuid8}.md`;

      const content = `---
id: ${ts}-${clawId}-${uuid8}
type: escalation
from: ${clawId}
to: motion
priority: high
timestamp: ${now.toISOString()}
contract_id: ${contractId}
subtask_id: ${subtaskId}
---

Subtask ${subtaskId} has been rejected 3+ times and requires escalation.

Feedback:
${feedback}
`;

      fsNative.writeFileSync(path.join(motionInbox, filename), content);
      console.log(`[contract] Escalation notification written to ${filename}`);
    } catch (err) {
      console.error('[contract] Failed to write escalation notification:', err);
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

  private async runScriptAcceptance(command: string): Promise<AcceptanceResult> {
    // Phase 1: Command comes from contract YAML created by Motion (trusted)
    // Phase 2+: Consider adding command whitelist for untrusted contracts
    console.log(`[contract] Running acceptance script: ${command.slice(0, 100)} (cwd: ${this.clawDir})`);
    
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
        killSignal: 'SIGKILL',
        cwd: this.clawDir,
      });
      return { passed: true, feedback: output };
    } catch (error: any) {
      // 区分：超时、权限错误 vs 脚本正常退出非零
      const isTimeout = error?.killed === true || error?.signal === 'SIGKILL';
      const isPermission = error?.code === 'EACCES';
      const prefix = isTimeout
        ? 'Acceptance script timed out'
        : isPermission
        ? 'Acceptance script permission denied'
        : 'Acceptance failed';
      const stderr = error instanceof Error ? error.message : String(error);
      return { passed: false, feedback: `${prefix} (cwd: ${this.clawDir}):\n${stderr}` };
    }
  }

  /**
   * Notify Motion of contract completion (best-effort)
   * MVP alignment: _write_motion_review_request
   */
  private notifyMotionCompletion(contractId: string, contractTitle: string): void {
    try {
      // clawDir = ~/.clawforum/claws/{clawId}
      // Motion inbox = ~/.clawforum/motion/inbox/pending/
      const clawId = path.basename(this.clawDir);
      const motionInbox = path.resolve(this.clawDir, '..', '..', 'motion', 'inbox', 'pending');

      fsNative.mkdirSync(motionInbox, { recursive: true });

      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = randomUUID().slice(0, 8);
      const filename = `${ts}_review_${uuid8}.md`;

      const content = `---
id: ${ts}-${clawId}-${uuid8}
type: review_request
source: ${clawId}
priority: low
timestamp: ${now.toISOString()}
claw_id: ${clawId}
contract_id: ${contractId}
---

Contract "${contractTitle}" has completed. Please perform a retrospective analysis for claw ${clawId}.
`;
      fsNative.writeFileSync(path.join(motionInbox, filename), content);
    } catch (err) {
      console.warn(`[contract] Failed to notify motion of completion (${contractId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
