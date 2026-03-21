/**
 * Contract CLI commands
 */

import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { ContractManager, type ContractYaml } from '../../core/contract/manager.js';
import { ContractCreator } from '../../core/contract/creator.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { LLMService } from '../../foundation/llm/service.js';
import { getClawDir, loadClawConfig, loadGlobalConfig, buildLLMConfig } from '../config.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';

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
  } catch (e) {
    console.warn('[contract] Failed to send inbox notification:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Create a contract from goal description (LLM-generated)
 */
export async function contractCreateFromGoalCommand(clawId: string, goal: string): Promise<void> {
  const clawDir = getClawDir(clawId);
  
  // Load configs and build LLM
  const globalConfig = loadGlobalConfig();
  const clawConfig = loadClawConfig(clawId);
  const llmConfig = buildLLMConfig(globalConfig, clawConfig);
  const llm = new LLMService(llmConfig);
  const creator = new ContractCreator(llm);

  console.log('Generating contract from goal...');
  const { yaml: contractYaml, scripts, prompts } = await creator.generate(goal, clawDir);

  // Create contract
  const clawFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
  const manager = new ContractManager(clawDir, clawFs);
  const contractId = await manager.create(contractYaml);

  // Write acceptance files to contract directory
  const acceptanceDir = path.join(clawDir, 'contract', 'active', contractId, 'acceptance');
  await fs.mkdir(acceptanceDir, { recursive: true });
  
  for (const [id, content] of Object.entries(scripts)) {
    await fs.writeFile(path.join(acceptanceDir, `${id}.sh`), content, { mode: 0o755 });
  }
  for (const [id, content] of Object.entries(prompts)) {
    await fs.writeFile(path.join(acceptanceDir, `${id}.prompt.txt`), content);
  }

  // inbox 通知
  try {
    writeInboxMessage({
      inboxDir: path.join(clawDir, 'inbox', 'pending'),
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `新契约已创建（${contractId}）：${contractYaml.title}\n目标：${contractYaml.goal}\n请开始执行。`,
      idPrefix: 'contract-new',
    });
  } catch (e) {
    console.warn('[contract] Failed to send inbox notification:', e instanceof Error ? e.message : String(e));
  }

  // 打印摘要
  console.log(`Contract created: ${contractId} for claw ${clawId}`);
  console.log(`Title: ${contractYaml.title}`);
  console.log(`Subtasks (${contractYaml.subtasks.length}):`);
  for (const st of contractYaml.subtasks) {
    const acc = contractYaml.acceptance?.find(a => a.subtask_id === st.id);
    const accStr = acc ? ` [${acc.type}: ${acc.script_file ?? acc.prompt_file ?? ''}]` : ' [no acceptance]';
    console.log(`  - ${st.id}: ${st.description}${accStr}`);
  }
}
