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
import { TASKS_SYNC_SUBAGENT_DIR } from '../../types/paths.js';

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
  // clawforum subagent tools
  exec: 'command',
  skill: 'name',
  ask_motion: 'question',
  write: 'path',
  read: 'path',
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

function formatValue(v: unknown, maxLen = 40): string {
  if (typeof v === 'string') return `"${truncateSingleLine(v, maxLen)}"`;
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
    if (lines.length > 1) return `→ ERR ${truncateSingleLine(content, 60)} (${lines.length} lines)`;
    return `→ ERR ${truncateSingleLine(content, 60)}`;
  }
  if (content === '' || content.trim() === '') return '→ ok';
  const lines = content.split('\n');
  if (lines.length > 1) return `→ ${truncateSingleLine(content, 60)} (${lines.length} lines)`;
  if (content.length <= 60) return `→ ${content}`;
  return `→ ${truncateSingleLine(content, 60)}`;
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

function slotLetter(idx: number): string {
  // 0 -> 'a', 1 -> 'b', ...
  return String.fromCharCode(97 + idx);
}

function renderSteps(turns: Turn[]): string {
  const lines: string[] = ['TURN  CALL  RESULT'];

  for (const turn of turns) {
    // text-only turns
    if (turn.toolUses.length === 0 && turn.texts.length > 0) {
      const text = turn.texts.join(' ');
      lines.push(`${turn.num}  (text) "${truncateSingleLine(text, 80)}"`);
      continue;
    }

    // tool_use turns
    const multi = turn.toolUses.length > 1;
    turn.toolUses.forEach((tu, idx) => {
      const argsStr = renderArgs(tu.name, tu.input);
      const result = renderResult(turn.toolResults.get(tu.id));
      const turnLabel = multi ? `${turn.num}.${slotLetter(idx)}` : String(turn.num);
      lines.push(`${turnLabel}  ${argsStr}  ${result}`);
    });
  }

  return lines.join('\n');
}

// ─── Step (full detail) rendering ────────────────────────────

function marker(label: string): string {
  return `=== ${label} ===`;
}

function renderArgsFull(input: Record<string, unknown>): string {
  // Single-line args: `key: value` flush left.
  // Multi-line args: `key:` on its own line, payload indented 2 spaces (YAML block-scalar style)
  // so payload lines that look like `word: value` don't get confused with peer args.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    const valStr = formatValueFull(v);
    if (!valStr.includes('\n')) {
      parts.push(`${k}: ${valStr}`);
    } else {
      const indented = valStr.split('\n').map(line => `  ${line}`).join('\n');
      parts.push(`${k}:\n${indented}`);
    }
  }
  return parts.join('\n\n');
}

function renderToolUseSections(tu: ToolUseBlock, result: ToolResultBlock | undefined, slotLabel: string): string[] {
  const sections: string[] = [];
  const callHeader = slotLabel ? `call ${slotLabel}: ${tu.name}` : `call: ${tu.name}`;
  const argsBody = renderArgsFull(tu.input);
  sections.push(argsBody ? `${marker(callHeader)}\n\n${argsBody}` : marker(callHeader));

  const resultLabel = slotLabel ? `result ${slotLabel}` : 'result';
  if (!result) {
    sections.push(marker(`${resultLabel}: (pending)`));
  } else if (result.is_error) {
    sections.push(`${marker(`${resultLabel}: ERR`)}\n\n${result.content}`);
  } else {
    sections.push(`${marker(resultLabel)}\n\n${result.content}`);
  }
  return sections;
}

function renderStepFull(turn: Turn, slotIdx?: number): string {
  if (slotIdx !== undefined) {
    if (slotIdx < 0 || slotIdx >= turn.toolUses.length) {
      throw new CliError(`slot ${slotLetter(slotIdx)} out of range (turn ${turn.num} has ${turn.toolUses.length} tool_use)`);
    }
    const tu = turn.toolUses[slotIdx];
    const slotLabel = turn.toolUses.length > 1 ? `${turn.num}.${slotLetter(slotIdx)}` : String(turn.num);
    const result = turn.toolResults.get(tu.id);
    const sections = [`turn ${slotLabel}`, ...renderToolUseSections(tu, result, '')];
    return sections.join('\n\n') + '\n';
  }

  const sections: string[] = [`turn ${turn.num}`];
  for (const thinking of turn.thinkings) {
    sections.push(`${marker('thinking')}\n\n${thinking}`);
  }
  for (const text of turn.texts) {
    sections.push(`${marker('text')}\n\n${text}`);
  }
  const multi = turn.toolUses.length > 1;
  turn.toolUses.forEach((tu, idx) => {
    const slotLabel = multi ? slotLetter(idx) : '';
    const result = turn.toolResults.get(tu.id);
    sections.push(...renderToolUseSections(tu, result, slotLabel));
  });

  return sections.join('\n\n') + '\n';
}

// ─── Resolve result dir ──────────────────────────────────────

function resolveResultDir(clawDir: string, id: string): string {
  // Try async path first
  const asyncDir = path.join(clawDir, TASKS_QUEUES_RESULTS_DIR, id);
  if (fs.existsSync(asyncDir)) return asyncDir;

  // Try sync path (verifier)
  const syncDir = path.join(clawDir, TASKS_SYNC_SUBAGENT_DIR, id);
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

function parseStepRef(s: string): { turn: number; slot?: number } {
  // Accept "N" or "N.x" (x a single lowercase letter).
  const m = /^(\d+)(?:\.([a-z]))?$/.exec(s);
  if (!m) throw new CliError(`invalid step ref "${s}" (expected N or N.x)`);
  const turn = parseInt(m[1], 10);
  const slot = m[2] ? m[2].charCodeAt(0) - 97 : undefined;
  return { turn, slot };
}

export async function subagentStepCommand(n: string, id: string, clawId: string): Promise<void> {
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

    const ref = parseStepRef(n);
    if (ref.turn < 1 || ref.turn > turns.length) {
      console.error(`step ${ref.turn} out of range (total turns: ${turns.length})`);
      process.exitCode = 1;
      return;
    }

    console.log(renderStepFull(turns[ref.turn - 1], ref.slot));
  } catch (error) {
    process.exitCode = handleCliError(error);
  }
}
