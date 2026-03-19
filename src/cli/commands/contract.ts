/**
 * Contract CLI commands
 */

import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { ContractManager, type ContractYaml } from '../../core/contract/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { getClawDir } from '../config.js';

/**
 * Create a contract for a claw
 */
export async function contractCreateCommand(clawId: string, filePath: string): Promise<void> {
  const yamlContent = await fs.readFile(filePath, 'utf-8');
  const contractYaml = yaml.load(yamlContent) as ContractYaml;

  // 基本字段验证
  if (!contractYaml.title || !contractYaml.goal || !Array.isArray(contractYaml.subtasks)) {
    console.error('Error: contract YAML must have title, goal, subtasks[]');
    process.exit(1);
  }

  const clawDir = getClawDir(clawId);
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawFs);

  const contractId = await manager.create(contractYaml);
  console.log(`Contract created: ${contractId} for claw ${clawId}`);

  // 写 inbox 通知，触发 claw daemon 开始执行（best-effort）
  try {
    const inboxDir = path.join(clawDir, 'inbox', 'pending');
    writeInboxMessage({
      inboxDir,
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `新契约已创建（${contractId}）：${contractYaml.title}\n目标：${contractYaml.goal}\n请开始执行。`,
      idPrefix: 'contract-new',
    });
  } catch {
    // best-effort，不影响契约创建成功
  }
}
