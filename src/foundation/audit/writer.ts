import { randomUUID } from 'crypto';
import { FileNotFoundError } from '../../types/errors.js';
import type { FileSystem } from '../fs/types.js';
import type { AuditLog } from './index.js';

/** audit.tsv 相对路径 */
// AUDIT_FILE 是文件名（相对路径），不含目录。
// 调用方负责通过 fs.baseDir 或 createSystemAudit helper 拼接完整路径。
export const AUDIT_FILE = 'audit.tsv';

export class AuditWriter implements AuditLog {
  private maxBytes: number | null;

  constructor(
    private fs: FileSystem,
    private filePath: string,
    maxSizeMb?: number | null,
  ) {
    this.maxBytes = maxSizeMb ? maxSizeMb * 1024 * 1024 : null;
  }

  write(type: string, ...cols: (string | number)[]): void {
    const ts = new Date().toISOString();
    const parts = [esc(ts), esc(type), ...cols.map(c => esc(String(c)))];
    const line = parts.join('\t') + '\n';
    try {
      if (this.maxBytes) this.rotateIfNeeded();
      this.fs.appendSync(this.filePath, line);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[AUDIT CRITICAL] write failed: type=${type} reason=${reason}`);
    }
  }

  private rotateIfNeeded(): void {
    try {
      const stats = this.fs.statSync(this.filePath);
      if (stats.size >= this.maxBytes!) {
        this.fs.moveSync(this.filePath, `${this.filePath}.${randomUUID().slice(0, 8)}.bak`);
      }
    } catch (err) {
      // FileNotFoundError（首次写入文件不存在）静默跳过；其他错误 warn
      if (!(err instanceof FileNotFoundError)) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[AUDIT CRITICAL] rotation check failed: path=${this.filePath} reason=${reason}`);
      }
    }
  }
}

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')   // \\ 先转（防后续替换产生的 \\ 被二次转义）
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0');
}
