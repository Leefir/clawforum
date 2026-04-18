/**
 * Stream module types (L2)
 */

/**
 * stream.jsonl 中的单行事件
 */
export interface StreamEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

/**
 * stream.jsonl 写入接口（由 StreamWriter 结构兼容，无需 implements 声明）
 */
export interface StreamLog {
  write(event: StreamEvent): void;
}
