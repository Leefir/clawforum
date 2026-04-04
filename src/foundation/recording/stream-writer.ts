/**
 * StreamWriter - 追加写 stream.jsonl
 */
import * as fsNative from 'fs';
import * as path from 'path';
import type { StreamCallbacks } from './context.js';
import { oneLine } from '../utils/string.js';

export interface StreamEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

export class StreamWriter {
  private fd: number | null = null;
  private filePath: string;

  constructor(agentDir: string) {
    this.filePath = path.join(agentDir, 'stream.jsonl');
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
    this.fd = fsNative.openSync(this.filePath, 'a');
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
        this.write({ ts: Date.now(), type: 'turn_interrupted', ...(message ? { message } : {}) });
      },
    };
  }
}
