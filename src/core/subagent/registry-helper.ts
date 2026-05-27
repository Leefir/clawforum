/**
 * Per-task registry construction helper.
 *
 * Mirrors the pattern established in phase 780 / phase 944:
 * - skip the main shared DONE tool to avoid capturedResult state leak
 * - register a fresh done instance per task run
 */

import { createToolRegistry, type ToolRegistry } from '../../foundation/tools/index.js';
import { createDoneTool, DONE_TOOL_NAME } from './tools/done.js';

export function createPerTaskRegistry(
  srcRegistry: ToolRegistry,
  profile: string,
): ToolRegistry {
  const r = createToolRegistry();
  // `profile as any`: profile is runtime-typed string (caller boundary) — type guard at registry layer (phase 1382 audit-trail B-3 ratify)
  for (const tool of srcRegistry.getForProfile(profile as any)) {
    if (tool.name === DONE_TOOL_NAME) continue;
    r.register(tool);
  }
  r.register(createDoneTool());
  return r;
}
