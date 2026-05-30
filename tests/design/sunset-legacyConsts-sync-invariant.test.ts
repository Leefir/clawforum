import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * phase 1440 P0-3 — Sunset legacyConsts sync invariant.
 *
 * 应然：所有 `*_LEGACY_*` audit-event const 字面值必须出现在 assemble.ts
 * `legacyConsts` 数组中、否则 SunsetMonitor cron job 不会观测它、SUNSET trigger 永
 * 不 fire、legacy 兼容代码可能永久滞留。
 *
 * 实然历史：phase 1257 新立 CONTRACT_YAML_LEGACY_ACCEPTANCE_FIELD + phase 1399 新立
 * CONTRACT_YAML_LEGACY_ESCALATION_FIELD、两 const 都漏入 legacyConsts list（audit
 * 2026-05-29 P0-3 揭）。本 test 防 future drift：新立 `*_LEGACY_*` const 时若忘 add
 * 入 legacyConsts、test FAIL。
 *
 * cross-ref：
 *   - src/assembly/assemble.ts: legacyConsts 数组定义
 *   - src/core/cron/jobs/sunset-monitor.ts: 消费 legacyConsts
 *   - src/foundation/messaging/audit-events.ts: INBOX_LEGACY_CLAW_ID_FIELD
 *   - src/foundation/process-manager/audit-events.ts: PID_FILE_LEGACY_FORMAT
 *   - src/core/async-task-system/audit-events.ts: LEGACY_PENDING_TASK_NO_MODE
 *   - src/core/contract/audit-events.ts: CONTRACT_YAML_LEGACY_{ACCEPTANCE,ESCALATION}_FIELD
 */
describe('phase 1440 P0-3: SunsetMonitor legacyConsts sync invariant', () => {
  const srcRoot = path.resolve(__dirname, '../../src');

  function collectLegacyConstsInSrc(): string[] {
    // 形态：缩进 + 全大写名（任意位置含 LEGACY）+ `:` + snake_case 字面值字符串
    // 例：`  PID_FILE_LEGACY_FORMAT: 'pid_file_legacy_format',`
    //     `  LEGACY_PENDING_TASK_NO_MODE: 'legacy_pending_task_no_mode',`
    const out = execSync(
      `grep -rhEn "^[[:space:]]+[A-Z_]*LEGACY[A-Z_]*:[[:space:]]*'[a-z_]+'" ${srcRoot} --include='*.ts'`,
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .map((l) => l.match(/'([a-z_]+)'/)?.[1])
      .filter((v): v is string => Boolean(v));
  }

  function collectLegacyConstsInAssemble(): string[] {
    const content = fs.readFileSync(path.join(srcRoot, 'assembly/assemble.ts'), 'utf8');
    // 形态：legacyConsts: [ 'a', 'b', ... ]
    const arrayMatch = content.match(/legacyConsts:\s*\[([\s\S]*?)\]/);
    if (!arrayMatch) return [];
    const arrayBody = arrayMatch[1];
    return [...arrayBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }

  it('每个 *_LEGACY_* audit-event const 字面值必须出现在 assemble.ts legacyConsts 数组中', () => {
    const inSrc = collectLegacyConstsInSrc();
    const inAssemble = collectLegacyConstsInAssemble();

    // sanity: src 中应至少有 1 个 LEGACY const (防 regex 完全失效)
    expect(inSrc.length, 'no *_LEGACY_* consts found in src — regex likely broken').toBeGreaterThan(0);

    const missingInAssemble = inSrc.filter((c) => !inAssemble.includes(c));
    expect(
      missingInAssemble,
      `phase 1440 P0-3 invariant violation: ${missingInAssemble.length} *_LEGACY_* const(s) defined in src but missing from assemble.ts legacyConsts list:\n${missingInAssemble.map((c) => `  - ${c}`).join('\n')}\n\nFix: add missing entries to legacyConsts array in src/assembly/assemble.ts (search for "legacyConsts:").\nWhy: SunsetMonitor cron job consumes legacyConsts to sweep audit count; missing entries → SUNSET trigger never fires → legacy fallback code permanently retained.`,
    ).toEqual([]);
  });

  it('assemble.ts legacyConsts 中不应有 src 不存在的死字面值', () => {
    const inSrc = collectLegacyConstsInSrc();
    const inAssemble = collectLegacyConstsInAssemble();

    const deadInAssemble = inAssemble.filter((c) => !inSrc.includes(c));
    expect(
      deadInAssemble,
      `phase 1440 P0-3 invariant warning: ${deadInAssemble.length} dead literal(s) in assemble.ts legacyConsts (no matching *_LEGACY_* const in src):\n${deadInAssemble.map((c) => `  - ${c}`).join('\n')}\n\nFix: remove dead entries from legacyConsts (likely leftover from removed sunset fallback).`,
    ).toEqual([]);
  });

  it('反向自检 — regex 捕获 5 形态样本（前缀 LEGACY + 中缀 LEGACY + 后缀 LEGACY + 不同 owner module）', () => {
    const samples = [
      `  PID_FILE_LEGACY_FORMAT: 'pid_file_legacy_format',`,           // 中缀
      `  INBOX_LEGACY_CLAW_ID_FIELD: 'inbox_legacy_claw_id_field',`,    // 中缀
      `  LEGACY_PENDING_TASK_NO_MODE: 'legacy_pending_task_no_mode',`,  // 前缀
      `  CONTRACT_YAML_LEGACY_ACCEPTANCE_FIELD: 'contract_yaml_legacy_acceptance_field',`,
      `  CONTRACT_YAML_LEGACY_ESCALATION_FIELD: 'contract_yaml_legacy_escalation_field',`,
    ];
    const re = /^[\s]+[A-Z_]*LEGACY[A-Z_]*:\s*'([a-z_]+)'/;
    for (const sample of samples) {
      const m = sample.match(re);
      expect(m, `sample not matched: ${sample}`).not.toBeNull();
    }
  });

  it('反向自检 — regex 不误命中非 LEGACY const', () => {
    const nonLegacySamples = [
      `  TASK_CORRUPT: 'task_corrupt',`,
      `  RESULT_DELIVERY_FAILED: 'task_result_delivery_failed',`,
      `  PARSE_FAILED: 'task_parse_failed',`,
      `  // SUNSET per phase 1180: LEGACY_PENDING_TASK 0 触发 → r130+ phase 删 fallback`, // 注释行
    ];
    const re = /^[\s]+[A-Z_]*LEGACY[A-Z_]*:\s*'([a-z_]+)'/;
    for (const sample of nonLegacySamples) {
      expect(sample.match(re), `unexpected match: ${sample}`).toBeNull();
    }
  });
});
