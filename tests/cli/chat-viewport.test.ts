/**
 * chat-viewport tests
 *
 * Step 5: bufferType 未赋值 'text'
 * Step 6: daemon 死亡 / ESC 5s 超时时未 flush streaming/thinking buffer
 *
 * 测试策略：源代码结构验证（不依赖复杂 TUI mock）
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
  // Step 5: bufferType 赋值
  // ==========================================================================
  describe('Step 5: bufferType = text 赋值', () => {
    it('text_delta handler 中应设置 bufferType = text', () => {
      // 找到 text_delta 处理逻辑
      const textDeltaMatch = sourceCode.match(
        /\} else if \(ev\.type === 'text_delta'\) \{[\s\S]{0,400}?\}/
      );
      expect(textDeltaMatch).toBeTruthy();
      
      const textDeltaBlock = textDeltaMatch![0];
      
      // 应该在 if (track.bufferType !== 'text') 块内设置 bufferType
      expect(textDeltaBlock).toContain("track.bufferType = 'text'");
    });

    it('bufferType 赋值应在 if 块内，而非每次 delta 都赋值', () => {
      const textDeltaSection = sourceCode.slice(
        sourceCode.indexOf("} else if (ev.type === 'text_delta')"),
        sourceCode.indexOf("} else if (ev.type === 'tool_result')")
      );
      
      // 确认有 if 检查
      expect(textDeltaSection).toContain("if (track.bufferType !== 'text')");
      // 确认 bufferType 赋值在里面
      expect(textDeltaSection).toContain("track.bufferType = 'text'");
    });
  });

  // ==========================================================================
  // Step 6: daemon 死亡 flush
  // ==========================================================================
  describe('Step 6: daemon 死亡时 flush buffer', () => {
    it('daemon 死亡处理应调用 flushStreaming 和 flushThinking', () => {
      // 找到 daemon 死亡处理逻辑
      const daemonDeadSection = sourceCode.slice(
        sourceCode.indexOf('// 进程不存在'),
        sourceCode.indexOf("appendOutput('\\x1b[31m', '✗ Daemon 已停止')")
      );
      
      expect(daemonDeadSection).toContain('flushStreaming()');
      expect(daemonDeadSection).toContain('flushThinking()');
      
      // flush 应在清空 streamingSuffix 之前
      const flushIndex = daemonDeadSection.indexOf('flushStreaming()');
      const suffixIndex = daemonDeadSection.indexOf("streamingSuffix = ''");
      expect(flushIndex).toBeGreaterThan(-1);
      expect(suffixIndex).toBeGreaterThan(-1);
      expect(flushIndex).toBeLessThan(suffixIndex);
    });
  });

  // ==========================================================================
  // Step 6: ESC 超时 flush
  // ==========================================================================
  describe('Step 6: ESC 5s 超时 flush buffer', () => {
    it('ESC 超时回调应调用 flushStreaming 和 flushThinking', () => {
      // 找到 ESC 超时处理逻辑（5秒超时）
      const escTimeoutMatch = sourceCode.match(
        /escTimeoutId = setTimeout\(\(\) => \{[\s\S]{0,600}?\}, 5000\)/
      );
      expect(escTimeoutMatch).toBeTruthy();
      
      const escTimeoutBlock = escTimeoutMatch![0];
      
      expect(escTimeoutBlock).toContain('flushStreaming()');
      expect(escTimeoutBlock).toContain('flushThinking()');
    });
  });

  // ==========================================================================
  // Phase 72 核心重构验证
  // ==========================================================================
  describe('Phase 72 存储模型重构', () => {
    it('应使用 outputLines 而非 outputContent', () => {
      expect(sourceCode).toContain('outputLines: OutputLine[]');
      expect(sourceCode).toContain('const outputLines: OutputLine[]');
      // 不应有旧的 outputContent
      expect(sourceCode).not.toContain('let outputContent');
      expect(sourceCode).not.toContain('outputContent +=');
    });

    it('appendOutput 应使用新签名 (color, text)', () => {
      const appendOutputMatch = sourceCode.match(/const appendOutput = \([^)]+\) => \{/);
      expect(appendOutputMatch).toBeTruthy();
      expect(appendOutputMatch![0]).toContain('color: string');
      expect(appendOutputMatch![0]).toContain('text: string');
    });

    it('flushStreaming 应使用 appendOutput', () => {
      const flushStreamingMatch = sourceCode.match(
        /const flushStreaming = \(\) => \{[\s\S]{0,600}?\};/
      );
      expect(flushStreamingMatch).toBeTruthy();
      expect(flushStreamingMatch![0]).toContain('appendOutput');
      expect(flushStreamingMatch![0]).not.toContain('outputContent');
    });

    it('flushThinking 应使用 appendOutput', () => {
      const flushThinkingMatch = sourceCode.match(
        /const flushThinking = \(\) => \{[\s\S]{0,600}?\};/
      );
      expect(flushThinkingMatch).toBeTruthy();
      expect(flushThinkingMatch![0]).toContain('appendOutput');
      expect(flushThinkingMatch![0]).not.toContain('outputContent');
    });

    it('updateDisplay 应使用 fitLine 动态渲染', () => {
      const updateDisplayMatch = sourceCode.match(
        /const updateDisplay = \(\) => \{[\s\S]{0,800}?\};/
      );
      expect(updateDisplayMatch).toBeTruthy();
      expect(updateDisplayMatch![0]).toContain('fitLine');
      expect(updateDisplayMatch![0]).toContain('process.stdout.columns');
    });

    it('应有 RESIZE 监听', () => {
      expect(sourceCode).toContain("process.stdout.on('resize', onResize)");
      expect(sourceCode).toContain("process.stdout.off('resize', onResize)");
    });
  });

  // ==========================================================================
  // buildClawLine 修复验证
  // ==========================================================================
  describe('Step 3: buildClawLine 活跃路径', () => {
    it('活跃路径应使用 fitLine 而非手动 sliceFromStart', () => {
      // 找到 buildClawLine 函数
      const buildClawLineStart = sourceCode.indexOf('const buildClawLine = (id: string, t: ClawTrack, cols: number): string => {');
      expect(buildClawLineStart).toBeGreaterThan(-1);
      
      // 取函数体前 2000 字符（足够覆盖活跃路径）
      const buildClawLineBody = sourceCode.slice(buildClawLineStart, buildClawLineStart + 2000);
      
      // 活跃路径应该使用 fitLine
      expect(buildClawLineBody).toContain('fitLine');
    });
  });
});
