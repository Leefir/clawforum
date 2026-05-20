import type { StreamEvent, StreamLog } from '../../foundation/stream/index.js';
import type { AuditLog } from '../../foundation/audit/index.js';

export class NoopStreamWriter implements StreamLog {
  write(_event: StreamEvent): boolean {
    return true;
  }
}

export class NoopAuditWriter implements AuditLog {
  write(_type: string, ..._cols: (string | number)[]): void {}
}
