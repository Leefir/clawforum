/**
 * AuditLog module (L2)
 *
 * 状态迁移审计记录。纯追加写。
 * 服务于"运行中产生的所有信息全量记录以供审计"。
 *
 * Resources: audit.tsv
 * Dependencies: none（同步 fs 是实现细节，非模块间依赖）
 * Coupling: none
 * Consumers: Daemon, Runtime, ContractSystem, SubagentSystem
 *
 * 容错：写失败静默，审计失败不影响业务流程。
 */

export { AuditWriter } from './writer.js';
