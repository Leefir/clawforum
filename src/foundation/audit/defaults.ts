/**
 * Audit 模块行为默认值 const
 * phase 749 物理迁自 src/constants.ts、M#3 资源唯一归属合规
 * mirror phase 745+746+747+748 owner module barrel 模板 N=5
 *
 * AUDIT_MESSAGE_MAX_CHARS = audit log 单字段最大字符数
 * caller 写 audit 前主动 slice（β-pragmatic、α audit.write API 内化推 r+1+ phase）
 */
export const AUDIT_MESSAGE_MAX_CHARS = 200;
