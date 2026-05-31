#!/bin/sh
# scripts/migrate-claw-done-to-submit-subtask.sh
#
# phase 773 Step C: patch 存量 claw AGENTS.md 内 contract-done refs
# 工具名 phase 765 改 done → submit_subtask，本 script 同步存量数据
#
# 安全前提（per phase 773 总览 §2.4 加 Step A §4.4）：
# - 全 claw AGENTS.md 内 `\bdone\b` word boundary 11 distinct context 全 contract 工具语义
# - 0 status enum，0 其他语义混入
# - perl 替换 0 false positive

set -e

cd "$(git rev-parse --show-toplevel)"

CLAWS_DIR=".chestnut/claws"

if [ ! -d "$CLAWS_DIR" ]; then
  echo "❌ $CLAWS_DIR not found (run from chestnut repo root)"
  exit 1
fi

count=0
for f in "$CLAWS_DIR"/*/AGENTS.md; do
  if [ ! -f "$f" ]; then continue; fi
  if grep -qE '\bdone\b' "$f"; then
    perl -pi -e 's/\bdone\b/submit_subtask/g' "$f"
    count=$((count + 1))
    echo "✅ patched: $f"
  fi
done

echo ""
echo "📊 patched $count claw AGENTS.md file(s)"
echo "💡 run \`git diff $CLAWS_DIR\` (or compare manually since $CLAWS_DIR is gitignored)"
echo "💡 重启 claw daemons 加 LLM 加载新 AGENTS.md"
