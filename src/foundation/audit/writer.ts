import { appendFileSync, statSync, renameSync } from 'fs';

export class AuditWriter {
  private maxBytes: number | null;

  constructor(
    private path: string,
    maxSizeMb?: number | null,
  ) {
    this.maxBytes = maxSizeMb ? maxSizeMb * 1024 * 1024 : null;
  }

  write(type: string, ...cols: (string | number)[]): void {
    const ts = new Date().toISOString();
    const parts = [ts, type, ...cols.map(c => esc(String(c)))];
    const line = parts.join('\t') + '\n';
    try {
      if (this.maxBytes) this.rotateIfNeeded();
      appendFileSync(this.path, line);
    } catch { /* 审计失败不能影响业务 */ }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.path).size >= this.maxBytes!) {
        renameSync(this.path, this.path.replace('.tsv', `.${Date.now()}.tsv`));
      }
    } catch { /* ignore：文件不存在（首次写入）或 stat 失败，均跳过 rotation */ }
  }
}

function esc(s: string): string {
  return s.replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}
