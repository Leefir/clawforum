import { useState, useCallback } from 'react';
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

  useInput((input, key) => {
    if (key.return) {
      options.onSubmit(buffer);
      setBuffer('');
      setCursorPos(0);
      return;
    }

    if (key.backspace) {
      if (cursorPos > 0) {
        setBuffer(b => b.slice(0, cursorPos - 1) + b.slice(cursorPos));
        setCursorPos(p => p - 1);
      }
      return;
    }

    if (key.delete) {
      setBuffer(b => b.slice(0, cursorPos) + b.slice(cursorPos + 1));
      return;
    }

    if (key.leftArrow) {
      setCursorPos(p => Math.max(0, p - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos(p => Math.min(buffer.length, p + 1));
      return;
    }

    // ctrl+a → 行首, ctrl+e → 行尾（emacs 风格）
    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursorPos(buffer.length);
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
      setBuffer(b => b.slice(0, cursorPos) + input + b.slice(cursorPos));
      setCursorPos(p => p + input.length);
    }
  }, { isActive: options.enabled });

  return { buffer, cursorPos };
}
