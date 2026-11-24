/**
 * 归一化文档 → 单文件自包含 HTML。
 *
 * 目标：双击就能在浏览器打开、能直接发给别人、深浅色都好看。
 * 因此不依赖 DSH 主题变量，样式与配色全部内联在自己这一套变量里。
 */

import { formatTime } from './read-session.js'
import { escapeHtml, markdownToHtml } from './md-to-html.js'

/** 导出文件自带的样式表（浅色为默认，深色走 prefers-color-scheme）。 */
const STYLE = `
:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --bg-code: #1f2430;
  --fg: #1c1f24;
  --fg-soft: #5c6673;
  --fg-code: #e6edf3;
  --line: #e3e6ea;
  --brand: #2f6fdb;
  --accent-user: #eef3fe;
  --accent-user-line: #c9daf9;
  --accent-tool: #f3f5f7;
  --danger: #c0392b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d;
    --bg-soft: #1d2027;
    --bg-code: #0f1216;
    --fg: #e6e8ec;
    --fg-soft: #9aa4b2;
    --fg-code: #d8e1ea;
    --line: #2b3038;
    --brand: #6ea8ff;
    --accent-user: #1b2433;
    --accent-user-line: #2b3d59;
    --accent-tool: #1a1d23;
    --danger: #ff7b6b;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.doc { max-width: 900px; margin: 0 auto; padding: 40px 24px 96px; }
.doc-title { font-size: 28px; line-height: 1.3; margin: 0 0 16px; letter-spacing: -0.01em; }
.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--fg-soft);
}
.meta dt { font-weight: 600; }
.meta dd { margin: 0; word-break: break-all; }
.rule { height: 1px; background: var(--line); border: 0; margin: 28px 0; }
.turn { margin: 0 0 28px; }
.turn-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--fg-soft);
  margin: 0 0 10px;
}
.turn-head .badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 6px;
  background: var(--bg-soft); font-size: 12px;
}
.turn.user {
  background: var(--accent-user);
  border: 1px solid var(--accent-user-line);
  border-radius: 12px;
  padding: 16px 18px;
}
.turn.user .turn-head { color: var(--fg); }
.turn.assistant .body { }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.turn p, .appendix p { margin: 0 0 14px; }
.turn h1, .turn h2, .turn h3, .turn h4, .turn h5, .turn h6 { line-height: 1.35; margin: 22px 0 10px; }
.turn h1 { font-size: 22px; } .turn h2 { font-size: 19px; } .turn h3 { font-size: 17px; }
.turn h4, .turn h5, .turn h6 { font-size: 16px; }
.turn a { color: var(--brand); }
.turn ul, .turn ol { margin: 0 0 14px; padding-left: 24px; }
.turn li { margin: 4px 0; }
.turn blockquote {
  margin: 0 0 14px; padding: 2px 14px;
  border-left: 3px solid var(--line); color: var(--fg-soft);
}
.turn code {
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: 4px;
  padding: 1px 5px; font-size: 0.9em;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace;
}
pre {
  background: var(--bg-code); color: var(--fg-code);
  border-radius: 10px; padding: 14px 16px; overflow-x: auto;
  font-size: 13px; line-height: 1.55; margin: 0 0 14px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace;
}
/* 代码块里的 code 必须完全透明：上面 .turn code 的选择器权重 (0,1,1) 高于
   pre code 的 (0,0,2)，不显式抬到 (0,1,2) 就会被行内代码的浅色底覆盖，
   变成「白底 + 代码块的浅色前景」，代码整段看不见。 */
.doc pre code, .turn pre code {
  background: none; border: 0; padding: 0;
  color: inherit; font-size: inherit;
}
.table-wrap { overflow-x: auto; margin: 0 0 14px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: var(--bg-soft); font-weight: 600; }
hr { height: 1px; background: var(--line); border: 0; margin: 22px 0; }
details {
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; margin: 0 0 14px; background: var(--bg-soft);
}
details > summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--fg-soft); }
details[open] > summary { margin-bottom: 10px; }
details > *:last-child { margin-bottom: 0; }
details pre { background: var(--bg-code); }
.tool { margin: 0 0 22px; padding: 14px 16px; background: var(--accent-tool); border-radius: 12px; }
.tool-name {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; margin: 0 0 10px;
  font-family: "JetBrains Mono", Consolas, monospace;
}
.tool-name .err { color: var(--danger); }
.tool-note { font-size: 12px; color: var(--fg-soft); margin: 0 0 10px; }
.appendix { margin-top: 40px; }
.appendix h2 { font-size: 18px; margin: 28px 0 12px; }
.footer { margin-top: 48px; font-size: 12px; color: var(--fg-soft); }
`

/**
 * 渲染文档头。
 * @param {object} document 归一化文档。
 * @returns {string} HTML 片段。
 */
function renderHead(document) {
  const { meta, counts } = document
  const rows = [
    ['会话', `<code>${escapeHtml(meta.id)}</code>`],
  ]
  const started = formatTime(meta.createdAt)
  if (started !== '') rows.push(['开始', escapeHtml(started)])
  if (meta.model !== '') rows.push(['模型', `<code>${escapeHtml(meta.model)}</code>`])
  if (meta.cwd !== '') rows.push(['目录', `<code>${escapeHtml(meta.cwd)}</code>`])
  rows.push([
    '统计',
    escapeHtml(`用户 ${counts.user} · 助手 ${counts.assistant} · 工具 ${counts.tool}`),
  ])
  const items = rows.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('')
  return `<header><h1 class="doc-title">${escapeHtml(meta.title)}</h1><dl class="meta">${items}</dl></header>`
}

/**
 * 渲染一条工具调用。
 * @param {object} item 工具条目。
 * @returns {string} HTML 片段。
 */
function renderTool(item) {
  const parts = []
  parts.push(
    `<div class="tool-name"><span>🔧 ${escapeHtml(item.name)}</span>${
      item.isError ? '<span class="err">调用失败</span>' : ''
    }</div>`,
  )
  if (item.attachments > 0) {
    parts.push(`<p class="tool-note">该步附带 ${item.attachments} 个图片/文件，未导出。</p>`)
  }
  if (item.arguments.trim() !== '') {
    let pretty = item.arguments
    try {
      pretty = JSON.stringify(JSON.parse(item.arguments), null, 2)
    } catch {
      // 参数不是合法 JSON 时保留原文。
    }
    parts.push(
      `<details><summary>参数</summary><pre><code>${escapeHtml(pretty)}</code></pre></details>`,
    )
  }
  if (item.result !== '' || item.isError) {
    const tail = item.resultTruncated
      ? `\n\n…（已截断，原始 ${item.resultOriginalLength} 字符）`
      : ''
    parts.push(
      `<details><summary>结果</summary><pre><code>${escapeHtml(item.result + tail)}</code></pre></details>`,
    )
  }
  return `<div class="tool">${parts.join('')}</div>`
}

/**
 * 渲染助手条目。
 * @param {object} item 助手条目。
 * @param {boolean} withReasoning 是否包含思考过程。
 * @returns {string} HTML 片段。
 */
function renderAssistant(item, withReasoning) {
  const badge = []
  if (item.usage) {
    badge.push(`in ${item.usage.inputTokens ?? '?'} / out ${item.usage.outputTokens ?? '?'} tok`)
  }
  if (item.interrupted) badge.push('被中断')
  const meta = badge.length > 0 ? ` <span class="badge">${escapeHtml(badge.join(' · '))}</span>` : ''

  const parts = [`<div class="turn-head"><span>🤖 助手</span>${meta}</div>`]
  if (withReasoning && item.reasoning !== '') {
    parts.push(
      `<details><summary>💭 思考过程</summary>${markdownToHtml(item.reasoning)}</details>`,
    )
  }
  if (item.text !== '') parts.push(`<div class="body">${markdownToHtml(item.text)}</div>`)
  return `<section class="turn assistant">${parts.join('')}</section>`
}

/**
 * 渲染附录（仅模型配置）。
 *
 * 系统提示词不再导出：它是 Harness 自己的运行时资产，对读文档的人没有价值，
 * 而且体积很大（几万字符），会把真正要看的对话压下去。
 *
 * @param {object} document 归一化文档。
 * @returns {string} HTML 片段。
 */
function renderAppendix(document) {
  const parts = []
  if (document.meta.config) {
    parts.push(
      `<h2>模型配置</h2><pre><code>${escapeHtml(
        JSON.stringify(document.meta.config, null, 2),
      )}</code></pre>`,
    )
  }
  if (parts.length === 0) return ''
  return `<section class="appendix">${parts.join('')}</section>`
}

/**
 * 把文档渲染成完整的 HTML 文件。
 * @param {object} document `buildDocument` 的产物。
 * @param {{mode?: 'dialog'|'trajectory'}} options 渲染选项。
 * @returns {string} 完整 HTML 文本。
 */
export function renderHtml(document, options = {}) {
  const mode = options.mode === 'trajectory' ? 'trajectory' : 'dialog'
  const withReasoning = mode === 'trajectory'

  const blocks = [renderHead(document), '<hr class="rule">']
  for (const item of document.items) {
    if (item.kind === 'user') {
      blocks.push(
        `<section class="turn user"><div class="turn-head"><span>👤 我</span>` +
          `${formatTime(item.time) !== '' ? `<span class="badge">${escapeHtml(formatTime(item.time))}</span>` : ''}` +
          `</div><div class="body">${markdownToHtml(item.text)}</div></section>`,
      )
      continue
    }
    if (item.kind === 'assistant') {
      blocks.push(renderAssistant(item, withReasoning))
      continue
    }
    if (item.kind === 'tool') {
      if (mode !== 'trajectory') continue
      blocks.push(renderTool(item))
    }
  }
  if (mode === 'trajectory') blocks.push(renderAppendix(document))

  const tail =
    document.skippedInjected > 0
      ? `<p class="footer">已省略 ${document.skippedInjected} 条注入到会话历史的非用户消息（审批通知、运行时快照、技能目录、记忆召回等）。</p>`
      : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.meta.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="doc">
${blocks.filter(Boolean).join('\n')}
${tail}
</main>
</body>
</html>`
}
