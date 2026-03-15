/**
 * ContractManager - 契约生命周期管理
 * 
 * 管理契约的加载、进度追踪、验收和状态转换。
 */

import * as yaml from 'js-yaml';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { IMonitor } from '../../foundation/monitor/types.js';
import type { Contract, SubTask, ContractStatus } from '../../types/contract.js';
import { ToolError } from '../../types/errors.js';
import { execSync } from 'child_process';

// YAML 契约文件结构
interface ContractYaml {
  schema_version: number;
  id: string;
  title: string;
  goal: string;
  deliverables: string[];
  subtasks: Array<{
    id: string;
    description: string;
  }>;
  acceptance?: Array<{
    subtask_id: string;
    type: 'script' | 'llm';
    command?: string;
  }>;
  auth_level: 'auto' | 'notify' | 'confirm';
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

  constructor(clawDir: string, fs: IFileSystem, monitor?: IMonitor) {
    this.clawDir = clawDir;
    this.fs = fs;
    this.monitor = monitor;
  }

  /**
   * 加载当前活跃契约
   */
  async loadActive(): Promise<Contract | null> {
    const contractDir = 'contract';
    const exists = await this.fs.exists(contractDir);
    if (!exists) return null;

    // 扫描 contract/ 目录找 running 状态的契约
    const entries = await this.fs.list(contractDir, { includeDirs: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      
      const progressPath = `${contractDir}/${entry.name}/progress.json`;
      const hasProgress = await this.fs.exists(progressPath);
      if (!hasProgress) continue;

      try {
        const progressData = JSON.parse(await this.fs.read(progressPath)) as ProgressData;
        if (progressData.status === 'running' || progressData.status === 'paused') {
          // 找到活跃契约（running 或 paused），加载完整契约
          return this.loadContract(entry.name);
        }
      } catch (error) {
        // 区分文件不存在（ENOENT，正常跳过）vs 其他错误（JSON 解析失败、损坏等）
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && this.monitor) {
          this.monitor.log('error', {
            context: 'ContractManager.loadActive',
            contract: entry.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
    }

    return null;
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

    return JSON.parse(await this.fs.read(progressPath)) as ProgressData;
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
      // 更新进度
      const progress = await this.getProgress(contractId);
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
    }

    return result;
  }

  /**
   * 暂停契约
   */
  async pause(contractId: string, checkpointNote: string): Promise<void> {
    const progress = await this.getProgress(contractId);
    progress.status = 'paused';
    progress.checkpoint = checkpointNote;
    await this.saveProgress(contractId, progress);

    this.monitor?.log('contract_updated', {
      contractId,
      status: 'paused',
      checkpoint: checkpointNote,
    });
  }

  /**
   * 恢复契约
   */
  async resume(contractId: string): Promise<Contract> {
    const progress = await this.getProgress(contractId);
    progress.status = 'running';
    progress.checkpoint = null;
    await this.saveProgress(contractId, progress);

    this.monitor?.log('contract_updated', {
      contractId,
      status: 'running',
    });

    return this.loadContract(contractId);
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

    // 将 YAML 格式转换为 Contract 接口
    return {
      id: yamlContract.id,
      title: yamlContract.title,
      description: yamlContract.goal,
      status: progress.status,
      priority: 'normal',
      creator: 'system',
      goal: yamlContract.goal,
      deliverables: yamlContract.deliverables,
      subtasks: yamlContract.subtasks.map(st => ({
        id: st.id,
        description: st.description,
        status: progress.subtasks[st.id]?.status || 'pending',
        created_at: progress.started_at || new Date().toISOString(),
        updated_at: progress.subtasks[st.id]?.completed_at || new Date().toISOString(),
      })),
      auth_level: yamlContract.auth_level,
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
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: this.clawDir,
      });
      return { passed: true, feedback: output };
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      return { passed: false, feedback: stderr };
    }
  }
}
