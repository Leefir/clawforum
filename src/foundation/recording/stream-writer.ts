/**
 * StreamWriter - 追加写 stream.jsonl
 */
import * as fsNative from 'fs';
import * as path from 'path';
import type { StreamCallbacks } from './context.js';
import { oneLine } from '../utils/string.js';

interface StreamEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

interface StreamRetentionOptions {
  maxFiles?: number | null;
  maxDays?: number | null;
}

export class StreamWriter {
  private fd: number | null = null;
  private filePath: string;
  private retention: StreamRetentionOptions;

  constructor(agentDir: string, retention: StreamRetentionOptions = {}) {
    this.filePath = path.join(agentDir, 'stream.jsonl');
    this.retention = retention;
  }

  /** daemon 启动时调用：归档旧文件并打开 fd */
  open(): void {
    if (this.fd !== null) {         // 防止重复 open 导致 fd 泄漏
      try { fsNative.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
    const dir = path.dirname(this.filePath);
    fsNative.mkdirSync(dir, { recursive: true });
    // 归档旧文件（保留审计历史）
    if (fsNative.existsSync(this.filePath)) {
      const agentDir = path.dirname(this.filePath);
      const archiveDir = path.join(agentDir, 'logs', 'stream');
      fsNative.mkdirSync(archiveDir, { recursive: true });
      const archived = path.join(archiveDir, `stream.${Date.now()}.jsonl`);
      try {
        fsNative.renameSync(this.filePath, archived);
      } catch (err) {
        console.error('[StreamWriter] Failed to archive stream.jsonl, will overwrite:', err instanceof Error ? err.message : String(err));
      }
    }
    this.pruneArchives();
    this.fd = fsNative.openSync(this.filePath, 'a');
  }

  private pruneArchives(): void {
    const { maxFiles, maxDays } = this.retention;
    if (!maxFiles && !maxDays) return;
    try {
      const archiveDir = path.join(path.dirname(this.filePath), 'logs', 'stream');
      if (!fsNative.existsSync(archiveDir)) return;

      // 只处理符合命名规范的归档文件，按时间戳降序（最新在前）
      const files = fsNative.readdirSync(archiveDir)
        .filter(f => /^stream\.\d+\.jsonl$/.test(f))
        .map(f => ({
          fullPath: path.join(archiveDir, f),
          ts: parseInt(f.split('.')[1], 10),
        }))
        .sort((a, b) => b.ts - a.ts);

      const toDelete = new Set<string>();

      if (maxFiles != null) {
        files.slice(maxFiles).forEach(f => toDelete.add(f.fullPath));
      }
      if (maxDays != null) {
        const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
        files.filter(f => f.ts < cutoff).forEach(f => toDelete.add(f.fullPath));
      }

      for (const p of toDelete) {
        try { fsNative.unlinkSync(p); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[StreamWriter] pruneArchives failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 写一行事件 */
  write(event: StreamEvent): void {
    if (this.fd === null) return;
    const line = JSON.stringify(event) + '\n';
    try {
      fsNative.writeSync(this.fd, line);
    } catch (err) {
      console.error('[StreamWriter] write failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /** daemon 关闭时调用 */
  close(): void {
    if (this.fd !== null) {
      fsNative.closeSync(this.fd);
      this.fd = null;
    }
  }

  /** 生成一轮 ReAct 使用的 StreamCallbacks */
  createCallbacks(): StreamCallbacks {
    return {
      onBeforeLLMCall: () => {
        this.write({ ts: Date.now(), type: 'llm_start' });
      },
      onThinkingDelta: (delta: string) => {
        this.write({ ts: Date.now(), type: 'thinking_delta', delta });
      },
      onTextDelta: (delta: string) => {
        this.write({ ts: Date.now(), type: 'text_delta', delta });
      },
      onTextEnd: () => {
        this.write({ ts: Date.now(), type: 'text_end' });
      },
      onToolCall: (name: string, toolUseId: string) => {
        this.write({ ts: Date.now(), type: 'tool_call', name, tool_use_id: toolUseId });
      },
      onToolResult: (name: string, toolUseId: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
        const summary = oneLine(result.content);
        this.write({
          ts: Date.now(),
          type: 'tool_result',
          name,
          tool_use_id: toolUseId,
          success: result.success,
          summary,
          step: step + 1,
          maxSteps,
        });
      },
      onTurnStart: (sources: Array<{ text: string; type: string }>) => {
        this.write({
          ts: Date.now(),
          type: 'turn_start',
          sources: sources.length > 0 ? sources : undefined,
        });
      },
      onTurnEnd: () => {
        this.write({ ts: Date.now(), type: 'turn_end' });
      },
      onTurnError: (error: string) => {
        this.write({ ts: Date.now(), type: 'turn_error', error });
      },
      onTurnInterrupted: (reason: 'user' | 'system', timeoutMs?: number) => {
        const message = reason === 'system' && timeoutMs != null
          ? `Idle timeout: no LLM activity for ${Math.round(timeoutMs / 1000)}s`
          : undefined;
        this.write({ ts: Date.now(), type: 'turn_interrupted', reason, ...(message ? { message } : {}) });
      },
    };
  }
}
