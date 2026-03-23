/**
 * StreamWriter - 追加写 stream.jsonl
 */
import * as fsNative from 'fs';
import * as path from 'path';
import type { StreamCallbacks } from '../../core/runtime.js';

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

  /** daemon 启动时调用：截断文件并打开 fd */
  open(): void {
    if (this.fd !== null) {         // 防止重复 open 导致 fd 泄漏
      try { fsNative.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
    const dir = path.dirname(this.filePath);
    fsNative.mkdirSync(dir, { recursive: true });
    fsNative.writeFileSync(this.filePath, '');
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
      onToolCall: (name: string) => {
        this.write({ ts: Date.now(), type: 'tool_call', name });
      },
      onToolResult: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
        const flat = result.content.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        const summary = flat.length > 80 ? flat.slice(0, 80) + '...' : flat;
        this.write({
          ts: Date.now(),
          type: 'tool_result',
          name,
          success: result.success,
          summary,
          step: step + 1,
          maxSteps,
        });
      },
    };
  }
}
