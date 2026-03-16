/**
 * ContractManager - 契约生命周期管理
 * 
 * 管理契约的加载、进度追踪、验收和状态转换。
 */

// TODO(phase3): 实现契约依赖检查 - MVP 有 check_dependencies() 方法（契约 A 完成后才启动 B）

import * as yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { IMonitor } from '../../foundation/monitor/types.js';
import type { Contract, SubTask, ContractStatus } from '../../types/contract.js';
import { ToolError } from '../../types/errors.js';
import { execSync } from 'child_process';

// 契约默认值常量
const CONTRACT_DEFAULTS = {
  schema_version: 1,
  auth_level: 'auto' as const,
  deliverables: [] as string[],
};

// YAML 契约文件结构（导出供 CLI 使用）
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

// 进度数据结构
export interface ProgressData {
  contract_id: string;
  status: ContractStatus;
  subtasks: Record<string, {
    status: ContractStatus;
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
}

export class ContractManager {
  private fs: IFileSystem;
  private clawDir: string;
  private monitor?: IMonitor;
  private lockRetries = 3;
  private lockDelay = 100; // ms

  constructor(clawDir: string, fs: IFileSystem, monitor?: IMonitor) {
    this.clawDir = clawDir;
    this.fs = fs;
    this.monitor = monitor;
  }

  /**
   * 获取文件锁（排他创建模式）
   * 使用 writeAtomic + exists 检查模拟排他创建
   */
  private async acquireLock(lockPath: string): Promise<void> {
    for (let i = 0; i < this.lockRetries; i++) {
      try {
        // 检查锁是否已存在
        const exists = await this.fs.exists(lockPath);
        if (exists) {
          throw new Error('Lock exists');
        }
        // 尝试创建锁文件（原子写入）
        await this.fs.writeAtomic(lockPath, JSON.stringify({ pid: process.pid, time: Date.now() }));
        return; // 成功获取锁
      } catch {
        // 锁已存在或竞争失败，等待后重试
        if (i < this.lockRetries - 1) {
          await new Promise(r => setTimeout(r, this.lockDelay));
        }
      }
    }
    throw new ToolError(`Failed to acquire lock after ${this.lockRetries} retries: ${lockPath}`);
  }

  /**
   * 释放文件锁
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await this.fs.delete(lockPath);
    } catch {
      // 忽略删除失败（可能已被其他进程清理）
    }
  }

  /**
   * 带锁保护的 progress.json 更新
   */
  private async withProgressLock<T>(contractId: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = `contract/${contractId}/progress.lock`;
    await this.acquireLock(lockPath);
    try {
      return await fn();
    } finally {
      await this.releaseLock(lockPath);
    }
  }

  /**
   * 加载当前活跃契约（返回最新的 running/paused 契约）
   */
  async loadActive(): Promise<Contract | null> {
    const contractDir = 'contract';
    const exists = await this.fs.exists(contractDir);
    if (!exists) return null;

    // 扫描 contract/ 目录找 running 状态的契约，按 started_at 排序取最新
    const entries = await this.fs.list(contractDir, { includeDirs: true });
    
    let latest: { name: string; startedAt: string } | null = null;
    
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      
      const progressPath = `${contractDir}/${entry.name}/progress.json`;
      const hasProgress = await this.fs.exists(progressPath);
      if (!hasProgress) continue;

      try {
        const progressData = JSON.parse(await this.fs.read(progressPath)) as ProgressData;
        if (progressData.status === 'running' || progressData.status === 'paused') {
          // 比较 started_at，取最新的
          const startedAt = progressData.started_at ?? '';
          if (!latest || startedAt > latest.startedAt) {
            latest = { name: entry.name, startedAt };
          }
        }
      } catch (error) {
        // 区分文件不存在（ENOENT，正常跳过）vs 其他错误（JSON 解析失败、损坏等）
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
   * 创建新契约
   */
  async create(contractYaml: ContractYaml): Promise<string> {
    const contractId = contractYaml.id || `${Date.now()}-${randomUUID().slice(0, 8)}`;

    // 关闭已有的 running 契约（避免多个 running 契约冲突）
    const existing = await this.loadActive();
    if (existing && existing.id !== contractId) {
      console.log(`[contract] Pausing existing contract ${existing.id} for new contract ${contractId}`);
      await this.pause(existing.id, 'Superseded by new contract');
    }

    await this.fs.ensureDir(`contract/${contractId}`);

    // 写 contract.yaml（填充默认值，id 写入确保一致）
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
    await this.fs.writeAtomic(`contract/${contractId}/contract.yaml`, content);

    // 写初始 progress.json
    const progress: ProgressData = {
      contract_id: contractId,
      status: 'running',
      subtasks: Object.fromEntries(
        contractYaml.subtasks.map(st => [st.id, { status: 'pending' }])
      ),
      started_at: new Date().toISOString(),
      checkpoint: null,
    };
    await this.fs.writeAtomic(
      `contract/${contractId}/progress.json`,
      JSON.stringify(progress, null, 2)
    );

    this.monitor?.log('contract_created', { contractId });
    return contractId;
  }

  /**
   * 读取契约的进度
   */
  async getProgress(contractId: string): Promise<ProgressData> {
    const progressPath = `contract/${contractId}/progress.json`;
    const exists = await this.fs.exists(progressPath);
    if (!exists) {
      throw new ToolError(`Contract "${contractId}" progress not found`);
    }

    try {
      return JSON.parse(await this.fs.read(progressPath)) as ProgressData;
    } catch (err) {
      throw new ToolError(`Failed to parse progress for "${contractId}": ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 标记子任务完成，触发验收
   */
  async completeSubtask(params: {
    contractId: string;
    subtaskId: string;
    evidence: string;
    artifacts?: string[];
  }): Promise<AcceptanceResult> {
    const { contractId, subtaskId, evidence, artifacts } = params;

    // 加载契约 YAML 获取验收配置
    const contractYaml = await this.loadContractYaml(contractId);
    
    // 执行验收
    const acceptanceConfig = contractYaml.acceptance?.find(
      a => a.subtask_id === subtaskId
    );

    let result: AcceptanceResult;
    if (!acceptanceConfig) {
      // 无验收配置，直接通过
      result = { passed: true, feedback: 'No acceptance criteria configured' };
    } else if (acceptanceConfig.type === 'script') {
      result = await this.runScriptAcceptance(acceptanceConfig.command || '');
    } else {
      // llm 类型 - Phase 2 实现
      result = { passed: true, feedback: 'LLM acceptance not implemented in Phase 1' };
    }

    if (result.passed) {
      // 使用文件锁保护 read-modify-write
      await this.withProgressLock(contractId, async () => {
        // 重新读取进度（在锁内获取最新状态）
        const progress = await this.getProgress(contractId);
        
        // 检查 subtaskId 是否存在
        if (!progress.subtasks[subtaskId]) {
          const validIds = Object.keys(progress.subtasks).join(', ');
          result = {
            passed: false,
            feedback: `Unknown subtask "${subtaskId}". Valid subtask IDs: ${validIds}`,
          };
          return;
        }
        
        progress.subtasks[subtaskId] = {
          status: 'completed',
          completed_at: new Date().toISOString(),
          evidence,
          artifacts,
        };

        // 检查所有子任务是否完成
        const allCompleted = await this.checkAllCompleted(contractId, progress);
        if (allCompleted) {
          progress.status = 'completed';
          // 更新契约状态
          await this.updateContractStatus(contractId, 'completed');
        }

        await this.saveProgress(contractId, progress);
        
        this.monitor?.log('contract_updated', {
          contractId,
          subtaskId,
          status: allCompleted ? 'completed' : 'running',
        });
      });
    }

    return result;
  }

  /**
   * 暂停契约
   */
  async pause(contractId: string, checkpointNote: string): Promise<void> {
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      if (progress.status !== 'running') {
        throw new ToolError(`Cannot pause contract "${contractId}": current status is "${progress.status}" (expected "running")`);
      }
      progress.status = 'paused';
      progress.checkpoint = checkpointNote;
      await this.saveProgress(contractId, progress);

      this.monitor?.log('contract_updated', {
        contractId,
        status: 'paused',
        checkpoint: checkpointNote,
      });
    });
  }

  /**
   * 恢复契约
   */
  async resume(contractId: string): Promise<Contract> {
    return await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      if (progress.status !== 'paused') {
        throw new ToolError(`Cannot resume contract "${contractId}": current status is "${progress.status}" (expected "paused")`);
      }
      progress.status = 'running';
      progress.checkpoint = null;
      await this.saveProgress(contractId, progress);

      this.monitor?.log('contract_updated', {
        contractId,
        status: 'running',
      });

      return this.loadContract(contractId);
    });
  }

  /**
   * 取消契约
   */
  async cancel(contractId: string, reason: string): Promise<void> {
    await this.withProgressLock(contractId, async () => {
      const progress = await this.getProgress(contractId);
      if (progress.status === 'completed' || progress.status === 'cancelled') {
        throw new ToolError(`Cannot cancel contract "${contractId}": already in terminal status "${progress.status}"`);
      }
      progress.status = 'cancelled';
      progress.checkpoint = `cancelled: ${reason}`;
      await this.saveProgress(contractId, progress);

      this.monitor?.log('contract_updated', {
        contractId,
        status: 'cancelled',
        reason,
      });
    });
  }

  /**
   * 检查所有子任务是否完成
   */
  async isComplete(contractId: string): Promise<boolean> {
    const progress = await this.getProgress(contractId);
    return this.checkAllCompleted(contractId, progress);
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async loadContractYaml(contractId: string): Promise<ContractYaml> {
    const contractPath = `contract/${contractId}/contract.yaml`;
    const exists = await this.fs.exists(contractPath);
    if (!exists) {
      throw new ToolError(`Contract "${contractId}" not found`);
    }

    const content = await this.fs.read(contractPath);
    return yaml.load(content) as ContractYaml;
  }

  private async loadContract(contractId: string): Promise<Contract> {
    const yamlContract = await this.loadContractYaml(contractId);
    const progress = await this.getProgress(contractId);

    // 将 YAML 格式转换为 Contract 接口（使用统一默认值）
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
        status: progress.subtasks[st.id]?.status || 'pending',
        created_at: progress.started_at || new Date().toISOString(),
        updated_at: progress.subtasks[st.id]?.completed_at || new Date().toISOString(),
      })),
      auth_level: yamlContract.auth_level ?? CONTRACT_DEFAULTS.auth_level,
      created_at: progress.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async saveProgress(contractId: string, progress: ProgressData): Promise<void> {
    const progressPath = `contract/${contractId}/progress.json`;
    await this.fs.writeAtomic(progressPath, JSON.stringify(progress, null, 2));
  }

  private async updateContractStatus(contractId: string, status: ContractStatus): Promise<void> {
    // 在 Phase 1，契约 YAML 是只读的，状态变化记录在 progress.json 中
    // 实际项目中可能需要更新契约文件本身的 status 字段
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
    console.log(`[contract] Running acceptance script: ${command.slice(0, 100)}`);
    
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
        killSignal: 'SIGKILL',
        cwd: this.clawDir,
      });
      return { passed: true, feedback: output };
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      return { passed: false, feedback: stderr };
    }
  }
}
