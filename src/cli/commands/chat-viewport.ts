/**
 * Chat Viewport - tail stream.jsonl 并渲染 TUI
 * motion 和 claw 共用
 */

import * as fsNative from 'fs';
import * as path from 'path';

import { writeInboxMessage } from '../../utils/inbox-writer.js';

export interface ChatViewportOptions {
  agentDir: string;   // motion dir 或 claw dir
  label: string;      // 显示名，如 'motion' 或 'claw-search'
  ensureDaemon?: () => Promise<void>;  // 调用方提供：检查 daemon 是否运行，没运行就启动
}

function writeUserChat(agentDir: string, message: string): void {
  const inboxDir = path.join(agentDir, 'inbox', 'pending');
  writeInboxMessage({
    inboxDir,
    type: 'user_chat',
    source: 'user',
    priority: 'high',
    body: message,
    idPrefix: 'chat',
  });
}

export async function runChatViewport(options: ChatViewportOptions): Promise<void> {
  // 确保 daemon 运行
  if (options.ensureDaemon) {
    await options.ensureDaemon();
  }

  const { TUI, Text, Editor, EditorKeybindingsManager, setEditorKeybindings, ProcessTerminal } = await import('@mariozechner/pi-tui');

  // 移除 Ctrl+C 从 Input 的 selectCancel，让 TUI listener 处理
  setEditorKeybindings(new EditorKeybindingsManager({
    selectCancel: 'escape',  // 只绑 ESC
  }));

  const streamPath = path.join(options.agentDir, 'stream.jsonl');
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // Editor 主题 — chat-viewport 不用 autocomplete，全部 identity 函数
  const editorTheme = {
    borderColor: (s: string) => s,
    selectList: {
      selectedPrefix: (s: string) => s,
      selectedText:   (s: string) => s,
      description:    (s: string) => s,
      scrollInfo:     (s: string) => s,
      noMatch:        (s: string) => s,
    },
  };

  // 单一输出区域（永久内容 + 流式后缀合并显示，消除组件间距）
  const outputText = new Text(`[${options.label}] Watching daemon activity...`, 0, 0);
  let outputContent = `[${options.label}] Watching daemon activity...`;
  let streamingSuffix = '';  // 当前流式内容（spinner / thinking / text）

  let streamingBuffer = '';
  let thinkingBuffer = '';
  let inTurn = false;  // daemon 是否正在处理 turn（用于 ESC 中断判断）

  // 状态栏追踪
  let ownTurnCount = 0;
  let ownStep = 0;
  let ownMaxSteps = 100;

  type ThinkingMode = 'line' | 'full' | 'none';
  let thinkingMode: ThinkingMode = 'full';

  // Braille spinner 动画
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const updateDisplay = () => {
    const full = streamingSuffix
      ? outputContent + '\n' + streamingSuffix
      : outputContent;
    outputText.setText(full);
    tui.requestRender();
  };

  // 状态栏组件（在 updateStatusBar 之前声明）
  const statusBar = new Text('', 0, 0);

  const updateStatusBar = () => {
    let line = '';
    if (isMotion) {
      const parts: string[] = [];
      for (const [id, t] of clawTrackMap) {
        if (t.active) parts.push(`⬡ ${id} #${t.turnCount} [${t.step}/${t.maxSteps}]`);
      }
      line = parts.length > 0 ? `\x1b[38;5;147m${parts.join('  ')}\x1b[0m` : '';
    } else if (inTurn) {
      line = `\x1b[38;5;147m⬡ #${ownTurnCount} [${ownStep}/${ownMaxSteps}]\x1b[0m`;
    }
    statusBar.setText(line);
  };

  const setStreamingSuffix = (text: string) => {
    streamingSuffix = text;
    updateDisplay();
  };

  const startSpinner = (text = 'Thinking...') => {
    stopSpinner();
    let frame = 0;
    spinnerTimer = setInterval(() => {
      streamingSuffix = `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${text}`;
      updateDisplay();
      frame++;
    }, 80);
    // 立即显示第一帧
    setStreamingSuffix(`${SPINNER_FRAMES[0]} ${text}`);
  };

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  // 输入组件
  const editor = new Editor(tui, editorTheme);

  const appendOutput = (line: string) => {
    outputContent += '\n' + line;
    updateDisplay();
  };

  const flushStreaming = () => {
    if (streamingBuffer) {
      outputContent += '\n' + streamingBuffer;
      streamingBuffer = '';
      streamingSuffix = '';
      updateDisplay();
    }
  };

  const flushThinking = () => {
    if (thinkingBuffer) {
      if (thinkingMode === 'full') {
        outputContent += '\n\x1b[2m' + thinkingBuffer + '\x1b[0m';
        updateDisplay();
      }
      // 'line' / 'none': 不写入永久区，直接丢弃
      thinkingBuffer = '';
    }
  };

  // 处理一个 stream event
  const handleEvent = (event: { type: string; [key: string]: unknown }) => {
    switch (event.type) {
      case 'turn_start': {
        inTurn = true;
        ownTurnCount++;
        ownStep = 0;
        flushThinking();
        flushStreaming();
        const srcs = event.sources as Array<{ text: string; type: string }> | undefined;
        if (srcs && srcs.length > 0) {
          // 显示所有非 user_chat 的来源（系统消息、inbox 消息等）
          const sysParts = srcs.filter(s => s.type !== 'user_chat').map(s => s.text);
          if (sysParts.length > 0) {
            appendOutput(`\x1b[33m> ${sysParts.join(' | ').slice(0, 120)}\x1b[0m`);
          }
        }
        updateStatusBar();
        break;
      }

      case 'llm_start':
        inTurn = true;
        flushThinking();
        flushStreaming();
        startSpinner();
        break;

      case 'thinking_delta':
        stopSpinner();
        thinkingBuffer += event.delta as string;
        if (thinkingMode === 'full') {
          setStreamingSuffix('\x1b[2m' + thinkingBuffer + '\x1b[0m');
        } else if (thinkingMode === 'line') {
          const snippet = thinkingBuffer.replace(/\s+/g, ' ').trim().slice(-60);
          setStreamingSuffix('\x1b[2m⟨' + snippet + '⟩\x1b[0m');
        }
        // 'none': 不更新 suffix
        break;

      case 'text_delta':
        stopSpinner();
        flushThinking();
        streamingBuffer += event.delta as string;
        setStreamingSuffix(streamingBuffer + '▋');
        break;

      case 'text_end':
        // no-op: keep cursor (▋) visible until tool_call/turn_end flushes
        break;

      case 'tool_call':
        stopSpinner();
        flushThinking();
        flushStreaming();
        appendOutput(`\x1b[36m→ ${event.name}\x1b[0m`);
        startSpinner(`${event.name}...`);
        break;

      case 'tool_result': {
        stopSpinner();
        if (event.step != null) ownStep = event.step as number;
        if (event.maxSteps != null) ownMaxSteps = event.maxSteps as number;
        const icon = event.success ? '✓' : '✗';
        const step = event.step ?? '?';
        const maxSteps = event.maxSteps ?? '?';
        appendOutput(`\x1b[2m  ${icon} [${step}/${maxSteps}] ${event.summary}\x1b[0m`);
        streamingSuffix = '';
        updateDisplay();
        updateStatusBar();
        break;
      }

      case 'turn_end':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        updateStatusBar();
        // Cursor disappearance signals completion; no extra separator needed
        break;

      case 'turn_interrupted':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        updateStatusBar();
        appendOutput('\x1b[33m⏎ Interrupted\x1b[0m');
        break;

      case 'turn_error':
        inTurn = false;
        stopSpinner();
        flushThinking();
        flushStreaming();
        streamingSuffix = '';
        updateDisplay();
        updateStatusBar();
        appendOutput(`\x1b[31m✗ Error: ${event.error}\x1b[0m`);
        break;

      case 'user_notify': {
        stopSpinner();   // 防止 spinner 在通知输出时继续转
        const sub = event.subtype as string;
        const subtaskId = event.subtaskId as string;
        if (sub === 'contract_created') {
          const claw = (event.clawId as string) ?? '';
          if (!claw || claw === options.label) break;  // 隐藏自己的契约通知
          const title = (event.title as string) ?? '';
          const count = (event.subtaskCount as number) ?? 0;
          appendOutput(`\x1b[2m  ✓ [contract] "${title}" created for ${claw} (${count} subtasks)\x1b[0m`);
        } else if (sub === 'subtask_completed') {
          const claw = (event.clawId as string) ?? '';
          if (!claw || claw === options.label) break;  // 隐藏自己的契约通知
          const completed = event.completedCount as number | undefined;
          const total = event.subtaskTotal as number | undefined;
          const progress = completed != null && total != null ? `, ${completed} of ${total}` : '';
          appendOutput(`\x1b[2m  ✓ [contract] ${subtaskId} passed${progress} (${claw})\x1b[0m`);
        } else if (sub === 'acceptance_failed') {
          const claw = (event.clawId as string) ?? '';
          if (!claw || claw === options.label) break;  // 隐藏自己的契约通知
          const fb = (event.feedback as string) ?? '';
          appendOutput(`\x1b[2m  ✗ [contract] ${subtaskId} failed: ${fb} (${claw})\x1b[0m`);
        } else if (sub === 'llm_error') {
          // llm_error 始终显示（无论来源）
          const claw = (event.clawId as string) ?? '';
          const errMsg = (event.error as string) ?? '';
          const forClaw = claw ? ` (${claw})` : '';
          appendOutput(`\x1b[31m  ✗ [llm] ${errMsg}${forClaw}\x1b[0m`);
        }
        break;
      }
    }
  };

  // tail stream.jsonl
  let fileSize = 0;
  let leftover = '';

  // Motion viewport：各 claw 步数追踪
  const isMotion = options.label === 'motion';
  const clawsDir = isMotion ? path.join(options.agentDir, '..', 'claws') : '';

  interface ClawTrack {
    fileSize: number;
    leftover: string;
    turnCount: number;
    step: number;
    maxSteps: number;
    active: boolean;
  }
  const clawTrackMap = new Map<string, ClawTrack>();
  let lastClawRefreshTs = 0;

  try {
    const stat = fsNative.statSync(streamPath);
    fileSize = stat.size;  // 从当前末尾开始（不 replay 历史）
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[chat] Failed to stat stream file: ${err?.message}`);
    }
    // ENOENT: 文件不存在，从 0 开始
  }

  const pollStream = () => {
    try {
      const stat = fsNative.statSync(streamPath);
      if (stat.size < fileSize) {  // daemon 重启截断了文件，重置读取位置到头部
        fileSize = 0;
        leftover = '';
      }
      if (stat.size <= fileSize) return;

      const toRead = stat.size - fileSize;
      const buf = Buffer.alloc(toRead);
      const fd = fsNative.openSync(streamPath, 'r');
      let bytesRead = 0;
      try {
        while (bytesRead < toRead) {
          const n = fsNative.readSync(fd, buf, bytesRead, toRead - bytesRead, fileSize + bytesRead);
          if (n === 0) break;  // EOF（文件被截断）
          bytesRead += n;
        }
      } finally {
        fsNative.closeSync(fd);
      }
      fileSize += bytesRead;

      const chunk = leftover + buf.toString('utf-8');
      const lines = chunk.split('\n');
      leftover = lines.pop() ?? '';  // 最后一段可能不完整，留待下次
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleEvent(event);
        } catch {
          if (line.trim().length > 2) {
            console.warn(`[chat] Failed to parse stream event: ${line.slice(0, 80)}`);
          }
        }
      }
    } catch (err) {
      // 文件可能被截断（daemon 重启），重置
      console.warn('[chat] pollStream error, resetting position:', err instanceof Error ? err.message : String(err));
      fileSize = 0;
      leftover = '';
    }
  };

  const refreshClawStatus = () => {
    if (!isMotion) return;
    let clawIds: string[] = [];
    try { clawIds = fsNative.readdirSync(clawsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name); } catch { return; }

    for (const clawId of clawIds) {
      const streamFile = path.join(clawsDir, clawId, 'stream.jsonl');
      if (!clawTrackMap.has(clawId)) {
        clawTrackMap.set(clawId, { fileSize: 0, leftover: '', turnCount: 0, step: 0, maxSteps: 100, active: false });
      }
      const track = clawTrackMap.get(clawId)!;
      try {
        const stat = fsNative.statSync(streamFile);
        if (stat.size < track.fileSize) {
          track.fileSize = 0; track.leftover = '';
          track.turnCount = 0; track.step = 0; track.active = false;
        }  // 文件被截断
        if (stat.size <= track.fileSize) continue;
        const toRead = stat.size - track.fileSize;
        const buf = Buffer.alloc(toRead);
        const fd = fsNative.openSync(streamFile, 'r');
        let bytesRead = 0;
        try {
          while (bytesRead < toRead) {
            const n = fsNative.readSync(fd, buf, bytesRead, toRead - bytesRead, track.fileSize + bytesRead);
            if (n === 0) break;
            bytesRead += n;
          }
        } finally { fsNative.closeSync(fd); }
        track.fileSize += bytesRead;

        const chunk = track.leftover + buf.toString('utf-8');
        const lines = chunk.split('\n');
        track.leftover = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'turn_start') { track.turnCount++; track.step = 0; track.active = true; }
            else if (ev.type === 'tool_result') { track.step = ev.step ?? track.step; track.maxSteps = ev.maxSteps ?? track.maxSteps; }
            else if (ev.type === 'turn_end' || ev.type === 'turn_interrupted' || ev.type === 'turn_error') { track.active = false; }
          } catch { /* skip */ }
        }
      } catch { /* ENOENT 等，跳过 */ }
    }
    updateStatusBar();
  };

  // fs.watch + fallback 轮询
  let watcher: ReturnType<typeof fsNative.watch> | null = null;
  const pollInterval = setInterval(() => {
    pollStream();
    if (isMotion) {
      const now = Date.now();
      if (now - lastClawRefreshTs >= 2000) {
        lastClawRefreshTs = now;
        refreshClawStatus();
      }
    }
  }, 200);  // fallback 200ms

  try {
    watcher = fsNative.watch(streamPath, () => pollStream());
  } catch (err) {
    console.warn('[chat] fs.watch failed, falling back to polling:', err instanceof Error ? err.message : String(err));
  }

  // Daemon 存活检测（每 3 秒一次）
  let daemonDead = false;
  const pidFile = path.join(options.agentDir, 'status', 'pid');
  const checkDaemonAlive = () => {
    if (daemonDead) return;
    try {
      const pid = parseInt(fsNative.readFileSync(pidFile, 'utf-8').trim(), 10);
      if (isNaN(pid)) return;
      try {
        process.kill(pid, 0); // 检测存活
      } catch {
        // 进程不存在
        daemonDead = true;
        inTurn = false;
        stopSpinner();
        streamingSuffix = '';
        updateDisplay();
        appendOutput('\x1b[31m✗ Daemon 已停止\x1b[0m');
        updateStatusBar();
      }
    } catch {
      // PID 文件不存在或读取失败，忽略
    }
  };
  const daemonCheckInterval = setInterval(checkDaemonAlive, 3000);

  // 输入提交处理
  editor.onSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      editor.setText('');
      tui.requestRender();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      resolveExit();
      return;
    }

    // slash 命令
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const name = parts[0];
      const arg = parts[1] as ThinkingMode | undefined;
      if (name === 'think') {
        if (!arg) {
          thinkingMode = thinkingMode === 'line' ? 'full' : thinkingMode === 'full' ? 'none' : 'line';
        } else if (arg === 'full' || arg === 'line' || arg === 'none') {
          thinkingMode = arg;
        }
        appendOutput(`\x1b[2m[thinking: ${thinkingMode}]\x1b[0m`);
      } else {
        appendOutput(`\x1b[2m[unknown command: /${name}]\x1b[0m`);
      }
      editor.setText('');
      tui.requestRender();
      return;
    }

    // 显示用户消息
    appendOutput(`\x1b[32m> ${trimmed}\x1b[0m`);
    editor.setText('');
    editor.addToHistory(trimmed);

    // 写入 inbox
    writeUserChat(options.agentDir, trimmed);
    tui.requestRender();
  };

  // Ctrl+C / Ctrl+D 退出
  let resolveExit: () => void;
  const exitPromise = new Promise<void>(r => { resolveExit = r; });

  tui.addInputListener((data: string) => {
    // Ctrl+C / Ctrl+D → 退出 viewport（优先检查，避免被 ESC 逻辑抢先）
    // 使用 includes 匹配批量输入（如 \x03\x03\x1b\x1b）
    if (data.includes('\x03') || data.includes('\x04')) {
      resolveExit();
      return { consume: true };
    }
    // ESC → 中断 daemon react（只在活跃 turn 时有效）
    // 快速连按时 data 可能是多个 \x1b，需检查是否包含 ESC 字节
    // 排除 CSI 序列（\x1b[ 开头的是方向键等）
    if (data.includes('\x1b') && !data.includes('\x1b[') && !data.includes('\r') && !data.includes('\n')) {
      if (!inTurn) {
        // 防御性清理：如果 spinner 还在转，强制停止
        stopSpinner();
        streamingSuffix = '';
        updateDisplay();
        return { consume: true };
      }
      const interruptFile = path.join(options.agentDir, 'interrupt');
      try {
        fsNative.writeFileSync(interruptFile, '');
      } catch { /* best-effort */ }
      startSpinner('Interrupting...');
      // 5 秒超时保护：如果 daemon 没响应，强制清理
      setTimeout(() => {
        if (inTurn) {
          inTurn = false;
          stopSpinner();
          streamingSuffix = '';
          updateDisplay();
        }
      }, 5000);
      return { consume: true };
    }
    return undefined;
  });

  tui.addChild(outputText);
  tui.addChild(statusBar);
  tui.addChild(editor);
  tui.setFocus(editor);

  // 防御层：任何未捕获异常先还原终端，防止 terminal emulator 因 raw mode 未还原而闪退
  const uncaughtHandler = (err: unknown) => {
    process.stderr.write(`[chat] uncaught error: ${err}\n`);
    try { tui.stop(); } catch { /* ignore */ }
    process.exit(1);
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', uncaughtHandler);

  tui.start();

  // 兜底：SIGINT 退出（终端未进 raw mode 时 Ctrl+C 转为 SIGINT）
  const sigintHandler = () => resolveExit();
  process.on('SIGINT', sigintHandler);

  await exitPromise;

  // 清理
  process.removeListener('SIGINT', sigintHandler);
  process.removeListener('uncaughtException', uncaughtHandler);
  process.removeListener('unhandledRejection', uncaughtHandler);
  stopSpinner();
  clearInterval(pollInterval);
  clearInterval(daemonCheckInterval);
  watcher?.close();
  tui.stop();
  await terminal.drainInput();
  process.stdin.pause();
}
