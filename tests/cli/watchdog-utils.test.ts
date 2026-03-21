/**
 * watchdog-utils 测试 — clawHasContract + getClawActivityInfo (Phase 19)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { clawHasContract, getClawActivityInfo } from '../../src/cli/commands/watchdog-utils.js';

let testDir: string;

beforeEach(() => {
  testDir = path.join(tmpdir(), `wdutils-${randomUUID()}`);
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('clawHasContract', () => {
  it('returns false when no contract dirs exist', () => {
    expect(clawHasContract(testDir)).toBe(false);
  });

  it('returns true when contract/active has a subdirectory', () => {
    fs.mkdirSync(path.join(testDir, 'contract', 'active', 'contract-123'), { recursive: true });
    expect(clawHasContract(testDir)).toBe(true);
  });

  it('returns true when contract/paused has a subdirectory', () => {
    fs.mkdirSync(path.join(testDir, 'contract', 'paused', 'contract-456'), { recursive: true });
    expect(clawHasContract(testDir)).toBe(true);
  });

  it('returns false when contract/active exists but has no subdirectories (only files)', () => {
    fs.mkdirSync(path.join(testDir, 'contract', 'active'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'contract', 'active', 'somefile.json'), '{}');
    expect(clawHasContract(testDir)).toBe(false);
  });
});

describe('getClawActivityInfo', () => {
  it('returns {null, null} when stream.jsonl is missing', () => {
    const result = getClawActivityInfo(testDir);
    expect(result.lastEventMs).toBeNull();
    expect(result.lastError).toBeNull();
  });

  it('updates lastEventMs for text_delta events', () => {
    const ts = 1700000000000;
    fs.writeFileSync(
      path.join(testDir, 'stream.jsonl'),
      JSON.stringify({ type: 'text_delta', ts }) + '\n',
    );
    const result = getClawActivityInfo(testDir);
    expect(result.lastEventMs).toBe(ts);
  });

  it('updates lastEventMs for thinking_delta and tool_call, picks latest', () => {
    const ts1 = 1000;
    const ts2 = 2000;
    const lines = [
      JSON.stringify({ type: 'thinking_delta', ts: ts1 }),
      JSON.stringify({ type: 'tool_call', ts: ts2 }),
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'stream.jsonl'), lines);
    const result = getClawActivityInfo(testDir);
    expect(result.lastEventMs).toBe(ts2);
  });

  it('ignores llm_start events (not in LLM_OUTPUT_EVENTS) for lastEventMs', () => {
    const ts = 1700000000000;
    fs.writeFileSync(
      path.join(testDir, 'stream.jsonl'),
      JSON.stringify({ type: 'llm_start', ts }) + '\n',
    );
    const result = getClawActivityInfo(testDir);
    expect(result.lastEventMs).toBeNull();
  });

  it('sets lastError on turn_error, clears on subsequent turn_end', () => {
    const lines = [
      JSON.stringify({ type: 'text_delta', ts: 1000 }),
      JSON.stringify({ type: 'turn_error', ts: 2000, error: 'timeout' }),
      JSON.stringify({ type: 'turn_end', ts: 3000 }),
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'stream.jsonl'), lines);
    const result = getClawActivityInfo(testDir);
    expect(result.lastError).toBeNull(); // turn_end cleared it
  });

  it('retains lastError when turn_error is the last terminal event', () => {
    const lines = [
      JSON.stringify({ type: 'text_delta', ts: 1000 }),
      JSON.stringify({ type: 'turn_error', ts: 2000, error: 'crash' }),
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'stream.jsonl'), lines);
    const result = getClawActivityInfo(testDir);
    expect(result.lastError).toBe('crash');
  });

  it('turn_interrupted does not change lastError', () => {
    const lines = [
      JSON.stringify({ type: 'turn_error', ts: 1000, error: 'some error' }),
      JSON.stringify({ type: 'turn_interrupted', ts: 2000 }),
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'stream.jsonl'), lines);
    const result = getClawActivityInfo(testDir);
    // turn_interrupted neither sets nor clears — lastError stays from turn_error
    expect(result.lastError).toBe('some error');
  });

  it('returns {null, null} for empty stream.jsonl', () => {
    fs.writeFileSync(path.join(testDir, 'stream.jsonl'), '');
    const result = getClawActivityInfo(testDir);
    expect(result.lastEventMs).toBeNull();
    expect(result.lastError).toBeNull();
  });
});
