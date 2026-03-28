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


/**
 * Create a contract for a claw
 */
export async function contractCreateCommand(clawId: string, filePath: string): Promise<void> {
  const yamlContent = await fs.readFile(filePath, 'utf-8');
  const contractYaml = yaml.load(yamlContent);
  if (typeof contractYaml !== 'object' || contractYaml === null) {
    console.error('Error: contract YAML must be an object');
    process.exit(1);
  }
  const contract = contractYaml as ContractYaml;

  // 基本字段验证
  if (!contract.title || !contract.goal || !Array.isArray(contract.subtasks)) {
    console.error('Error: contract YAML must have title, goal, subtasks[]');
    process.exit(1);
  }

  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawFs);

  const contractId = await manager.create(contract);
  console.log(`Contract created: ${contractId} for claw ${clawId}`);

  // best-effort：通知 viewport
  const line = JSON.stringify({
    ts: Date.now(), type: 'user_notify', subtype: 'contract_created',
    contractId, clawId, title: contract.title, subtaskCount: contract.subtasks.length,
  }) + '\n';

  // 写目标 claw（独立）
  try {
    fsNative.appendFileSync(path.join(clawDir, 'stream.jsonl'), line);
  } catch { /* daemon 未运行时忽略 */ }

  // 若非 motion 自身的契约，通知 motion viewport（不依赖 CLAW_ORIGIN_ID env var）
  if (clawId !== MOTION_CLAW_ID) {
    try {
      fsNative.appendFileSync(path.join(getMotionDir(), 'stream.jsonl'), line);
    } catch { /* best-effort */ }
  }

  // 写 inbox 通知，触发 claw daemon 开始执行（best-effort）
  try {
    const inboxDir = path.join(clawDir, 'inbox', 'pending');
    writeInboxMessage({
      inboxDir,
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `新契约已创建（${contractId}）：${contract.title}\n目标：${contract.goal}\n请开始执行。`,
      idPrefix: 'contract-new',
    });
  } catch (e) {
    console.warn('[contract] Failed to send inbox notification:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Create a contract from a directory containing contract.yaml + acceptance/
 */
export async function contractCreateFromDirCommand(clawId: string, dirPath: string): Promise<void> {
  const absDir = path.resolve(dirPath);

  // 读 contract.yaml
  const yamlContent = await fs.readFile(path.join(absDir, 'contract.yaml'), 'utf-8');
  const contractYaml = yaml.load(yamlContent);
  if (typeof contractYaml !== 'object' || contractYaml === null) {
    console.error('Error: contract.yaml must be an object');
    process.exit(1);
  }
  const contract = contractYaml as ContractYaml;

  if (!contract.title || !contract.goal || !Array.isArray(contract.subtasks)) {
    console.error('Error: contract.yaml must have title, goal, subtasks[]');
    process.exit(1);
  }

  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawFs);

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

  // best-effort：通知 viewport（复用 contractCreateCommand 逻辑）
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

  // inbox 通知
  try {
    writeInboxMessage({
      inboxDir: path.join(clawDir, 'inbox', 'pending'),
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `新契约已创建（${contractId}）：${contract.title}\n目标：${contract.goal}\n请开始执行。`,
      idPrefix: 'contract-new',
    });
  } catch (e) {
    console.warn('[contract] Failed to send inbox notification:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Show contract execution log for a claw
 */
export async function contractLogCommand(clawId: string, contractId?: string): Promise<void> {
  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawFs);

  const contract = await manager.loadActive();
  if (!contract) {
    console.log(`No active contract for claw ${clawId}`);
    return;
  }

  if (contractId && contract.id !== contractId) {
    console.log(`Contract ${contractId} is not active. Active: ${contract.id}`);
    return;
  }

  // 直接读 progress.json（ContractManager 无公开 loadProgress 方法）
  const progressPath = path.join(clawDir, 'contract', 'active', contract.id, 'progress.json');
  let progress: ProgressData | null = null;
  try {
    progress = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
  } catch { /* 无 progress 文件时忽略 */ }

  console.log(`Contract: ${contract.id}`);
  console.log(`Title: ${contract.title}`);
  console.log(`Goal: ${contract.goal}`);
  console.log(`Status: ${progress?.status ?? contract.status}`);
  if (progress?.started_at) console.log(`Started: ${progress.started_at}`);
  console.log('');
  console.log('Subtasks:');

  for (const subtask of contract.subtasks) {
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
