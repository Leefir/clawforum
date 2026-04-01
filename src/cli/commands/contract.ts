/**
 * Contract CLI commands
 */

import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';
import { ContractManager, type ContractYaml, type ProgressData } from '../../core/contract/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { getClawDir, getMotionDir } from '../config.js';
import { MOTION_CLAW_ID } from '../../constants.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';


function parseAndValidateContractYaml(yamlContent: string): ContractYaml {
  const parsed = yaml.load(yamlContent);
  if (typeof parsed !== 'object' || parsed === null) {
    console.error('Error: contract YAML must be an object');
    process.exit(1);
  }
  const contract = parsed as ContractYaml;
  if (!contract.title) { console.error('Error: contract YAML missing required field: title'); process.exit(1); }
  if (!contract.goal) { console.error('Error: contract YAML missing required field: goal'); process.exit(1); }
  if (!Array.isArray(contract.subtasks)) {
    console.error(`Error: contract YAML "subtasks" must be an array (use "- id: ..." list syntax), got: ${typeof contract.subtasks}`);
    process.exit(1);
  }
  return contract;
}

function notifyContractCreated(clawDir: string, clawId: string, contractId: string, contract: ContractYaml): void {
  // best-effort：通知 viewport
  const line = JSON.stringify({
    ts: Date.now(), type: 'user_notify', subtype: 'contract_created',
    contractId, clawId, title: contract.title, subtaskCount: contract.subtasks.length,
  }) + '\n';

  try {
    fsNative.appendFileSync(path.join(clawDir, 'stream.jsonl'), line);
  } catch { /* daemon 未运行时忽略 */ }

  if (clawId !== MOTION_CLAW_ID) {
    try {
      fsNative.appendFileSync(path.join(getMotionDir(), 'stream.jsonl'), line);
    } catch { /* best-effort */ }
  }

  // 写 inbox 通知，触发 claw daemon 开始执行（best-effort）
  try {
    const subtaskLines = contract.subtasks.map(s => `- ${s.id}: ${s.description}`).join('\n');
    const body = [
      `新契约已创建（${contractId}）：${contract.title}`,
      `目标：${contract.goal}`,
      ``,
      `子任务：`,
      subtaskLines,
      ``,
      `执行完每个子任务后，调用 done 提交验收：`,
      `done: { "subtask": "<subtask-id>", "evidence": "<产出物路径或完成摘要>" }`,
    ].join('\n');
    writeInboxMessage({
      inboxDir: path.join(clawDir, 'inbox', 'pending'),
      type: 'message',
      source: 'system',
      priority: 'high',
      body,
      idPrefix: 'contract-new',
    });
  } catch (e) {
    console.warn('[contract] Failed to send inbox notification:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Create a contract for a claw
 */
export async function contractCreateCommand(clawId: string, filePath: string): Promise<void> {
  const yamlContent = await fs.readFile(filePath, 'utf-8');
  const contract = parseAndValidateContractYaml(yamlContent);

  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawId, clawFs);

  const contractId = await manager.create(contract);
  console.log(`Contract created: ${contractId} for claw ${clawId}`);

  notifyContractCreated(clawDir, clawId, contractId, contract);
}

/**
 * Create a contract from a directory containing contract.yaml + acceptance/
 */
export async function contractCreateFromDirCommand(clawId: string, dirPath: string): Promise<void> {
  const absDir = path.resolve(dirPath);

  const yamlContent = await fs.readFile(path.join(absDir, 'contract.yaml'), 'utf-8');
  const contract = parseAndValidateContractYaml(yamlContent);

  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawId, clawFs);

  const contractId = await manager.create(contract);
  console.log(`Contract created: ${contractId} for claw ${clawId}`);

  // Copy acceptance/ 目录（若存在）
  const srcAcceptance = path.join(absDir, 'acceptance');
  if (fsNative.existsSync(srcAcceptance)) {
    const destAcceptance = path.join(clawDir, 'contract', 'active', contractId, 'acceptance');
    await fs.mkdir(destAcceptance, { recursive: true });
    const entries = await fs.readdir(srcAcceptance);
    for (const entry of entries) {
      const src = path.join(srcAcceptance, entry);
      const srcStat = await fs.stat(src);
      if (!srcStat.isFile()) continue;   // 跳过子目录和符号链接
      const dest = path.join(destAcceptance, entry);
      await fs.copyFile(src, dest);
      if (entry.endsWith('.sh')) {
        await fs.chmod(dest, 0o755);
      }
    }
  }

  notifyContractCreated(clawDir, clawId, contractId, contract);
}

/**
 * Show contract execution log for a claw
 */
export async function contractLogCommand(clawId: string, contractId?: string): Promise<void> {
  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawId, clawFs);

  // 若未指定 contractId，用 active 契约
  let resolvedId = contractId;
  if (!resolvedId) {
    const active = await manager.loadActive();
    if (!active) {
      console.log(`No active contract for claw ${clawId}`);
      return;
    }
    resolvedId = active.id;
  }

  // 读契约 YAML（active/paused/archive 均可）
  let contractYaml: ContractYaml;
  try {
    const raw = await manager.readContractYamlRaw(resolvedId);
    contractYaml = yaml.load(raw) as ContractYaml;
  } catch {
    console.error(`Contract "${resolvedId}" not found for claw ${clawId}`);
    process.exit(1);
  }

  // 读 progress（active/paused/archive 均可）
  let progress: ProgressData | null = null;
  try {
    progress = await manager.getProgress(resolvedId);
  } catch { /* progress 文件缺失时忽略 */ }

  console.log(`Contract: ${resolvedId}`);
  console.log(`Title: ${contractYaml.title}`);
  console.log(`Goal: ${contractYaml.goal}`);
  console.log(`Status: ${progress?.status ?? 'unknown'}`);
  if (progress?.started_at) console.log(`Started: ${progress.started_at}`);
  console.log('');
  console.log('Subtasks:');

  for (const subtask of contractYaml.subtasks) {
    const st = progress?.subtasks[subtask.id];
    const status = st?.status ?? 'pending';
    const label = `[${status}]`.padEnd(13);
    console.log(`  ${label} ${subtask.id}: ${subtask.description}`);
    if (st?.evidence) {
      const ev = st.evidence.length > 300 ? st.evidence.slice(0, 300) + '…' : st.evidence;
      console.log(`               Evidence: ${ev}`);
    }
    if (st?.last_failed_feedback) {
      console.log(`               Last feedback: ${st.last_failed_feedback}`);
    }
    if (st?.retry_count) {
      console.log(`               Retries: ${st.retry_count}`);
    }
  }
}
