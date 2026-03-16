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

  const bufRef = useRef(buffer);
  const posRef = useRef(cursorPos);
  const submitRef = useRef(options.onSubmit);
  const pasteRef = useRef(options.onPaste);

  bufRef.current = buffer;
  posRef.current = cursorPos;
  submitRef.current = options.onSubmit;
  pasteRef.current = options.onPaste;

  const updateBuffer = (b: string) => { bufRef.current = b; setBuffer(b); };
  const updatePos = (p: number) => { posRef.current = p; setCursorPos(p); };

  useInput((input, key) => {
    const buf = bufRef.current;
    const pos = posRef.current;

    if (key.return) {
      submitRef.current(buf);
      updateBuffer('');
      updatePos(0);
      return;
    }

    // Ctrl+D 空缓冲退出（标准 CLI 行为）
    if (key.ctrl && input === 'd' && buf.length === 0) {
      submitRef.current('exit');
      return;
    }

    if (key.backspace || key.delete) {
      if (pos > 0) {
        updateBuffer(buf.slice(0, pos - 1) + buf.slice(pos));
        updatePos(pos - 1);
      }
      return;
    }

    if (key.leftArrow) { updatePos(Math.max(0, pos - 1)); return; }
    if (key.rightArrow) { updatePos(Math.min(buf.length, pos + 1)); return; }
    if (key.ctrl && input === 'a') { updatePos(0); return; }
    if (key.ctrl && input === 'e') { updatePos(buf.length); return; }

    // 粘贴检测：多字符且含换行
    if (input && input.length > 1 && /[\r\n]/.test(input)) {
      const fullText = buf.slice(0, pos) + input + buf.slice(pos);
      updateBuffer('');
      updatePos(0);
      pasteRef.current(fullText.split(/\r\n|\r|\n/));
      return;
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta) {
      updateBuffer(buf.slice(0, pos) + input + buf.slice(pos));
      updatePos(pos + input.length);
    }
  }, { isActive: options.enabled });

  return { buffer, cursorPos };
}
