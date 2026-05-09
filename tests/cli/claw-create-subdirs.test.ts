import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { CLAW_SUBDIRS, CLAWS_DIR } from '../../src/types/paths.js';

describe('CLAW_SUBDIRS — 名实一致（per-claw 内子目录列表 / 不含 CLAWS_DIR 顶层容器）', () => {
  let tmpClawDir: string;

  beforeEach(() => {
    tmpClawDir = path.join(os.tmpdir(), `claw-${randomUUID()}`);
    fs.mkdirSync(tmpClawDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpClawDir)) {
      fs.rmSync(tmpClawDir, { recursive: true, force: true });
    }
  });

  it('mkdir 全 CLAW_SUBDIRS 后 <claw>/claws/ 不存在（CLAWS_DIR 不应在 list）', () => {
    for (const dir of CLAW_SUBDIRS) {
      fs.mkdirSync(path.join(tmpClawDir, dir), { recursive: true });
    }

    const ghostClawsDir = path.join(tmpClawDir, CLAWS_DIR);
    expect(fs.existsSync(ghostClawsDir)).toBe(false);
  });

  it('CLAW_SUBDIRS 不含 CLAWS_DIR（编译期 + 运行期 双核）', () => {
    expect((CLAW_SUBDIRS as readonly string[]).includes(CLAWS_DIR)).toBe(false);
  });

  it('mkdir 全 CLAW_SUBDIRS 后既有期望子目录全存在（回归核）', () => {
    for (const dir of CLAW_SUBDIRS) {
      fs.mkdirSync(path.join(tmpClawDir, dir), { recursive: true });
    }

    // 抽样 4 个核心 subdir 核存在（防过度 specifying）
    expect(fs.existsSync(path.join(tmpClawDir, 'dialog'))).toBe(true);
    expect(fs.existsSync(path.join(tmpClawDir, 'inbox/pending'))).toBe(true);
    expect(fs.existsSync(path.join(tmpClawDir, 'tasks/queues/pending'))).toBe(true);
    expect(fs.existsSync(path.join(tmpClawDir, 'clawspace'))).toBe(true);
  });
});
