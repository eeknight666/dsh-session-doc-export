/**
 * 离线渲染自检：读 fixture.json，跑三个渲染器，把产物写到 test/out/。
 *
 * 不依赖 DSH 运行时，改完渲染逻辑随时能重跑：
 *   node _dsh-plugins\session-doc-export\test\render-check.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildDocument } from '../lib/read-session.js'
import { renderMarkdown } from '../lib/render-markdown.js'
import { renderHtml } from '../lib/render-html.js'
import { renderJson } from '../lib/render-json.js'
import { markdownToHtml } from '../lib/md-to-html.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixture.json')
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

const { header, events } = JSON.parse(readFileSync(fixturePath, 'utf8'))

const document = buildDocument(header, events, { truncateChars: 20000 })

console.log('元信息:', JSON.stringify(document.meta, null, 2))
console.log('统计:', JSON.stringify(document.counts))
console.log('省略的注入消息:', document.skippedInjected)
console.log('系统提示词条数:', document.systemPrompts.length)

const cases = [
  ['dialog.md', () => renderMarkdown(document, { mode: 'dialog' })],
  ['trajectory.md', () => renderMarkdown(document, { mode: 'trajectory' })],
  ['dialog.html', () => renderHtml(document, { mode: 'dialog' })],
  ['trajectory.html', () => renderHtml(document, { mode: 'trajectory' })],
  ['dialog.json', () => renderJson(document, { mode: 'dialog' })],
  ['trajectory.json', () => renderJson(document, { mode: 'trajectory' })],
]

for (const [name, produce] of cases) {
  const text = produce()
  writeFileSync(join(outDir, name), text, 'utf8')
  const bytes = Buffer.byteLength(text, 'utf8')
  console.log(`${name.padEnd(18)} ${String(bytes).padStart(8)} 字节  ${text.split('\n').length} 行`)
}

// 结构性断言：只检查档位差异，不依赖对话里的具体文字。
const dialogMd = renderMarkdown(document, { mode: 'dialog' })
const trajectoryMd = renderMarkdown(document, { mode: 'trajectory' })
const TOOL_HEADING = '#### 🔧 `'

if (dialogMd.includes(TOOL_HEADING)) throw new Error('dialog 档不应包含工具段落')
if (document.counts.tool > 0 && !trajectoryMd.includes(TOOL_HEADING)) {
  throw new Error('trajectory 档应包含工具段落')
}
if (document.counts.user > 0 && !dialogMd.includes('### 👤 我')) {
  throw new Error('对话档应包含用户消息')
}
if (document.skippedInjected === 0) throw new Error('本 fixture 应含被过滤的注入消息')
if (dialogMd.includes('<details><summary>💭')) throw new Error('dialog 档不应包含思考过程')

const dialogHtml = renderHtml(document, { mode: 'dialog' })
if (dialogHtml.includes('class="tool"')) throw new Error('dialog HTML 不应包含工具块')
if (!dialogHtml.startsWith('<!doctype html>')) throw new Error('HTML 应是完整文档')

const parsed = JSON.parse(renderJson(document, { mode: 'trajectory' }))
if (!Array.isArray(parsed.messages) || parsed.messages.length !== document.items.length) {
  throw new Error('JSON 轨迹档消息数应等于条目数')
}
const parsedDialog = JSON.parse(renderJson(document, { mode: 'dialog' }))
if (parsedDialog.messages.some((message) => message.kind === 'tool')) {
  throw new Error('JSON 对话档不应含工具条目')
}

// 系统提示词不再出现在任何产物里（它是运行时资产，挤占正文）。
// 用一份合成文档断言，避免 fixture 正文里恰好也写着「系统提示词」而误判。
const synthetic = {
  schema: 'dsh.session-doc.v1',
  meta: { id: 'synthetic', title: '合成文档', createdAt: 0, cwd: '', model: '', config: null },
  items: [],
  systemPrompts: [{ text: 'SYSTEM_PROMPT_SENTINEL', truncated: false, originalLength: 22 }],
  skippedInjected: 0,
  counts: { user: 0, assistant: 0, tool: 0 },
  eventCount: 0,
}
for (const [label, text] of [
  ['md/trajectory', renderMarkdown(synthetic, { mode: 'trajectory' })],
  ['html/trajectory', renderHtml(synthetic, { mode: 'trajectory' })],
  ['json/trajectory', renderJson(synthetic, { mode: 'trajectory' })],
]) {
  if (text.includes('SYSTEM_PROMPT_SENTINEL')) throw new Error(`${label} 不应导出系统提示词`)
}
if (JSON.stringify(JSON.parse(renderJson(synthetic, { mode: 'trajectory' }))).includes('systemPrompts')) {
  throw new Error('JSON 不应再输出 systemPrompts 字段')
}

// 代码块里的 code 不能被行内代码样式染成白底（否则浅色文字整段看不见）。
const trajectoryHtml = renderHtml(document, { mode: 'trajectory' })

// 代码块里的 code 不能被行内代码样式染成白底（否则浅色文字整段看不见）。
if (/\.turn code[\s\S]{0,200}background/.test(trajectoryHtml)) {
  // 有规则本身没问题，关键是必须有更高权重的 pre code 覆盖。
  if (!trajectoryHtml.includes('.doc pre code')) {
    throw new Error('pre 内的 code 缺少高权重覆盖，会被行内样式染成白底')
  }
}

// 多列表格必须渲染成真表格（旧实现只认单列表格，真实会话里全失配）。
const tableHtml = markdownToHtml(
  ['| 步骤 | 命令 |', '| --- | --- |', '| 1 | `docker rm -f abc` |'].join('\n'),
)
if (!tableHtml.includes('<table>')) throw new Error('多列表格应渲染成 <table>')
if (!tableHtml.includes('<th>步骤</th>')) throw new Error('表格表头丢失')
if (!tableHtml.includes('<td>1</td>')) throw new Error('表格单元格丢失')
if (markdownToHtml('这不是表格\n就用一列 | 竖线 |').includes('<table>')) {
  throw new Error('普通含竖线的段落不应被误判成表格')
}
console.log('\n断言通过。')
