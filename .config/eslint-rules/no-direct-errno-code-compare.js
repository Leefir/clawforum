/**
 * Custom ESLint rule: no-direct-errno-code-compare
 *
 * 应然：caller 必经 `isFileNotFound(err)` helper / `err instanceof FileNotFoundError`、
 * 不直比较 `err.code === 'ENOENT'` 字面。
 *
 * scope: src/ 全
 * allow-list: fs 抽象内部 + 业务字面 union + align 双 code check by-design
 *
 * phase 312 cluster C close 第 3 rule（替代 phase 223 grep ratchet）
 */

const ALLOW_LIST = [
  // fs 抽象内部 (helper 自身 + raw catch)
  'src/foundation/fs/types.ts',
  'src/foundation/fs/node-fs.ts',
  'src/foundation/fs/atomic.ts',
  // 业务字面 union (errno-code 业务字面 union 处理)
  'src/foundation/snapshot/git-errors.ts',
  'src/foundation/transport/unix-socket.ts',
  'src/foundation/process-exec/process-starttime.ts',
  'src/foundation/process-exec/find-by-pattern.ts',
  // 已 align 双 code check (FS_NOT_FOUND + ENOENT 同 union by-design)
  'src/foundation/messaging/inbox-reader.ts',
  'src/foundation/messaging/inbox-writer.ts',
  'src/foundation/audit/writer.ts',
  'src/foundation/audit/batched-writer.ts',
  'src/foundation/dialog-store/restore.ts',
  'src/foundation/dialog-store/store.ts',
  'src/foundation/process-manager/alive.ts',
  'src/foundation/process-manager/lock.ts',
  'src/foundation/process-manager/pid.ts',
  'src/foundation/process-manager/ready.ts',
  'src/foundation/process-manager/spawn.ts',
  'src/core/evolution-system/system.ts',
  'src/core/contract/lock.ts',
  'src/core/runtime/runtime.ts',
  'src/core/status-service/aggregators.ts',
  'src/core/async-task-system/system.ts',
  'src/cli/commands/claw-health.ts',
  'src/cli/commands/claw-outbox.ts',
  'src/cli/commands/claw-trace.ts',
  'src/daemon/daemon-loop.ts',
  'src/watchdog/watchdog-utils.ts',
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'caller 必经 isFileNotFound helper / instanceof FileNotFoundError、不直比较 err.code === ENOENT 字面（除 allow-list by-design）',
      category: 'Best Practices',
    },
    schema: [],
    messages: {
      directErrnoCompare: 'Direct .code === ENOENT compare detected. Use isFileNotFound helper or instanceof FileNotFoundError.',
    },
  },

  create(context) {
    const filename = context.filename;

    // allow-list（相对 path endsWith 匹配，兼容绝对 path 与 RuleTester 相对 path）
    if (ALLOW_LIST.some(p => filename.endsWith(p))) return {};

    return {
      BinaryExpression(node) {
        // pattern: `<expr>.code === 'ENOENT'` / `<expr>.code !== 'ENOENT'`
        if (node.operator !== '===' && node.operator !== '!==') return;

        // 左右各试一次（caller 可能 'ENOENT' === err.code 反写）
        const checkSide = (codeSide, literalSide) => {
          if (codeSide.type !== 'MemberExpression') return false;
          if (codeSide.property.type !== 'Identifier' || codeSide.property.name !== 'code') return false;
          if (literalSide.type !== 'Literal' || literalSide.value !== 'ENOENT') return false;
          return true;
        };

        if (checkSide(node.left, node.right) || checkSide(node.right, node.left)) {
          context.report({ node, messageId: 'directErrnoCompare' });
        }
      },
    };
  },
};
