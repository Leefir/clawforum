// src/core/subagent/run.ts
/**
 * runSubagent — sync subagent lifecycle helper
 * phase 750 NEW、SubAgent 模块自治 sync subagent runtime + cleanup
 * mirror async path src/core/async-task-system/subagent-executor.ts 模板简化版
 *
 * Caller 接口面最小化（M#8）：传业务 params、不传 audit/stream/workspace 基础设施细节
 */

import * as path from 'path';
import type { FileSystem } from '../../foundation/fs/types.js';
import { createAuditWriter } from '../../foundation/audit/index.js';
import { STREAM_FILE } from '../../foundation/stream/index.js';
import type { LLMOrchestrator } from '../../foundation/llm-orchestrator/index.js';
import type { ToolRegistry } from '../../foundation/tools/index.js';
import { createToolRegistry } from '../../foundation/tools/index.js';
import type { ToolDefinition } from '../../types/message.js';
import { callerTypeToProfile, type CallerType } from '../../foundation/tool-protocol/index.js';
import { createDialogStore, type DialogStore } from '../../foundation/dialog-store/index.js';
import { TASKS_SUBAGENTS_DIR } from '../async-task-system/index.js';
import { CONTRACT_AUDIT_EVENTS } from '../contract/audit-events.js';
import { SubAgent } from './agent.js';

export interface MainContextSnapshot {
  clawId: string;
  toolUseId: string;
}

export interface RunSubagentOptions {
  // 标识
  agentId: string;
  callerType: CallerType;
  callerClawId: string;

  // 基础设施依赖（caller 注入）
  clawDir: string;
  fs: FileSystem;
  llm: LLMOrchestrator;
  registry: ToolRegistry;

  // 任务
  prompt: string;
  systemPrompt: string;

  // 持久化位置（caller own resource path、如 'tasks/sync/spawn/<id>'）
  resultDir: string;

  // 行为参数（per phase 747 ctor required 模板）
  maxSteps: number;
  idleTimeoutMs: number;

  // optional
  signal?: AbortSignal;
  mainDialogStore?: DialogStore;
  mainContextSnapshot?: MainContextSnapshot;
  toolsForLLM?: ToolDefinition[];
  taskStreamCallback?: (event: Record<string, unknown>) => void;
  onIdleTimeout?: () => void;
  workspaceCleanup?: boolean;  // 默 true
}

export interface RunSubagentResult {
  text: string;
  capturedResult?: unknown;
}

export async function runSubagent(opts: RunSubagentOptions): Promise<RunSubagentResult> {
  const workspaceDir = path.join(opts.clawDir, TASKS_SUBAGENTS_DIR, opts.agentId);

  await opts.fs.ensureDir(opts.resultDir);
  await opts.fs.ensureDir(workspaceDir);

  // audit + stream writer 自治创建（M#3 SubAgent 模块 own sync subagent disk schema）
  const auditWriter = createAuditWriter(opts.fs, `${opts.resultDir}/audit.tsv`);
  const streamPath = `${opts.resultDir}/${STREAM_FILE}`;
  const taskStreamWriter = {
    write: (event: Record<string, unknown>) => {
      opts.fs.appendSync(streamPath, JSON.stringify({ ts: Date.now(), ...event }) + '\n');
      opts.taskStreamCallback?.(event);
    },
  };

  // dialog store
  const messageStore = createDialogStore(opts.fs, opts.resultDir, auditWriter, 'messages.json');

  // tools filter by profile（caller 可 override via toolsForLLM）
  const profile = callerTypeToProfile(opts.callerType);
  const filteredRegistry = filterByProfile(opts.registry, profile);
  const toolsForLLM = opts.toolsForLLM ?? formatForLLM(filteredRegistry);

  // workspace shared with caller workspace dir 路径决策（mirror async / verifier 既有 phase 518 决策）
  const sharedWorkspaceDir = path.join(opts.clawDir, 'clawspace');

  try {
    const agent = new SubAgent({
      agentId: opts.agentId,
      resultDir: opts.resultDir,
      messageStore,
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      clawDir: opts.clawDir,
      syncDir: path.join(opts.clawDir, 'tasks/sync'),  // TASKS_SYNC_DIR
      llm: opts.llm,
      registry: filteredRegistry,
      fs: opts.fs,
      maxSteps: opts.maxSteps,
      idleTimeoutMs: opts.idleTimeoutMs,
      signal: opts.signal,
      toolsForLLM,
      callerType: opts.callerType,
      callerClawId: opts.callerClawId,
      mainDialogStore: opts.mainDialogStore,
      mainContextSnapshot: opts.mainContextSnapshot,
      onIdleTimeout: opts.onIdleTimeout,
      workspaceDir: sharedWorkspaceDir,
      taskStreamWriter,
      auditWriter,
    });

    const text = await agent.run();

    // 检 report_result tool capturedResult（verifier 等用）
    const reportTool = filteredRegistry.get('report_result');
    const capturedResult = (reportTool as { capturedResult?: unknown })?.capturedResult;

    return { text, capturedResult };
  } finally {
    // workspace cleanup（best-effort、cleanup 失败 audit）
    if (opts.workspaceCleanup ?? true) {
      await opts.fs.removeDir(workspaceDir).catch((err) => {
        auditWriter.write(
          CONTRACT_AUDIT_EVENTS.VERIFIER_CLEANUP_FAILED,
          `agent=${opts.agentId}`,
          `error=${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }
}

// internal helpers
function filterByProfile(registry: ToolRegistry, profile: string): ToolRegistry {
  const filtered = createToolRegistry();
  for (const t of registry.getForProfile(profile as import('../../types/config.js').ToolProfile)) {
    filtered.register(t);
  }
  return filtered;
}

function formatForLLM(registry: ToolRegistry): ToolDefinition[] {
  return registry.formatForLLM(registry.getAll());
}
