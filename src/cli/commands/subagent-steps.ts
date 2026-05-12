/**
 * @module L6.CLI.Subagent.Steps
 * subagent steps + step commands
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveClawDir, inferKind } from './subagent-helpers.js';
import { handleCliError, CliError } from '../errors.js';
import type { Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock } from '../../types/message.js';
import type { SessionData } from '../../foundation/dialog-store/types.js';
import { TASKS_QUEUES_RESULTS_DIR, TASKS_SUBAGENTS_DIR } from '../../core/async-task-system/dirs.js';
import { TASKS_SYNC_SPAWN_DIR } from '../../types/paths.js';

// ─── Turn model ──────────────────────────────────────────────

interface Turn {
  num: number;
  texts: string[];
  thinkings: string[];
  toolUses: ToolUseBlock[];
  toolResults: Map<string, ToolResultBlock>;
}

// ─── Arg rendering ───────────────────────────────────────────

const POSITIONAL_ARG_MAP: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Grep: 'pattern',
  Glob: 'pattern',
  Bash: 'command',
  Task: 'description',
  WebFetch: 'url',
  WebSearch: 'query',
  ToolSearch: 'query',
  NotebookEdit: 'notebook_path',
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '...';
}

function truncateSingleLine(s: string, n: number): string {
  const single = s.replace(/\n/g, ' ');
  if (single.length <= n) return single;
  return single.slice(0, n) + '...';
}

function formatValue(v: unknown, maxLen = 30): string {
  if (typeof v === 'string') return `"${truncate(v, maxLen)}"`;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  const json = JSON.stringify(v);
  if (json.length <= maxLen) return json;
  return json.slice(0, maxLen) + '...';
}

function formatValueFull(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return JSON.stringify(v, null, 2);
}

function renderArgs(toolName: string, input: Record<string, unknown>): string {
  const positionalKey = POSITIONAL_ARG_MAP[toolName];
  const parts: string[] = [];

  if (positionalKey && input[positionalKey] !== undefined) {
    parts.push(formatValue(input[positionalKey]));
  }

  for (const [k, v] of Object.entries(input)) {
    if (k === positionalKey) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }

  return `${toolName}(${parts.join(', ')})`;
}

// ─── Result rendering ────────────────────────────────────────

function renderResult(result: ToolResultBlock | undefined): string {
  if (!result) return '→ (pending)';
  const content = result.content;
  if (result.is_error) {
    const lines = content.split('\n');
    if (lines.length > 1) return `→ ERR "${truncateSingleLine(content, 40)}" (${lines.length} lines)`;
    return `→ ERR "${truncateSingleLine(content, 40)}"`;
  }
  if (content === '' || content.trim() === '') return '→ ok';
  const lines = content.split('\n');
  if (lines.length > 1) return `→ "${truncateSingleLine(content, 40)}" (${lines.length} lines)`;
  if (content.length < 40) return `→ "${content}"`;
  return `→ "${truncateSingleLine(content, 40)}"`;
}

// ─── Message parsing ─────────────────────────────────────────

function parseMessages(resultDir: string): Turn[] {
  const messagesPath = path.join(resultDir, 'messages.json');
  if (!fs.existsSync(messagesPath)) {
    throw new CliError(`messages.json not found in ${resultDir}`);
  }

  const session: SessionData = JSON.parse(fs.readFileSync(messagesPath, 'utf-8'));
  const messages = session.messages;
  const turns: Turn[] = [];

  let turnNum = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      turnNum++;
      const blocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text', text: msg.content } as TextBlock];

      const nextUserMsg = messages[i + 1]?.role === 'user' ? messages[i + 1] : undefined;
      const toolResults = collectToolResults(nextUserMsg);

      const turn: Turn = {
        num: turnNum,
        texts: [],
        thinkings: [],
        toolUses: [],
        toolResults,
      };

      for (const block of blocks) {
        if (block.type === 'text') turn.texts.push((block as TextBlock).text);
        else if (block.type === 'thinking') turn.thinkings.push((block as ThinkingBlock).thinking);
        else if (block.type === 'tool_use') turn.toolUses.push(block as ToolUseBlock);
      }

      turns.push(turn);
    }
  }

  return turns;
}

function collectToolResults(userMsg: Message | undefined): Map<string, ToolResultBlock> {
  const map = new Map<string, ToolResultBlock>();
  if (!userMsg) return map;

  const blocks = Array.isArray(userMsg.content)
    ? userMsg.content
    : [{ type: 'text', text: userMsg.content }];

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const tr = block as ToolResultBlock;
      map.set(tr.tool_use_id, tr);
    }
  }

  return map;
}

// ─── Steps (summary) rendering ───────────────────────────────

function renderSteps(turns: Turn[]): string {
  const lines: string[] = [];
  // Header
  lines.push(`  TURN  TOOL(args)                                                              → RESULT`);

  for (const turn of turns) {
    // text-only turns
    if (turn.toolUses.length === 0 && turn.texts.length > 0) {
      const text = turn.texts.join(' ');
      const summary = `(text)  "${truncate(text, 80)}"`;
      lines.push(`  ${String(turn.num).padEnd(4)}  ${summary.padEnd(78)}`);
    }

    // tool_use turns
    for (const tu of turn.toolUses) {
      const argsStr = renderArgs(tu.name, tu.input);
      const result = renderResult(turn.toolResults.get(tu.id));
      const toolCol = `${argsStr}`.padEnd(78);
      lines.push(`  ${String(turn.num).padEnd(4)}  ${toolCol}  ${result}`);
    }
  }

  return lines.join('\n');
}

// ─── Step (full detail) rendering ────────────────────────────

function indentMultiline(text: string, indent: string): string {
  return text.split('\n').map((line, i) => (i === 0 ? line : indent + line)).join('\n');
}

function renderStepFull(turn: Turn): string {
  let out = `turn ${turn.num}  (${turn.toolUses.length} tool_use)\n\n`;

  // text blocks
  for (const text of turn.texts) {
    out += `  assistant (text):\n    ${indentMultiline(text, '    ')}\n\n`;
  }

  // thinking blocks
  for (const thinking of turn.thinkings) {
    out += `  assistant (thinking):\n    ${indentMultiline(thinking, '    ')}\n\n`;
  }

  // tool_use + tool_result pairs
  turn.toolUses.forEach((tu, idx) => {
    out += `  tool_use ${idx + 1}/${turn.toolUses.length}  ${tu.name}\n`;
    for (const [k, v] of Object.entries(tu.input)) {
      const valueStr = indentMultiline(formatValueFull(v), '                  ');
      out += `    ${k.padEnd(11)}: ${valueStr}\n`;
    }
    const result = turn.toolResults.get(tu.id);
    if (result) {
      out += `  tool_result:\n    ${indentMultiline(result.content, '    ')}\n\n`;
    }
  });

  return out;
}

// ─── Resolve result dir ──────────────────────────────────────

function resolveResultDir(clawDir: string, id: string): string {
  // Try async path first
  const asyncDir = path.join(clawDir, TASKS_QUEUES_RESULTS_DIR, id);
  if (fs.existsSync(asyncDir)) return asyncDir;

  // Try sync path (verifier)
  const syncDir = path.join(clawDir, TASKS_SYNC_SPAWN_DIR, id);
  if (fs.existsSync(syncDir)) return syncDir;

  // Try tasks/subagents (legacy / fallback)
  const subagentDir = path.join(clawDir, TASKS_SUBAGENTS_DIR, id);
  if (fs.existsSync(subagentDir)) return subagentDir;

  throw new CliError(`Subagent "${id}" not found in claw directory`);
}

// ─── Commands ────────────────────────────────────────────────

export async function subagentStepsCommand(id: string, clawId: string): Promise<void> {
  try {
    const clawDir = resolveClawDir(clawId);
    if (!fs.existsSync(clawDir)) {
      throw new CliError(`Claw "${clawId}" does not exist`);
    }

    const resultDir = resolveResultDir(clawDir, id);
    const turns = parseMessages(resultDir);

    if (turns.length === 0) {
      console.log('No turns found.');
      return;
    }

    console.log(renderSteps(turns));
  } catch (error) {
    process.exitCode = handleCliError(error);
  }
}

export async function subagentStepCommand(n: number, id: string, clawId: string): Promise<void> {
  try {
    const clawDir = resolveClawDir(clawId);
    if (!fs.existsSync(clawDir)) {
      throw new CliError(`Claw "${clawId}" does not exist`);
    }

    const resultDir = resolveResultDir(clawDir, id);
    const turns = parseMessages(resultDir);

    if (turns.length === 0) {
      console.log('No turns found.');
      return;
    }

    if (n < 1 || n > turns.length) {
      console.error(`step ${n} out of range (total turns: ${turns.length})`);
      process.exitCode = 1;
      return;
    }

    console.log(renderStepFull(turns[n - 1]));
  } catch (error) {
    process.exitCode = handleCliError(error);
  }
}
