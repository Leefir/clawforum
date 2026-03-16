import { useState, useRef } from 'react';
import { useInput } from 'ink';

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
  // useRef 持有最新值，避免 useInput 闭包中 stale state
  const bufRef = useRef(buffer);
  const posRef = useRef(cursorPos);

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
    const buf = bufRef.current;
    const pos = posRef.current;

    if (key.return) {
      options.onSubmit(buf);
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

    // 普通字符输入（含粘贴）
    if (input && !key.ctrl && !key.meta) {
      // 粘贴检测：input 含换行符 → 多行粘贴
      if (input.includes('\n') || input.includes('\r')) {
        const lines = input.split(/\r?\n/);
        if (lines.length > 1) {
          options.onPaste(lines);
          return;
        }
      }
      // 单字符/单行输入
      updateBuffer(buf.slice(0, pos) + input + buf.slice(pos));
      updatePos(pos + input.length);
    }
  }, { isActive: options.enabled });

  return { buffer, cursorPos };
}
