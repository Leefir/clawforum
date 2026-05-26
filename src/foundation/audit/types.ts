export interface AuditLog {
  write(type: string, ...cols: (string | number)[]): void;
  dispose?(): void;
}
