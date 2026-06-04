import * as path from 'path';
import { formatErr } from "../../../foundation/utils/index.js";
import * as yaml from 'js-yaml';
import { isFileNotFound, type FileSystem } from '../../../foundation/fs/types.js';
import type { AuditLog } from '../../../foundation/audit/index.js';
import type { ProgressData } from '../manager.js';
import { CONTRACT_AUDIT_EVENTS } from '../audit-events.js';
import { CONTRACT_DIR } from '../dirs.js';
import type { ClawId } from '../../../foundation/identity/index.js';
import { type ClawDir } from '../../../foundation/identity/index.js';

function readContractMeta(
  fs: FileSystem,
  contractDir: string,
): { title?: string; goal?: string } {
  try {
    const raw = fs.readSync(path.join(contractDir, 'contract.yaml'));
    const parsed = yaml.load(raw) as { title?: unknown; goal?: unknown } | undefined;
    return {
      title: typeof parsed?.title === 'string' ? parsed.title : undefined,
      goal: typeof parsed?.goal === 'string' ? parsed.goal : undefined,
    };
  } catch {
    // silent: contract.yaml meta is decorative for event-collector; missing/corrupt yaml falls back to bare event (claw+contract still emitted)
    return {};
  }
}

interface FormattedEvent {
  body: string;
  hasFailure: boolean;     // 任意 subtask 有 last_failed_feedback
}

function formatContractCompletedEvent(
  clawId: ClawId,
  contractDirName: string,
  meta: { title?: string; goal?: string },
  progress: ProgressData,
): FormattedEvent {
  const lines: string[] = [`[contract_completed] claw=${clawId} contract=${contractDirName}`];
  if (meta.title) lines.push(`  title: ${meta.title}`);
  if (meta.goal) lines.push(`  goal: ${meta.goal}`);

  let hasFailure = false;
  const completed = Object.entries(progress.subtasks)
    .filter(([, st]) => st.status === 'completed');
  if (completed.length > 0) {
    lines.push('  subtasks:');
    for (const [stId, st] of completed) {
      // phase 1487: 去 [force-accepted] prefix（语义诚实化 / motion 是决策主体 / DP）
      // subtask 真实态 = claw 声称提交 + 可选 last_failure 反馈 / system 不替 motion 标注「已接受」
      // force_accepted boolean 字段保留内部 verification-lifecycle 流程不动
      const ev = st.evidence ?? '';
      lines.push(`    [${stId}] ${ev}`);
      if (st.last_failed_feedback?.feedback) {
        lines.push(`      ⚠ last_failure: ${st.last_failed_feedback.feedback}`);
        hasFailure = true;
      }
    }
  }
  return { body: lines.join('\n'), hasFailure };
}

/**
 * phase 37: 结构化 entry、含 contractId（caller 可作 dedup key）+ ms 时间戳（caller 可作 sinceTs filter）。
 */
export interface ArchivedContractEntry {
  contractId: string;
  body: string;
  hasFailure: boolean;
  /** max(subtask.completed_at) ms epoch、0 if no subtask completed_at */
  latestSubtaskCompletedAtMs: number;
}

/**
 * phase 37: 扫 archive 全 completed contract、不 filter。
 * Caller 按需 filter (sinceTs / notifiedSet / 其他)。
 *
 * 抽出动机：observer race 治本要求按 dedup-set 过滤（不依赖时间戳）、
 * 同时保留 CLI's `chestnut claw <id> events --since <ts>` sinceTs 语义。
 */
export function scanArchivedContracts(
  fs: FileSystem,
  clawDir: ClawDir,
  clawId: ClawId,
  audit: AuditLog,
): ArchivedContractEntry[] {
  const entries: ArchivedContractEntry[] = [];
  const archiveDir = path.join(clawDir, CONTRACT_DIR, 'archive');
  try {
    const dirs = fs.listSync(archiveDir, { includeDirs: true })
      .filter(e => e.isDirectory);
    for (const d of dirs) {
      const progressPath = path.join(archiveDir, d.name, 'progress.json');
      try {
        const raw = fs.readSync(progressPath);
        const parsed = JSON.parse(raw) as { contract_id?: unknown; status?: unknown; subtasks?: unknown };
        if (
          typeof parsed.contract_id !== 'string' ||
          typeof parsed.status !== 'string' ||
          typeof parsed.subtasks !== 'object' || parsed.subtasks === null
        ) {
          audit?.write(
            CONTRACT_AUDIT_EVENTS.PROGRESS_SCHEMA_INVALID,
            `clawId=${clawId}`,
            `contract=${d.name}`,
            `context=event_collector_archive`,
          );
          continue;
        }
        const progress = parsed as ProgressData;
        if (progress.status !== 'completed') continue;
        const latestSubtaskCompletedAtMs = Object.values(progress.subtasks)
          .reduce((max, s) => {
            if (!s.completed_at) return max;
            const ts = new Date(s.completed_at).getTime();
            return ts > max ? ts : max;
          }, 0);
        const meta = readContractMeta(fs, path.join(archiveDir, d.name));
        const formatted = formatContractCompletedEvent(clawId, d.name, meta, progress);
        entries.push({
          contractId: d.name,
          body: formatted.body,
          hasFailure: formatted.hasFailure,
          latestSubtaskCompletedAtMs,
        });
      } catch (err) {
        // phase 1154 r+ derive: ENOENT-equivalent = progress.json absent (archive 常态 + active 升级 race)、非 corruption 语义
        // phase 587 ⚓ invariant: PROGRESS_CORRUPTED 仅用真 JSON.parse 失败 / schema_invalid 已独立 const
        if (isFileNotFound(err)) {
          continue; // silent skip absent / 不入 audit
        }
        audit?.write(
          CONTRACT_AUDIT_EVENTS.PROGRESS_CORRUPTED,
          `clawId=${clawId}`,
          `contract=${d.name}`,
          `context=event_collector_archive`,
          `error=${formatErr(err)}`,
        );
        continue;
      }
    }
  } catch (err) {
    // phase 1154 r+ derive: 双码 narrow via foundation helper (FileSystem 抽象层抛 FS_NOT_FOUND)
    if (!isFileNotFound(err)) {
      const code = (err as NodeJS.ErrnoException)?.code;
      audit?.write(
        CONTRACT_AUDIT_EVENTS.EVENT_COLLECTOR_SCAN_FAILED,
        `dir=archive`,
        `code=${code ?? 'unknown'}`,
        `error=${formatErr(err)}`,
      );
    }
  }
  return entries;
}

/**
 * phase 1487: 返回结构化 result 替 string[].
 * `events` 字段保留原 join 兼容性 / `problemPairs` 用于 motion guidance composer extraMeta.
 */
export interface CollectedContractEventsResult {
  events: string[];
  /** [`<clawId>:<contractDirName>`, ...] for entries with last_failure feedback */
  problemPairs: string[];
}

/**
 * phase 37: thin wrapper over scanArchivedContracts + sinceTs filter (CLI / 既有 API 兼容)
 */
export function collectContractEvents(
  fs: FileSystem,
  clawDir: ClawDir,
  clawId: ClawId,
  sinceTs: number,
  audit: AuditLog,
): CollectedContractEventsResult {
  const entries = scanArchivedContracts(fs, clawDir, clawId, audit)
    .filter(e => e.latestSubtaskCompletedAtMs > sinceTs);
  return {
    events: entries.map(e => e.body),
    problemPairs: entries.filter(e => e.hasFailure).map(e => `${clawId}:${e.contractId}`),
  };
}
