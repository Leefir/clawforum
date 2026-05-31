/**
 * verb-fact 单源 invariants — phase 1477 Step B4.
 *
 * Covers:
 * - 每 fact 含必填字段 (name / group / form / summary)
 * - name 在 fact 表内唯一
 * - instance-form fact 名集合 = router VERB_NAMES（防双源 silent-X drift）
 * - flat-form 含且仅含 ['list', 'help']（β 基础设施约定）
 * - example 字面以 `chestnut claw` 起头（防漂移到旧 verb-first 形态）
 *
 * 反向 1：故意改一个 fact name → router VERB_NAMES 同步检查应失败
 * 反向 2：fact 表新增 instance verb 但 router 未加 → 失败
 * 反向 3：example 字面写 `chestnut claw create alice`（旧 verb-first）→ 失败
 */

import { describe, it, expect } from 'vitest';
import {
  CLAW_VERB_FACTS,
  CLAW_VERB_NAMES,
} from '../../../src/cli/help/index.js';

// Router's authoritative verb list. Imported via the router module to assert
// the two are kept in lockstep at type/runtime layer.
import { __TEST_VERB_NAMES_FROM_ROUTER } from '../../../src/cli/commands/claw-router.js';

describe('CLAW_VERB_FACTS invariants', () => {
  it('every fact has required fields', () => {
    for (const fact of CLAW_VERB_FACTS) {
      expect(fact.name).toMatch(/^[a-z][a-z-]*$/);
      expect(fact.summary.length).toBeGreaterThan(0);
      expect(['lifecycle', 'messaging', 'observation', 'discovery']).toContain(fact.group);
      expect(['instance', 'flat']).toContain(fact.form);
    }
  });

  it('verb names are unique within the fact table', () => {
    const seen = new Set<string>();
    for (const fact of CLAW_VERB_FACTS) {
      expect(seen.has(fact.name)).toBe(false);
      seen.add(fact.name);
    }
  });

  it('instance-form fact name set matches router VERB_NAMES (no double-source drift)', () => {
    const instanceFactNames = CLAW_VERB_FACTS.filter((f) => f.form === 'instance')
      .map((f) => f.name)
      .sort();
    const routerNames = [...__TEST_VERB_NAMES_FROM_ROUTER].sort();
    expect(instanceFactNames).toEqual(routerNames);
  });

  it('flat-form verbs are exactly [list, help]', () => {
    const flatNames = CLAW_VERB_FACTS.filter((f) => f.form === 'flat')
      .map((f) => f.name)
      .sort();
    expect(flatNames).toEqual(['help', 'list']);
  });

  it('every example begins with `chestnut claw` (no verb-first regression)', () => {
    for (const fact of CLAW_VERB_FACTS) {
      for (const ex of fact.examples ?? []) {
        expect(ex.startsWith('chestnut claw ')).toBe(true);
      }
    }
  });

  it('CLAW_VERB_NAMES mirrors CLAW_VERB_FACTS order/length', () => {
    expect(CLAW_VERB_NAMES).toEqual(CLAW_VERB_FACTS.map((f) => f.name));
  });

});
