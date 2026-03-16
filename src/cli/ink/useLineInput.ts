import { useState, useRef, useEffect } from 'react';
import { useInput, useStdin } from 'ink';

export interface UseLineInputOptions {
  onSubmit: (text: string) => void;
  onPaste: (lines: string[]) => void;
  enabled: boolean;
}

export interface LineInputState {
  buffer: string;
  cursorPos: number;
}

export function useLineInput(options: UseLineInputOptions): LineInputState {
  const [buffer, setBuffer] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  // useRef 持有最新值，避免 stale state
  const bufRef = useRef(buffer);
  const posRef = useRef(cursorPos);
  const submitRef = useRef(options.onSubmit);
  const pasteRef = useRef(options.onPaste);
  const pasteDetectedRef = useRef(false);

  // 同步更新 ref
  bufRef.current = buffer;
  posRef.current = cursorPos;
  submitRef.current = options.onSubmit;
  pasteRef.current = options.onPaste;

  const { stdin } = useStdin();

  // 粘贴检测：监听 raw stdin data 事件
  useEffect(() => {
    if (!options.enabled || !stdin) return;

    const onData = (data: Buffer) => {
      const str = data.toString();
      // 单次 data 含换行 = 粘贴（长度>1 排除单个回车）
      // 匹配 \r\n、\r、\n 三种换行（macOS 终端转换 \n 为 \r）
      const newlineCount = (str.match(/\r\n|\r|\n/g) || []).length;
      if (newlineCount >= 1 && str.length > 1) {
        pasteDetectedRef.current = true;
        const lines = str.split(/\r\n|\r|\n/);
        pasteRef.current(lines);
        // 延迟重置标志，跳过本次 useInput 的同步调用
        setTimeout(() => { pasteDetectedRef.current = false; }, 0);
      }
    };

    stdin.prependListener('data', onData);
    return () => { stdin.off('data', onData); };
  }, [stdin, options.enabled]);

  // 同步更新 ref + state
  const updateBuffer = (b: string) => {
    bufRef.current = b;
    setBuffer(b);
  };
  const updatePos = (p: number) => {
    posRef.current = p;
    setCursorPos(p);
  };

  useInput((input, key) => {
    // 如果刚检测到粘贴，跳过 useInput 的逐字符处理
    if (pasteDetectedRef.current) {
      return;
    }

    const buf = bufRef.current;
    const pos = posRef.current;

    if (key.return) {
      submitRef.current(buf);
      updateBuffer('');
      updatePos(0);
      return;
    }

    // 退格（macOS: \x7f → key.delete, Linux: \b → key.backspace）
    if (key.backspace || key.delete) {
      if (pos > 0) {
        updateBuffer(buf.slice(0, pos - 1) + buf.slice(pos));
        updatePos(pos - 1);
      }
      return;
    }

    if (key.leftArrow) {
      updatePos(Math.max(0, pos - 1));
      return;
    }

    if (key.rightArrow) {
      updatePos(Math.min(buf.length, pos + 1));
      return;
    }

    // ctrl+a → 行首, ctrl+e → 行尾（emacs 风格）
    if (key.ctrl && input === 'a') {
      updatePos(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      updatePos(buf.length);
      return;
    }

    // 普通字符输入（单行）
    if (input && !key.ctrl && !key.meta) {
      updateBuffer(buf.slice(0, pos) + input + buf.slice(pos));
      updatePos(pos + input.length);
    }
  }, { isActive: options.enabled });

  return { buffer, cursorPos };
}
