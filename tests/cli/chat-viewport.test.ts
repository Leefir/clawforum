/**
 * Chat Viewport tests - Phase 72 regression tests
 *
 * These tests verify the code structure fixes for:
 * - Step 5: bufferType = 'text' assignment in text_delta handler
 * - Step 6: daemon death / ESC timeout flushes streaming/thinking buffer
 *
 * Note: Full integration testing requires complex TUI mocking.
 * These tests verify the fix is in place by reading the source code.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportPath = path.join(__dirname, '../../src/cli/commands/chat-viewport.ts');

describe('chat-viewport Phase 72', () => {
  const sourceCode = fs.readFileSync(viewportPath, 'utf-8');

  // ==========================================================================
  // Step 6: daemon death / ESC timeout flush
  // ==========================================================================
  describe('daemon death flush (Step 6)', () => {
    it('should call flushStreaming and flushThinking when daemon dies', () => {
      // Find the daemon death handler section
      const daemonDeathSection = sourceCode.slice(
        sourceCode.indexOf('// 进程不存在'),
        sourceCode.indexOf("appendOutput('\\x1b[31m', '✗ Daemon 已停止')")
      );

      // Verify flush calls are present
      expect(daemonDeathSection).toContain('flushStreaming()');
      expect(daemonDeathSection).toContain('flushThinking()');
      // Should be before streamingSuffix = ''
      const flushIndex = daemonDeathSection.indexOf('flushStreaming()');
      const suffixIndex = daemonDeathSection.indexOf("streamingSuffix = ''");
      expect(flushIndex).toBeLessThan(suffixIndex);
    });

    it('should call flushStreaming and flushThinking on ESC timeout', () => {
      // Find the ESC timeout handler section
      const escTimeoutMatch = sourceCode.match(
        /escTimeoutId = setTimeout\(\(\) => \{[\s\S]*?\}, 5000\)/
      );
      expect(escTimeoutMatch).toBeTruthy();

      const escTimeoutSection = escTimeoutMatch![0];

      // Verify flush calls are present
      expect(escTimeoutSection).toContain('flushStreaming()');
      expect(escTimeoutSection).toContain('flushThinking()');
    });
  });

  // ==========================================================================
  // Step 5: bufferType assignment
  // ==========================================================================
  describe('bufferType assignment (Step 5)', () => {
    it('should set bufferType = text in text_delta handler', () => {
      // Find text_delta handler
      const textDeltaMatch = sourceCode.match(
        /\} else if \(ev\.type === 'text_delta'\) \{[\s\S]*?track\.textBuffer \+= /
      );
      expect(textDeltaMatch).toBeTruthy();

      const textDeltaSection = textDeltaMatch![0];

      // Verify bufferType is set to 'text'
      expect(textDeltaSection).toContain("track.bufferType = 'text'");
    });

    it('should have bufferType assignment inside the if block', () => {
      // Extract the full text_delta handler
      const textDeltaStart = sourceCode.indexOf("} else if (ev.type === 'text_delta') {");
      expect(textDeltaStart).toBeGreaterThan(-1);

      // Find the end of this block (next else if or closing brace)
      const nextBlock = sourceCode.indexOf('} else if', textDeltaStart + 1);
      const textDeltaBlock = sourceCode.slice(textDeltaStart, nextBlock);

      // Should have the if check for bufferType
      expect(textDeltaBlock).toContain("if (track.bufferType !== 'text')");
      // Should set bufferType inside that if
      expect(textDeltaBlock).toContain("track.bufferType = 'text'");
    });
  });

  // ==========================================================================
  // Regression: outputContent reference (earlier bug fix)
  // ==========================================================================
  describe('outputContent removal regression', () => {
    it('should not reference outputContent (removed in Phase 72)', () => {
      // outputContent was replaced with outputLines
      expect(sourceCode).not.toContain('outputContent +=');
      expect(sourceCode).not.toContain('let outputContent');
    });

    it('should use appendOutput in flushStreaming', () => {
      const flushStreamingMatch = sourceCode.match(
        /const flushStreaming = \(\) => \{[\s\S]*?\};/
      );
      expect(flushStreamingMatch).toBeTruthy();
      expect(flushStreamingMatch![0]).toContain('appendOutput');
    });

    it('should use appendOutput in flushThinking', () => {
      const flushThinkingMatch = sourceCode.match(
        /const flushThinking = \(\) => \{[\s\S]*?\};/
      );
      expect(flushThinkingMatch).toBeTruthy();
      expect(flushThinkingMatch![0]).toContain('appendOutput');
    });
  });
});
