import type { Message } from '../../types/message.js';
import type { AuditWriter } from '../audit/writer.js';

/**
 * stream.jsonl 写入接口（由 StreamWriter 结构兼容，无需 implements 声明）
 */
export interface IStreamWriter {
  write(event: { ts: number; type: string; [key: string]: unknown }): void;
}

/**
 * 统一记录上下文：daemon 和 in-process agent（subagent/dispatcher）共用
 *
 * Daemon:
 *   streamWriter → {agentDir}/stream.jsonl
 *   auditWriter  → {agentDir}/audit.tsv
 *   saveMessages → SessionManager.save()（dialog/current.json）
 *
 * SubAgent/Dispatcher:
 *   streamWriter → tasks/results/{taskId}/stream.jsonl
 *   auditWriter  → tasks/results/{taskId}/audit.tsv
 *   saveMessages → tasks/results/{taskId}/messages.json
 */
export interface RecordingContext {
  streamWriter: IStreamWriter;
  auditWriter: AuditWriter;
  saveMessages: (msgs: Message[]) => Promise<void>;
}
