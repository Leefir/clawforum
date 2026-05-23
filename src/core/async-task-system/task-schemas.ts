/**
 * @module L4.AsyncTaskSystem.Schemas
 * Zod schemas for SubAgentTask + ToolTask shape validation.
 *
 * Phase 1019 / r124 E fork: schema_version 写而不读 cluster (C-7) 之 (a) TaskMeta strict zod.
 * 替 phase 852 立 `validateTaskShape` 仅 2 字段 discriminator check / 校全字段 / boundary input 不再 trusted.
 */

import { z } from 'zod';

// 字符串值与 system.ts CallerType 等价（保持单一真相 / type-import）
const CallerTypeSchema = z.enum(['claw', 'subagent', 'verifier', 'shadow', 'miner']);

export const SubAgentTaskSchema = z.object({
  kind: z.literal('subagent'),
  id: z.string(),
  intent: z.string(),
  timeoutMs: z.number(),
  maxSteps: z.number(),
  parentClawId: z.string(),
  createdAt: z.string(),
  // optional fields
  callerType: CallerTypeSchema.optional(),
  originClawId: z.string().optional(),
  motionClawDir: z.string().optional(),
  postProcessor: z.string().optional(),
  mainContextSnapshot: z.object({
    clawId: z.string(),
    toolUseId: z.string(),
  }).optional(),
  systemPrompt: z.string().optional(),
});

export const ToolTaskSchema = z.object({
  kind: z.literal('tool'),
  id: z.string(),
  toolName: z.string(),
  args: z.record(z.unknown()),
  parentClawDir: z.string(),
  parentClawId: z.string(),
  createdAt: z.string(),
  isIdempotent: z.boolean(),
  maxRetries: z.number(),
  retryCount: z.number(),
  // optional fields
  callerType: CallerTypeSchema.optional(),
  toolUseId: z.string().optional(),
  isShadow: z.boolean().optional(),
});

export const TaskSchema = z.discriminatedUnion('kind', [
  SubAgentTaskSchema,
  ToolTaskSchema,
]);
