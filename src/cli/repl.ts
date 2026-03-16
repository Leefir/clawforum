/**
 * 公共交互式 REPL 工具
 * claw chat 和 motion chat 共用
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface ReplCallbacks {
  onBeforeLLMCall?: () => void;
  onToolCall?: (name: string) => void;
  onToolResult?: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
}

export interface ReplOptions {
  /** 提示符，如 '> ' 或 'motion> ' */
  prompt: string;
  /** 头部说明文字 */
  header: string;
  /** 处理单条消息，返回回复文本 */
  onMessage: (message: string, callbacks: ReplCallbacks) => Promise<string>;
  /** readline 关闭时的清理 */
  onClose: () => Promise<void>;
  /** Ctrl+C 中断当前 LLM 调用 */
  onInterrupt?: () => void;
}

/**
 * 读取单个按键（调用前 rl 必须已 pause）
 * 返回原始字节字符串
 */
function readOneKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.resolve('\r');
  }
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (chunk) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(chunk.toString());
    });
  });
}

/**
 * 打印粘贴内容预览
 */
function printPreview(lines: string[]): void {
  const PREVIEW_MAX = 10;
  const shown = lines.slice(0, PREVIEW_MAX);
  console.log(`\n\x1b[36m粘贴内容（${lines.length} 行）：\x1b[0m`);
  console.log('─'.repeat(50));
  for (const line of shown) {
    console.log(`  ${line}`);
  }
  if (lines.length > PREVIEW_MAX) {
    console.log(`  \x1b[2m... （还有 ${lines.length - PREVIEW_MAX} 行）\x1b[0m`);
  }
  console.log('─'.repeat(50));
}

/**
 * 用 $EDITOR 编辑内容，返回编辑后的行数组
 */
function editWithEditor(lines: string[]): string[] {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmpFile = path.join(os.tmpdir(), `clawforum_edit_${Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpFile, lines.join('\n'), 'utf-8');
    const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
    if (result.error) {
      console.error(`\x1b[31m无法打开编辑器 ${editor}: ${result.error.message}\x1b[0m`);
      return lines;
    }
    const edited = fs.readFileSync(tmpFile, 'utf-8');
    return edited.split('\n');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * 粘贴预览 + 确认 / 编辑流程
 * 返回最终消息文本，null = 取消
 */
async function pastePreviewMode(rl: readline.Interface, lines: string[]): Promise<string | null> {
  // 去掉末尾空行
  let currentLines = [...lines];
  while (currentLines.length > 0 && currentLines[currentLines.length - 1].trim() === '') {
    currentLines.pop();
  }
  if (currentLines.length === 0) return null;

  // 清理后只剩单行，不需要预览
  if (currentLines.length === 1) {
    return currentLines[0].trim() || null;
  }

  // 非 TTY（管道输入），直接发送
  if (!process.stdin.isTTY) {
    return currentLines.join('\n').trim() || null;
  }

  while (true) {
    printPreview(currentLines);
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
    process.stdout.write(`[Enter] 发送  [e] 用 ${editor} 编辑  [q] 取消 > `);

    rl.pause();
    const key = await readOneKey();
    process.stdout.write('\n');

    if (key === '\r' || key === '\n') {
      // 发送
      return currentLines.join('\n').trim();
    } else if (key === 'q' || key === '\x1b' || key === '\x03') {
      // 取消 (q / Esc / Ctrl+C)
      console.log('\x1b[2m（已取消）\x1b[0m');
      rl.resume();
      return null;
    } else if (key === 'e') {
      // 用 $EDITOR 编辑
      rl.resume();
      currentLines = editWithEditor(currentLines);
      // 循环回去展示更新后的预览
    } else {
      // 其他键：忽略，重新展示
      rl.resume();
    }
  }
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { prompt, header, onMessage, onClose, onInterrupt } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt,
  });

  console.log(header);
  console.log('\nType your message or "exit" to quit. Multi-line paste supported.\n');
  rl.prompt();

  const callbacks: ReplCallbacks = {
    onBeforeLLMCall: () => {
      console.log('\x1b[2mThinking...\x1b[0m');
    },
    onToolCall: (name: string) => {
      console.log(`\x1b[2m  → Tool: ${name}\x1b[0m`);
    },
    onToolResult: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
      const summary = result.content.length > 80
        ? result.content.slice(0, 80) + '...'
        : result.content;
      const status = result.success ? '✓' : '✗';
      console.log(`\x1b[2m    ${status} [${step + 1}/${maxSteps}] ${summary}\x1b[0m`);
    },
  };

  const sendMessage = async (message: string) => {
    rl.pause();
    const handleInterrupt = () => {
      onInterrupt?.();
      process.stdout.write('\n\x1b[33m[interrupted]\x1b[0m\n');
    };
    // readline 会拦截 SIGINT，必须用 rl.on 而不是 process.on
    rl.on('SIGINT', handleInterrupt);
    try {
      const response = await onMessage(message, callbacks);
      if (response) console.log('\n' + response + '\n');
    } finally {
      rl.removeListener('SIGINT', handleInterrupt);
      rl.resume();
    }
    rl.prompt();
  };

  // 粘贴检测：多行在 20ms 内到达时进入预览流程，单行直接发送
  let pendingLines: string[] = [];
  let dispatchTimer: NodeJS.Timeout | null = null;

  const dispatch = async () => {
    dispatchTimer = null;
    const lines = pendingLines;
    pendingLines = [];

    if (lines.length === 0) { rl.prompt(); return; }

    if (lines.length === 1) {
      // 单行：正常流程
      const message = lines[0].trim();
      if (!message) { rl.prompt(); return; }
      if (message === 'exit' || message === 'quit') { rl.close(); return; }
      await sendMessage(message);
      return;
    }

    // 多行：粘贴预览确认
    const message = await pastePreviewMode(rl, lines);
    if (message) {
      await sendMessage(message);
    } else {
      rl.prompt();
    }
  };

  rl.on('line', (input) => {
    pendingLines.push(input);
    if (dispatchTimer) clearTimeout(dispatchTimer);
    dispatchTimer = setTimeout(dispatch, 20);
  });

  rl.on('close', async () => {
    console.log('\nGoodbye!');
    await onClose();
    process.exit(0);
  });
}
