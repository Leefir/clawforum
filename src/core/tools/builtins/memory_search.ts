/**
 * memory_search tool - Search in memory directory with metadata filtering
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import type { FileEntry } from '../../../foundation/fs/types.js';
import { parseFrontmatter } from '../../../utils/frontmatter.js';

export const memorySearchTool: ITool = {
  name: 'memory_search',
  description: '在 memory/ 目录中全文检索记忆文件。支持关键词搜索、文件名正则过滤、frontmatter元数据过滤。query 和 filter 至少一个必填。',
  schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '全文搜索关键词（大小写不敏感）',
      },
      pattern: {
        type: 'string',
        description: '文件名正则过滤，如 "2026.*\\.md"',
      },
      filter: {
        type: 'object',
        description: 'frontmatter 字段过滤，AND 逻辑，如 {"type":"feedback"}',
      },
      max_results: {
        type: 'number',
        description: '最大返回数（默认 10）',
      },
    },
    // query 和 filter 至少一个必填，用 description 约束而非 required
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const query = ((args.query as string) ?? '').toLowerCase().trim();
    const pattern = (args.pattern as string) ?? '';
    const metaFilter = (args.filter as Record<string, string>) ?? {};
    const maxResults = (args.max_results as number) ?? 10;

    // query 和 filter 至少一个必填
    if (!query && Object.keys(metaFilter).length === 0) {
      return {
        success: false,
        content: '错误: 必须提供 query 或 filter 参数',
      };
    }

    const results: string[] = [];
    const compiled = pattern ? new RegExp(pattern) : null;

    let entries: FileEntry[];
    try {
      entries = await ctx.fs.list('memory/', { recursive: true, includeDirs: false });
    } catch {
      return {
        success: true,
        content: 'memory/ 目录为空，暂无记忆可检索',
      };
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (!entry.path.endsWith('.md')) continue;

      const filename = entry.path.split('/').pop() ?? '';
      if (compiled && !compiled.test(filename)) continue;

      try {
        const text = await ctx.fs.read(entry.path);

        // frontmatter 元数据过滤
        if (Object.keys(metaFilter).length > 0) {
          const { meta } = parseFrontmatter(text);
          if (!metaMatches(meta, metaFilter)) continue;
        }

        if (query) {
          // 全文搜索，返回匹配行
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (lines[i].toLowerCase().includes(query)) {
              results.push(`[${entry.path}:${i + 1}] ${lines[i].trim()}`);
            }
          }
        } else {
          // 仅 filter 匹配时，返回文件路径
          results.push(`[${entry.path}] (元数据匹配)`);
        }
      } catch {
        // 跳过无法读取的文件
        continue;
      }
    }

    if (results.length === 0) {
      return {
        success: true,
        content: query ? `未找到包含「${query}」的记忆` : '未找到匹配的记忆',
      };
    }

    return {
      success: true,
      content: results.join('\n'),
    };
  },
};

/**
 * Check if frontmatter matches all filter criteria (AND logic)
 */
function metaMatches(fm: Record<string, string>, filter: Record<string, string>): boolean {
  return Object.entries(filter).every(([key, value]) =>
    (fm[key] ?? '').toLowerCase().includes(String(value).toLowerCase())
  );
}
