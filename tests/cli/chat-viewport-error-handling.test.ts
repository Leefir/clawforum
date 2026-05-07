/**
 * chat-viewport error handling tests
 *
 * 验证 phase 523 + phase 524 加的 error handling 路径：
 * - Step A (phase 523): writeUserChat fs 失败 → 红色 error UX / chat 不崩
 * - Step B (phase 523): handleEvent unknown event → audit-only
 * - Step B (phase 524): cmd.execute throw → audit + 红色 error
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportPath = path.join(__dirname, '../../src/cli/commands/chat-viewport.ts');
const auditEventsPath = path.join(__dirname, '../../src/cli/commands/viewport-audit-events.ts');

describe('chat-viewport error handling (phase 523 + 524)', () => {
  const sourceCode = fs.readFileSync(viewportPath, 'utf-8');
  const auditEventsCode = fs.readFileSync(auditEventsPath, 'utf-8');

  describe('phase 523 Step A: writeUserChat 失败守护', () => {
    it('writeUserChat 调用包 try/catch', () => {
      // 找 onSubmit 内 writeUserChat 段
      const match = sourceCode.match(/try\s*\{\s*writeUserChat\(options\.agentDir,\s*trimmed\);\s*\}\s*catch/);
      expect(match).toBeTruthy();
    });

    it('catch 块含红色 appendOutput error', () => {
      const match = sourceCode.match(/catch\s*\(err\)\s*\{[\s\S]*?\\x1b\[31m[\s\S]*?消息发送失败[\s\S]*?\}/);
      expect(match).toBeTruthy();
    });
  });

  describe('phase 523 Step B: handleEvent default case', () => {
    it('handleEvent switch 含 default case', () => {
      const match = sourceCode.match(/default:\s*\{[\s\S]*?VIEWPORT_AUDIT_EVENTS\.UNKNOWN_EVENT[\s\S]*?\}/);
      expect(match).toBeTruthy();
    });

    it('viewport-audit-events.ts 含 UNKNOWN_EVENT const', () => {
      expect(auditEventsCode).toMatch(/UNKNOWN_EVENT:\s*'viewport_unknown_event'/);
    });
  });

  describe('phase 524 Step B: cmd.execute 守护', () => {
    it('cmd.execute 调用包 try/catch', () => {
      const match = sourceCode.match(/try\s*\{\s*cmd\.execute\(args\);\s*\}\s*catch/);
      expect(match).toBeTruthy();
    });

    it('catch 块含 audit COMMAND_ERROR + 红色 appendOutput', () => {
      const match = sourceCode.match(/catch\s*\(err\)\s*\{[\s\S]*?VIEWPORT_AUDIT_EVENTS\.COMMAND_ERROR[\s\S]*?\\x1b\[31m[\s\S]*?执行失败[\s\S]*?\}/);
      expect(match).toBeTruthy();
    });

    it('viewport-audit-events.ts 含 COMMAND_ERROR const', () => {
      expect(auditEventsCode).toMatch(/COMMAND_ERROR:\s*'viewport_command_error'/);
    });
  });
});
