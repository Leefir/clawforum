import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export function editWithEditor(lines: string[]): string[] {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmpFile = path.join(os.tmpdir(), `clawforum_edit_${Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpFile, lines.join('\n'), 'utf-8');
    const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
    if (result.error) {
      console.error(`无法打开编辑器 ${editor}: ${result.error.message}`);
      return lines;
    }
    return fs.readFileSync(tmpFile, 'utf-8').split('\n');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
