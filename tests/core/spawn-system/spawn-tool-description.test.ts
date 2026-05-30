/**
 * spawn-tool description accuracy
 * - phase 883 B2: must NOT contain stale "default: 100" claim
 * - phase 1490: must NOT leak DEFAULT_MAX_STEPS const value to LLM docs / must mention "inherits caller's main loop maxSteps"
 */

import { describe, it, expect } from 'vitest';
import { spawnTool } from '../../../src/core/spawn-system/index.js';

describe('spawn-tool maxSteps description', () => {
  it('description mentions caller-inherits default (phase 1490)', () => {
    const desc = (spawnTool.schema.properties as any).maxSteps.description;
    expect(desc).toContain("inherits caller's main loop maxSteps");
  });

  it('description does NOT leak DEFAULT_MAX_STEPS const value (phase 1490 / no info leak to LLM docs)', () => {
    const desc = (spawnTool.schema.properties as any).maxSteps.description;
    expect(desc).not.toContain('DEFAULT_MAX_STEPS');
  });

  it('description does NOT contain stale "default: 100" claim (phase 883 B2)', () => {
    const desc = (spawnTool.schema.properties as any).maxSteps.description;
    expect(desc).not.toContain('default: 100');
  });
});
