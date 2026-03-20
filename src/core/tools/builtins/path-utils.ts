/**
 * 路径解析工具 - 统一工具路径默认值为 clawspace/
 *
 * exec CWD = clawspace/，但 write/read/ls 路径基于 clawDir
 * 目标：裸路径（如 "output.txt"）自动落入 clawspace/
 */

// clawDir 根级别的"命名空间"，不自动加前缀
const ROOT_LEVEL_PATHS = [
  'MEMORY.md', 'AGENTS.md', 'SOUL.md',
  'memory/', 'prompts/', 'skills/',
  'inbox/', 'outbox/', 'tasks/',
  'logs/', 'contract/', 'clawspace/',
  'dialog/', 'status/', 'stream.jsonl', 'config.yaml',
];

/**
 * 解析路径，裸路径自动落入 clawspace/
 * @param filePath 原始路径
 * @returns 解析后的路径
 */
export function resolveClawspacePath(filePath: string): string {
  if (ROOT_LEVEL_PATHS.some(p => filePath === p.replace(/\/$/, '') || filePath.startsWith(p))) {
    return filePath;
  }
  return `clawspace/${filePath}`;
}
