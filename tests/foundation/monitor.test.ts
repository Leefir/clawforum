/**
 * Monitor tests - JSONL-based event logging
 * 
 * Tests:
 * - JSONL append/read operations
 * - JsonlMonitor event logging
 * - Query filtering (clawId, time range)
 * - Metrics aggregation
 * - Concurrent write safety
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { JsonlMonitor } from '../../src/foundation/monitor/monitor.js';
import { appendJsonl, readJsonl } from '../../src/foundation/monitor/jsonl.js';

/**
 * Create a temporary directory for tests
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-monitor-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Monitor', () => {
  describe('jsonl.ts', () => {
    let tempDir: string;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
    });
    
    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });
    
    it('should append records to JSONL file', async () => {
      const filePath = path.join(tempDir, 'test.jsonl');
      
      await appendJsonl(filePath, { id: '1', message: 'hello' });
      await appendJsonl(filePath, { id: '2', message: 'world' });
      
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ id: '1', message: 'hello' });
      expect(JSON.parse(lines[1])).toEqual({ id: '2', message: 'world' });
    });
    
    it('should read records from JSONL file', async () => {
      const filePath = path.join(tempDir, 'test.jsonl');
      
      await fs.writeFile(
        filePath,
        '{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n',
        'utf-8'
      );
      
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(3);
      expect(records[0]).toEqual({ id: '1' });
      expect(records[2]).toEqual({ id: '3' });
    });
    
    it('should skip empty lines and invalid JSON', async () => {
      const filePath = path.join(tempDir, 'test.jsonl');
      
      await fs.writeFile(
        filePath,
        '{"id":"1"}\n\n{"id":"2"}\ninvalid json\n{"id":"3"}\n',
        'utf-8'
      );
      
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(3);
      expect(records.map(r => r.id)).toEqual(['1', '2', '3']);
    });
    
    it('should return empty array for non-existent file', async () => {
      const filePath = path.join(tempDir, 'non-existent.jsonl');
      
      const records = await readJsonl(filePath);
      
      expect(records).toEqual([]);
    });
    
    it('should handle special characters in JSON', async () => {
      const filePath = path.join(tempDir, 'test.jsonl');
      const record = {
        message: 'Line 1\nLine 2\tTabbed',
        unicode: '你好 🎉',
        quote: 'He said "hello"',
      };
      
      await appendJsonl(filePath, record);
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });
  });
  
  describe('JsonlMonitor', () => {
    let tempDir: string;
    let monitor: JsonlMonitor;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
      monitor = new JsonlMonitor({ logsDir: tempDir });
    });
    
    afterEach(async () => {
      await monitor.close();
      await cleanupTempDir(tempDir);
    });
    
    it('should log LLM calls to llm-calls.jsonl', async () => {
      monitor.logLLMCall({
        timestamp: new Date().toISOString(),
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        success: true,
        latencyMs: 1234,
        inputTokens: 100,
        outputTokens: 50,
        isFallback: false,
        retryCount: 0,
      });
      
      await monitor.flush(); // Ensure write completes
      
      const filePath = path.join(tempDir, 'llm-calls.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(1);
      expect(records[0].data.provider).toBe('anthropic');
      expect(records[0].data.success).toBe(true);
    });
    
    it('should log tool calls to tool-calls.jsonl', async () => {
      monitor.logToolCall({
        toolName: 'read',
        args: { path: 'test.txt' },
        result: 'content',
        durationMs: 10,
      });
      
      await monitor.flush();
      
      const filePath = path.join(tempDir, 'tool-calls.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(1);
      expect(records[0].data.toolName).toBe('read');
    });
    
    it('should log errors to errors.jsonl', async () => {
      const error = new Error('Something went wrong');
      monitor.logError(error, { context: 'test' });
      
      await monitor.flush();
      
      const filePath = path.join(tempDir, 'errors.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(1);
      expect(records[0].data.error.message).toBe('Something went wrong');
      expect(records[0].data.context).toEqual({ context: 'test' });
    });
    
    it('should log generic events to events.jsonl', async () => {
      monitor.log('system', { action: 'startup', version: '0.1.0' });
      
      await monitor.flush();
      
      const filePath = path.join(tempDir, 'events.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('system');
      expect(records[0].data.action).toBe('startup');
    });
    
    it('should include clawId and contractId in events', async () => {
      monitor.log('contract_created', {
        clawId: 'claw-001',
        contractId: 'contract-123',
        data: { title: 'Test Contract' },
      });
      
      await monitor.flush();
      
      const filePath = path.join(tempDir, 'contracts.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records[0].clawId).toBe('claw-001');
      expect(records[0].contractId).toBe('contract-123');
    });
    
    it('should query events by clawId', async () => {
      // Log events for different claws
      monitor.log('system', { clawId: 'claw-001', data: {} });
      monitor.log('system', { clawId: 'claw-002', data: {} });
      monitor.log('system', { clawId: 'claw-001', data: {} });
      
      await monitor.flush();
      
      const events = await monitor.query({ type: 'system', clawId: 'claw-001' });
      
      expect(events).toHaveLength(2);
      expect(events.every(e => e.clawId === 'claw-001')).toBe(true);
    });
    
    it('should query events by time range', async () => {
      const now = Date.now();
      const past = new Date(now - 10000).toISOString();
      const future = new Date(now + 10000).toISOString();
      
      // Manually write events with specific timestamps
      const filePath = path.join(tempDir, 'events.jsonl');
      await fs.writeFile(
        filePath,
        `{"timestamp":"${past}","type":"system","data":{}}\n` +
        `{"timestamp":"${future}","type":"system","data":{}}\n`,
        'utf-8'
      );
      
      const events = await monitor.query({
        type: 'system',
        startTime: new Date(now - 5000),
        endTime: new Date(now + 5000),
      });
      
      // Only the event within time range should be returned
      expect(events.length).toBeLessThan(2);
    });
    
    it('should return empty array when querying non-existent file', async () => {
      const events = await monitor.query({ type: 'nonexistent' });
      expect(events).toEqual([]);
    });
    
    it('should calculate metrics correctly', async () => {
      // Log multiple LLM calls
      for (let i = 0; i < 5; i++) {
        monitor.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: 'anthropic',
          model: 'claude-3',
          success: i < 4, // 4 success, 1 failure
          latencyMs: 1000 + i * 100,
          inputTokens: 100,
          outputTokens: 50,
          isFallback: false,
          retryCount: 0,
        });
      }
      
      // Log tool calls
      for (let i = 0; i < 3; i++) {
        monitor.logToolCall({
          toolName: 'read',
          args: {},
          durationMs: 10,
        });
      }
      
      // Log an error
      monitor.logError(new Error('test error'));
      
      await monitor.flush();
      
      const metrics = await monitor.getMetrics({
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 60000),
      });
      
      expect(metrics.llmCalls).toBe(5);
      expect(metrics.toolCalls).toBe(3);
      expect(metrics.errors).toBe(1);
      expect(metrics.totalTokens).toBe(750); // (100+50) * 5
    });
    
    it('should handle 100 concurrent log calls without data loss', async () => {
      const logs = Array.from({ length: 100 }, (_, i) => 
        monitor.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: 'anthropic',
          model: 'claude-3',
          success: true,
          latencyMs: i,
          inputTokens: i,
          outputTokens: i,
          isFallback: false,
          retryCount: 0,
        })
      );
      
      await Promise.all(logs);
      await monitor.flush();
      
      const filePath = path.join(tempDir, 'llm-calls.jsonl');
      const records = await readJsonl(filePath);
      
      expect(records).toHaveLength(100);
      
      // Check that all latency values are unique (no duplicates from race conditions)
      const latencies = records.map(r => r.data.latencyMs).sort((a, b) => a - b);
      const uniqueLatencies = [...new Set(latencies)];
      expect(uniqueLatencies).toHaveLength(100);
    });
    
    it('should limit query results', async () => {
      // Log 10 events
      for (let i = 0; i < 10; i++) {
        monitor.log('system', { index: i });
      }
      
      await monitor.flush();
      
      const events = await monitor.query({ type: 'system', limit: 5 });
      
      expect(events).toHaveLength(5);
    });
  });
});
