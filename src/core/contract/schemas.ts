/**
 * @module L4.ContractSystem.Schemas
 * Zod schemas for ContractYaml shape validation (phase 311 ML#9 strict + 编码规范契约先行).
 *
 * Phase 311: ContractYaml hand-rolled `as { ... }` validation 改 Zod SoT (mirror
 * task-schemas.ts + phase 305 file-tool pattern)。schema_version: z.literal(1) brand
 * + .strict() reject unknown field + type derive from schema。
 *
 * 替换 phase 1019 / r124 E fork hand-rolled schema_version invariant check + phase
 * 1257/1399 旧字段 silent fallback parse code（旧 verification 前身字段 + escalation.max_retries→
 * verification_attempts、active load path 9 天 audit 0 emit + 0 production active load
 * path file by phase 311 evidence-based verify）。
 */

import { z } from 'zod';

const SubTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
}).strict();

const VerificationItemSchema = z.discriminatedUnion('type', [
  z.object({ subtask_id: z.string(), type: z.literal('script'), script_file: z.string().optional() }).strict(),
  z.object({ subtask_id: z.string(), type: z.literal('llm'), prompt_file: z.string().optional() }).strict(),
]);

export const ContractYamlSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().optional(),
  title: z.string(),
  background: z.string().optional(),
  goal: z.string(),
  expectations: z.string().optional(),
  subtasks: z.array(SubTaskSchema),
  verification: z.array(VerificationItemSchema).optional(),
  auth_level: z.enum(['auto', 'notify', 'confirm']).optional(),
  verification_attempts: z.number().optional(),
  audit_interval: z.number().optional(),
}).strict();

export type ContractYamlValidated = z.infer<typeof ContractYamlSchema>;
