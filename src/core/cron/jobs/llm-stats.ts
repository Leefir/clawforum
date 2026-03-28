import * as fs from 'fs';
import * as path from 'path';

interface LlmCallEntry {
  timestamp: string;
  type: string;
  data: {
    provider: string;
    model: string;
    success: boolean;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    isFallback: boolean;
    retryCount: number;
    clawId: string;
  };
}

interface ProviderStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMsTotal: number;
}

interface ClawStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmStatsSummary {
  date: string;                                   // 统计日期，如 "2026-03-27"
  generatedAt: string;                            // 生成时间 ISO
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRetries: number;
  fallbackCalls: number;
  avgLatencyMs: number;                           // 成功调用的平均延迟
  byProvider: Record<string, ProviderStats>;
  byClaw: Record<string, ClawStats>;
}

export interface LlmStatsOptions {
  clawforumDir: string;
  motionDir: string;
}

export async function runLlmStats(opts: LlmStatsOptions): Promise<void> {
  // 统计昨天的数据
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const entries = collectEntries(opts, targetDate);
  if (entries.length === 0) {
    console.log(`[cron:llm-stats] No LLM calls found for ${targetDate}`);
    return;
  }

  const summary = aggregate(entries, targetDate);

  // 追加到 .clawforum/logs/llm-stats.jsonl
  const logsDir = path.join(opts.clawforumDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const statsFile = path.join(logsDir, 'llm-stats.jsonl');
  fs.appendFileSync(statsFile, JSON.stringify(summary) + '\n', 'utf-8');

  console.log(
    `[cron:llm-stats] ${targetDate}: ${summary.totalCalls} calls, ` +
    `${summary.totalInputTokens}/${summary.totalOutputTokens} tokens in/out, ` +
    `${summary.failedCalls} failed`
  );
}

function collectEntries(opts: LlmStatsOptions, targetDate: string): LlmCallEntry[] {
  const results: LlmCallEntry[] = [];

  // motion + all claws
  const candidates = [
    path.join(opts.motionDir, 'logs', 'llm-calls.jsonl'),
    ...(() => {
      const clawsDir = path.join(opts.clawforumDir, 'claws');
      if (!fs.existsSync(clawsDir)) return [];
      return fs.readdirSync(clawsDir).map(id =>
        path.join(clawsDir, id, 'logs', 'llm-calls.jsonl')
      );
    })(),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LlmCallEntry;
        if (entry.type !== 'llm_call') continue;
        if (!entry.timestamp.startsWith(targetDate)) continue;
        results.push(entry);
      } catch { /* skip malformed lines */ }
    }
  }

  return results;
}

function aggregate(entries: LlmCallEntry[], targetDate: string): LlmStatsSummary {
  const byProvider: Record<string, ProviderStats> = {};
  const byClaw: Record<string, ClawStats> = {};

  let successCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalRetries = 0;
  let fallbackCalls = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const { data: d } of entries) {
    if (d.success) {
      successCalls++;
      latencySum += d.latencyMs;
      latencyCount++;
    }
    totalInputTokens += d.inputTokens ?? 0;
    totalOutputTokens += d.outputTokens ?? 0;
    totalRetries += d.retryCount ?? 0;
    if (d.isFallback) fallbackCalls++;

    // byProvider
    const ps = byProvider[d.provider] ?? { calls: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0 };
    ps.calls++;
    ps.inputTokens += d.inputTokens ?? 0;
    ps.outputTokens += d.outputTokens ?? 0;
    ps.latencyMsTotal += d.latencyMs ?? 0;
    byProvider[d.provider] = ps;

    // byClaw
    const cs = byClaw[d.clawId] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    cs.calls++;
    cs.inputTokens += d.inputTokens ?? 0;
    cs.outputTokens += d.outputTokens ?? 0;
    byClaw[d.clawId] = cs;
  }

  return {
    date: targetDate,
    generatedAt: new Date().toISOString(),
    totalCalls: entries.length,
    successCalls,
    failedCalls: entries.length - successCalls,
    totalInputTokens,
    totalOutputTokens,
    totalRetries,
    fallbackCalls,
    avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
    byProvider,
    byClaw,
  };
}
