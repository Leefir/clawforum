/**
 * Chat Viewport - tail stream.jsonl 并渲染 TUI
 * motion 和 claw 共用
 */

import * as fsNative from 'fs';
import * as path from 'path';

import { writeInboxMessage } from '../../utils/inbox-writer.js';
import { getClawActivityInfo, getContractCreatedMs, LLM_OUTPUT_EVENTS } from './watchdog-utils.js';
import stringWidth from 'string-width';

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

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function sliceToWidth(s: string, maxCols: number): string {
  let w = 0;
  let i = s.length;
  while (i > 0) {
    const cp = s.codePointAt(i - 1) ?? 0;
    const charLen = cp > 0xFFFF ? 2 : 1;
    const start = i - charLen;
    const cw = stringWidth(s.slice(start, i));
    if (w + cw > maxCols) break;
    w += cw;
    i = start;
  }
  return s.slice(i);
}

function sliceFromStart(s: string, maxCols: number): string {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i) ?? 0;
    const charLen = cp > 0xFFFF ? 2 : 1;
    const cw = stringWidth(s.slice(i, i + charLen));
    if (w + cw > maxCols) break;
    w += cw;
    i += charLen;
  }
  return s.slice(0, i);
}

interface ClawState {
  clawDir: string;
  active: boolean;
  currentTool: string | null;
  textBuffer: string;
  lastInterrupted: boolean;
  toolSuccess: boolean | null;
  bufferType: 'thinking' | 'text' | null;
  lastOutput: string;
  referenceMs: number | null;
  hasContract: boolean;
  lastError: string | null;
  clearOnNextDelta: boolean;
  pollTick: number;
}

function makeClawState(clawDir: string): ClawState {
  return {
    clawDir,
    active: false,
    currentTool: null,
    textBuffer: '',
    lastInterrupted: false,
    toolSuccess: null,
    bufferType: null,
    lastOutput: '',
    referenceMs: null,
    hasContract: false,
    lastError: null,
    clearOnNextDelta: false,
    pollTick: 0,
  };
}

export async function runChatViewport(options: ChatViewportOptions): Promise<void> {
  // 确保 daemon 运行
  if (options.ensureDaemon) {
    await options.ensureDaemon();
  }

  const { TUI, Text, Editor, EditorKeybindingsManager, setEditorKeybindings, ProcessTerminal } = await import('@mariozechner/pi-tui');

  // 移除 Ctrl+C 从 Editor 的 selectCancel，让 TUI listener 处理
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
  const attachedClawBar = new Text('', 0, 0);

  const updateStatusBar = () => {
    if (attachedClawId) return;   // attach 期间不恢复 statusBar
    let line = '';
    if (isMotion) {
      const parts: string[] = [];

      // 各 claw 状态
      for (const [id, t] of clawTrackMap) {
        if (t.active && t.isAlive) {   // isAlive 守卫：daemon 崩溃不显示紫色
          parts.push(`\x1b[38;5;147m⬡ ${id} #${t.turnCount} [${t.step}/${t.maxSteps}]\x1b[0m`);
        } else if (t.lastError && t.hasContract && t.isAlive) {
          parts.push(`\x1b[38;5;214m⚠ ${id}\x1b[0m`);
        } else if (t.hasContract && t.isAlive) {
          const turnSuffix = t.turnCount > 0 ? ` #${t.turnCount}` : '';
          parts.push(`\x1b[38;5;245m○ ${id}${turnSuffix}\x1b[0m`);
        }
      }
      line = parts.join('  ');
    }
    statusBar.setText(line);
  };

  const setStreamingSuffix = (text: string) => {
    streamingSuffix = text;
    updateDisplay();
  };

  const updateAttachedClawBar = () => {
    if (!attachedClawId) { attachedClawBar.setText(''); return; }
    const id = attachedClawId;
    const st = attachedClaws.get(id)!;
    // 活跃模式
    if (st.active) {
      const cols = process.stdout.columns ?? 80;
      let line: string;
      const icon = st.toolSuccess === true ? '✓'
                 : st.toolSuccess === false ? '✗'
                 : '⚙';
      if (st.currentTool) {
        if (st.textBuffer) {
          const isThinking = st.bufferType === 'thinking';
          const open = isThinking ? '(' : '"';
          const close = isThinking ? ')' : '"';
          const prefix = `[${id}] ${icon} ${st.currentTool} · ${open}`;
          const suffix = close;
          const available = cols - prefix.length - suffix.length;
          const text = sliceFromStart(st.textBuffer.replace(/\n/g, ' '), available);
          line = `\x1b[38;5;147m${prefix}${text}${suffix}\x1b[0m`;
        } else {
          line = `\x1b[38;5;147m[${id}] ${icon} ${st.currentTool}\x1b[0m`;
        }
      } else {
        // 首轮 thinking，尚无工具名
        const prefix = `[${id}] ⊙ (`;
        const available = cols - prefix.length - 1;
        const text = st.textBuffer
          ? sliceFromStart(st.textBuffer.replace(/\n/g, ' '), available)
          : '';
        line = `\x1b[38;5;147m${prefix}${text})\x1b[0m`;
      }
      attachedClawBar.setText(line);
      return;
    }
    // 不活跃模式：所有状态都显示 lastOutput（如果有）
    let line: string;
    let leftText: string;
    let leftColor: string;
    if (!st.hasContract) {
      leftText = `[${id}] ○ no contract`;
      leftColor = '\x1b[38;5;245m';
    } else if (st.lastError) {
      const dur = st.referenceMs ? ` · inactive ${fmtDuration(Date.now() - st.referenceMs)}` : '';
      leftText = `[${id}] ✗ ${st.lastError}${dur}`;
      leftColor = '\x1b[38;5;214m';
    } else if (st.lastInterrupted) {
      const dur = st.referenceMs ? ` · inactive ${fmtDuration(Date.now() - st.referenceMs)}` : '';
      leftText = `[${id}] ✗ interrupted${dur}`;
      leftColor = '\x1b[38;5;214m';
    } else {
      const dur = st.referenceMs ? `inactive ${fmtDuration(Date.now() - st.referenceMs)}` : 'waiting';
      leftText = `[${id}] ○ ${dur}`;
      leftColor = '\x1b[38;5;245m';
    }
    // 追加 lastOutput（如果有）
    if (st.lastOutput) {
      const prefix = `${leftText} · "`;
      const available = (process.stdout.columns ?? 80) - prefix.length - 1;
      const snippet = sliceFromStart(st.lastOutput.replace(/\n/g, ' '), available);
      line = `${leftColor}${prefix}${snippet}"\x1b[0m`;
    } else {
      line = `${leftColor}${leftText}\x1b[0m`;
    }
    attachedClawBar.setText(line);
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
          setStreamingSuffix('\x1b[2m(' + snippet + ')\x1b[0m');
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

      case 'task_started': {
        const taskId = event.taskId as string;
        const callerType = (event.callerType as string) ?? 'subagent';
        const streamPath = path.join(options.agentDir, 'tasks', 'results', `${taskId}.stream.jsonl`);
        const tw: TaskWatch = { callerType: callerType as any, fileSize: 0, leftover: '', watcher: null };
        taskWatchMap.set(taskId, tw);
        try {
          tw.watcher = fsNative.watch(streamPath, { persistent: false }, () => pollTaskStream(taskId));
        } catch { /* fallback to poll */ }
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
  let attachedClawId: string | null = null;
  const attachedClaws = new Map<string, ClawState>();

  interface ClawTrack {
    fileSize: number;
    leftover: string;
    turnCount: number;
    step: number;
    maxSteps: number;
    active: boolean;
    lastError: string | null;   // 最近 turn_error；turn_end/interrupted 时清除
    hasContract: boolean;        // contract/active/ 目录非空
    isAlive: boolean;            // PID 存活
  }
  const clawTrackMap = new Map<string, ClawTrack>();
  const clawWatchers = new Map<string, ReturnType<typeof fsNative.watch>>();
  let clawRefreshScheduled = false;
  let lastClawRefreshTs = 0;

  // Task stream watching (for dispatch/spawn subagent progress)
  interface TaskWatch {
    callerType: 'dispatcher' | 'subagent';
    fileSize: number;
    leftover: string;
    watcher: ReturnType<typeof fsNative.watch> | null;
  }
  const taskWatchMap = new Map<string, TaskWatch>();

  const stopTaskWatch = (taskId: string) => {
    const tw = taskWatchMap.get(taskId);
    if (!tw) return;
    tw.watcher?.close();
    taskWatchMap.delete(taskId);
  };

  const scheduleClawRefresh = (clawId: string) => {
    if (clawRefreshScheduled) return;
    clawRefreshScheduled = true;
    setTimeout(() => { clawRefreshScheduled = false; refreshClawStatus(clawId); }, 100);
  };

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

  const refreshClawStatus = (clawId: string) => {
    if (!isMotion) return;
    const st = attachedClaws.get(clawId);
    if (!st) return;

    const streamFile = path.join(st.clawDir, 'stream.jsonl');
    const track = clawTrackMap.get(clawId);
    if (!track) return;

    try {
      const stat = fsNative.statSync(streamFile);
      if (stat.size < track.fileSize) {
        track.fileSize = 0; track.leftover = '';
        track.turnCount = 0; track.step = 0; track.active = false; track.lastError = null;
      }
      if (stat.size > track.fileSize) {
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
            else if (ev.type === 'turn_error') { track.active = false; track.lastError = (ev.error as string) ?? 'error'; }
            else if (ev.type === 'turn_end' || ev.type === 'turn_interrupted') { track.active = false; track.lastError = null; }
            // attach 专用解析
            if (LLM_OUTPUT_EVENTS.has(ev.type)) {
              if (st.active === false) st.lastOutput = '';
              st.active = true;
              if (ev.type === 'thinking_delta') {
                if (st.clearOnNextDelta) {
                  st.textBuffer = '';
                  st.bufferType = null;
                  st.clearOnNextDelta = false;
                }
                st.textBuffer += (ev.delta as string) ?? '';
                st.bufferType = 'thinking';
              } else if (ev.type === 'tool_call') {
                st.currentTool = (ev.name as string) ?? null;
                st.toolSuccess = null;
                st.clearOnNextDelta = true;
              } else if (ev.type === 'text_delta') {
                if (st.bufferType !== 'text') {
                  st.textBuffer = '';
                  st.clearOnNextDelta = false;
                }
                st.textBuffer += (ev.delta as string) ?? '';
              }
            } else if (ev.type === 'tool_result') {
              st.toolSuccess = (ev.success as boolean) ?? null;
            } else if (ev.type === 'turn_start') {
              st.lastOutput = '';
              st.lastInterrupted = false;
            } else if (ev.type === 'turn_end') {
              st.active = false; st.lastInterrupted = false;
              if (st.textBuffer) st.lastOutput = st.textBuffer;
              st.currentTool = null; st.textBuffer = '';
              st.toolSuccess = null; st.bufferType = null; st.clearOnNextDelta = false;
              st.referenceMs = Date.now();
            } else if (ev.type === 'turn_error') {
              st.active = false; st.lastInterrupted = false;
              st.currentTool = null; st.textBuffer = '';
              st.toolSuccess = null; st.bufferType = null; st.lastOutput = ''; st.clearOnNextDelta = false;
              st.lastError = (ev.error as string) ?? 'error';
              st.referenceMs = Date.now();
            } else if (ev.type === 'turn_interrupted') {
              st.active = false; st.lastInterrupted = true;
              st.currentTool = null; st.textBuffer = '';
              st.toolSuccess = null; st.bufferType = null; st.lastOutput = ''; st.clearOnNextDelta = false;
              st.referenceMs = Date.now();
            }
            updateAttachedClawBar();
            tui.requestRender();
          } catch { /* skip */ }
        }
      }
    } catch { /* ENOENT 等，跳过 */ }
  };

  const refreshAllClawStatus = () => {
    if (!isMotion) return;
    let clawIds: string[] = [];
    try { clawIds = fsNative.readdirSync(clawsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name); } catch { return; }

    // 清理已删除的 claw
    for (const [id] of clawTrackMap) {
      if (!clawIds.includes(id)) {
        clawWatchers.get(id)?.close();
        clawWatchers.delete(id);
        clawTrackMap.delete(id);
      }
    }

    for (const clawId of clawIds) {
      const streamFile = path.join(clawsDir, clawId, 'stream.jsonl');
      if (!clawTrackMap.has(clawId)) {
        clawTrackMap.set(clawId, { fileSize: 0, leftover: '', turnCount: 0, step: 0, maxSteps: 100, active: false, lastError: null, hasContract: false, isAlive: false });
      }
      if (!clawWatchers.has(clawId)) {
        try {
          const w = fsNative.watch(streamFile, { persistent: false }, () => scheduleClawRefresh(clawId));
          w.on('error', () => {
            w.close();
            clawWatchers.delete(clawId);
          });
          clawWatchers.set(clawId, w);
        } catch { /* fallback to polling */ }
      }
      const track = clawTrackMap.get(clawId)!;

      // Contract check
      const contractActiveDir = path.join(clawsDir, clawId, 'contract', 'active');
      try {
        track.hasContract = fsNative.readdirSync(contractActiveDir).length > 0;
      } catch { track.hasContract = false; }

      // Process alive check
      const clawPidFile = path.join(clawsDir, clawId, 'status', 'pid');
      try {
        const pid = parseInt(fsNative.readFileSync(clawPidFile, 'utf-8').trim(), 10);
        if (Number.isFinite(pid)) {
          try {
            process.kill(pid, 0);
            track.isAlive = true;
          } catch (e) {
            track.isAlive = (e as NodeJS.ErrnoException).code === 'EPERM';
          }
        } else { track.isAlive = false; }
      } catch { track.isAlive = false; }
    }
    updateStatusBar();
  };

  // Poll task stream for subagent progress (dispatch/spawn)
  const pollTaskStream = (taskId: string) => {
    const tw = taskWatchMap.get(taskId);
    if (!tw) return;
    const streamPath = path.join(options.agentDir, 'tasks', 'results', `${taskId}.stream.jsonl`);
    try {
      const stat = fsNative.statSync(streamPath);
      if (stat.size <= tw.fileSize) return;
      const toRead = stat.size - tw.fileSize;
      const buf = Buffer.alloc(toRead);
      const fd = fsNative.openSync(streamPath, 'r');
      let bytesRead = 0;
      try {
        while (bytesRead < toRead) {
          const n = fsNative.readSync(fd, buf, bytesRead, toRead - bytesRead, tw.fileSize + bytesRead);
          if (n === 0) break;
          bytesRead += n;
        }
      } finally { fsNative.closeSync(fd); }
      tw.fileSize += bytesRead;

      const chunk = tw.leftover + buf.toString('utf-8');
      const lines = chunk.split('\n');
      tw.leftover = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          handleTaskEvent(taskId, tw.callerType, ev);
        } catch { }
      }
    } catch { }
  };

  const handleTaskEvent = (
    taskId: string,
    callerType: string,
    event: { type: string; [key: string]: unknown },
  ) => {
    const prefix = callerType;
    switch (event.type) {
      case 'tool_call':
        stopSpinner();
        appendOutput(`\x1b[36m→ ${prefix}:${event.name}\x1b[0m`);
        startSpinner(`${prefix}:${event.name}...`);
        break;
      case 'tool_result': {
        stopSpinner();
        const icon = event.success ? '✓' : '✗';
        appendOutput(`\x1b[2m  ${icon} [${event.step}/${event.maxSteps}] ${event.summary}\x1b[0m`);
        streamingSuffix = '';
        updateDisplay();
        break;
      }
      case 'turn_end':
      case 'turn_error':
      case 'turn_interrupted':
        stopSpinner();
        stopTaskWatch(taskId);
        break;
    }
  };

  // fs.watch + fallback 轮询
  let watcher: ReturnType<typeof fsNative.watch> | null = null;
  const pollInterval = setInterval(() => {
    pollStream();
    if (isMotion) {
      const now = Date.now();
      if (now - lastClawRefreshTs >= 2000) {
        lastClawRefreshTs = now;
        refreshAllClawStatus();
      }
    }
    // Poll task streams for dispatch/spawn progress
    for (const taskId of taskWatchMap.keys()) {
      pollTaskStream(taskId);
    }
    // Attach 不活跃计时：每 5 次 poll (≈1s) 刷新一次
    for (const [clawId, st] of attachedClaws) {
      st.pollTick++;
      if (st.pollTick >= 5) {
        st.pollTick = 0;
        // 重检契约状态（契约可能在 attach 之后才创建）
        const contractCreatedMs = getContractCreatedMs(st.clawDir);
        st.hasContract = contractCreatedMs !== null;
        if (st.hasContract && st.referenceMs === null) {
          const info = getClawActivityInfo(st.clawDir);
          st.referenceMs = Math.max(info.lastEventMs ?? 0, contractCreatedMs!) || null;
          st.lastError = info.lastError;
        }
      }
    }
    if (attachedClawId) {
      updateAttachedClawBar();
      tui.requestRender();
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
      } else if (name === 'attach') {
        if (!isMotion) {
          appendOutput(`\x1b[31m[attach] 仅 motion chat 支持 /attach\x1b[0m`);
        } else if (!parts[1]) {
          appendOutput(`\x1b[31m[attach] 用法：/attach <clawId>\x1b[0m`);
        } else {
          const clawId = parts[1];
          if (!fsNative.existsSync(path.join(clawsDir, clawId))) {
            appendOutput(`\x1b[31m[attach] claw "${clawId}" 不存在\x1b[0m`);
          } else {
            attachedClawId = clawId;
            // 创建或重置状态
            let st = attachedClaws.get(clawId);
            if (!st) {
              const clawDir = path.join(clawsDir, clawId);
              st = makeClawState(clawDir);
              attachedClaws.set(clawId, st);
            } else {
              // 重置现有状态
              st.referenceMs = null;
              st.hasContract = false;
              st.lastError = null;
              st.active = false;
              st.currentTool = null;
              st.textBuffer = '';
              st.lastInterrupted = false;
              st.toolSuccess = null; st.bufferType = null; st.lastOutput = ''; st.clearOnNextDelta = false;
            }
            // 读磁盘初始化
            const clawDir = path.join(clawsDir, clawId);
            const contractCreatedMs = getContractCreatedMs(clawDir);
            st.hasContract = contractCreatedMs !== null;
            if (st.hasContract) {
              const info = getClawActivityInfo(clawDir);
              st.lastError = info.lastError;
              st.referenceMs = Math.max(info.lastEventMs ?? 0, contractCreatedMs!) || null;
            }
            // 切换显示
            statusBar.setText('');
            updateAttachedClawBar();
            // 换成无 debounce watcher
            const attachStreamFile = path.join(clawsDir, clawId, 'stream.jsonl');
            clawWatchers.get(clawId)?.close();
            clawWatchers.delete(clawId);
            try {
              const w = fsNative.watch(attachStreamFile, { persistent: false }, () => refreshClawStatus(clawId));
              w.on('error', () => { w.close(); clawWatchers.delete(clawId); });
              clawWatchers.set(clawId, w);
            } catch { /* fallback to polling */ }
            appendOutput(`\x1b[2m[attach] attached to ${clawId}\x1b[0m`);
          }
        }
      } else if (name === 'detach') {
        if (attachedClawId) {
          const prev = attachedClawId;
          attachedClawId = null;
          attachedClawBar.setText('');
          updateStatusBar();
          // 移除无 debounce watcher，下次 refreshClawStatus 轮询时自动重建 debounce 版
          clawWatchers.get(prev)?.close();
          clawWatchers.delete(prev);
          appendOutput(`\x1b[2m[detach] detached from ${prev}\x1b[0m`);
        }
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
  tui.addChild(attachedClawBar);  // 默认空字符串 = 零高度
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

  /** 重连时从历史 stream 初始化自身状态（仅非 motion 调用） */
  const initOwnStateFromHistory = () => {
    if (isMotion) return;
    try {
      const stat = fsNative.statSync(streamPath);
      if (stat.size === 0) return;
      const buf = Buffer.alloc(stat.size);
      const fd = fsNative.openSync(streamPath, 'r');
      try {
        let read = 0;
        while (read < stat.size) {
          const n = fsNative.readSync(fd, buf, read, stat.size - read, read);
          if (n === 0) break;
          read += n;
        }
      } finally { fsNative.closeSync(fd); }
      const lines = buf.toString('utf-8').split('\n');
      lines.pop(); // 末尾不完整行
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'turn_start')       { ownTurnCount++; ownStep = 0; inTurn = true; }
          else if (ev.type === 'tool_result') { ownStep = ev.step ?? ownStep; ownMaxSteps = ev.maxSteps ?? ownMaxSteps; }
          else if (ev.type === 'turn_end' || ev.type === 'turn_interrupted' || ev.type === 'turn_error') {
            inTurn = false;
          }
        } catch { /* skip */ }
      }
    } catch { /* ENOENT 等 */ }
  };

  initOwnStateFromHistory();

  tui.start();

  // 启动时立即刷新 claw 状态（避免 2 秒等待）
  if (isMotion) {
    refreshClawStatus();
  }

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
  for (const w of clawWatchers.values()) w.close();
  clawWatchers.clear();
  for (const tw of taskWatchMap.values()) tw.watcher?.close();
  taskWatchMap.clear();
  tui.stop();
  await terminal.drainInput();
  process.stdin.pause();
}
