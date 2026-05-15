import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewportPath = path.join(__dirname, '../../src/cli/commands/chat-viewport.ts');

describe('chat-viewport sync tool prefix (GView-3 α)', () => {
  const sourceCode = fs.readFileSync(viewportPath, 'utf-8');

  it('tool_call case contains spawn/shadow prefix logic', () => {
    // Locate the tool_call handler block
    const toolCallStart = sourceCode.indexOf("case 'tool_call':");
    expect(toolCallStart).toBeGreaterThan(-1);
    const nextCase = sourceCode.indexOf('case ', toolCallStart + 1);
    const block = sourceCode.slice(toolCallStart, nextCase > toolCallStart ? nextCase : toolCallStart + 600);

    expect(block).toContain("toolName === 'spawn'");
    expect(block).toContain("toolName === 'shadow'");
    expect(block).toContain("`${toolName}:`");
  });

  it('spawn tool gets spawn: prefix in displayName', () => {
    const toolCallStart = sourceCode.indexOf("case 'tool_call':");
    const nextCase = sourceCode.indexOf('case ', toolCallStart + 1);
    const block = sourceCode.slice(toolCallStart, nextCase > toolCallStart ? nextCase : toolCallStart + 600);

    // displayName = (toolName === 'spawn' || toolName === 'shadow') ? `${toolName}:` : toolName;
    expect(block).toContain("(toolName === 'spawn' || toolName === 'shadow')");
    expect(block).toContain('`${toolName}:`');
    expect(block).toContain(': toolName');
  });

  it('appendOutput uses displayName, not raw event.name', () => {
    const toolCallStart = sourceCode.indexOf("case 'tool_call':");
    const nextCase = sourceCode.indexOf('case ', toolCallStart + 1);
    const block = sourceCode.slice(toolCallStart, nextCase > toolCallStart ? nextCase : toolCallStart + 600);

    expect(block).toContain('displayName');
    expect(block).toContain(`⚙ \${displayName}`);
  });

  it('default tool (e.g. exec) does not get arbitrary prefix', () => {
    // The prefix is conditional: only spawn/shadow get it
    const toolCallStart = sourceCode.indexOf("case 'tool_call':");
    const nextCase = sourceCode.indexOf('case ', toolCallStart + 1);
    const block = sourceCode.slice(toolCallStart, nextCase > toolCallStart ? nextCase : toolCallStart + 600);

    // Should NOT unconditionally prefix every tool name
    expect(block).not.toMatch(/appendOutput\s*\(\s*['"]\\x1b\[36m['"]\s*,\s*[`'"]⚙\s*\$\{event\.name/);
  });
});
