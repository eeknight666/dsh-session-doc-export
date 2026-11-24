/**
 * 归一化文档 → Markdown。
 *
 * 两个档位：
 * - `dialog`：只留真人输入和助手正文，像聊天记录，适合发人。
 * - `trajectory`：再加思考过程、工具参数与结果、模型配置。
 *
 * 两档都不导出系统提示词（见 appendix 的说明）。
 */

import { formatTime } from './read-session.js'

/**
 * 生成一段能安全包裹任意内容的反引号围栏。
 * 内容里如果自带 ``` 就加长围栏，避免提前闭合。
 * @param {string} content 代码内容。
 * @returns {string} 至少三反引号的围栏序列。
 */
function fence(content) {
  let longest = 0
  const runs = String(content ?? '').match(/`+/g)
  if (runs) for (const run of runs) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * 把任意文本包成安全的代码块。
 * @param {string} content 内容。
 * @param {string} language 语言标记（可为空）。
 * @returns {string} Markdown 代码块。
 */
function codeBlock(content, language = '') {
  const marks = fence(content)
  return `${marks}${language}\n${content}\n${marks}`
}

/**
 * 渲染元信息引用块。
 * @param {object} document 归一化文档。
 * @returns {string[]} Markdown 行。
 */
function metaBlock(document) {
  const { meta, counts } = document
  const lines = ['> **会话** `' + meta.id + '`  ']
  const started = formatTime(meta.createdAt)
  if (started !== '') lines.push(`> **开始** ${started}  `)
  if (meta.model !== '') lines.push(`> **模型** \`${meta.model}\`  `)
  if (meta.cwd !== '') lines.push(`> **目录** \`${meta.cwd}\`  `)
  lines.push(`> **条数** 用户 ${counts.user} · 助手 ${counts.assistant} · 工具 ${counts.tool}`)
  return lines
}

/**
 * 渲染一条工具调用。
 * @param {object} item 工具条目。
 * @returns {string[]} Markdown 行。
 */
function renderTool(item) {
  const lines = []
  const mark = item.isError ? ' ❌' : ''
  lines.push(`#### 🔧 \`${item.name}\`${mark}`, '')

  if (item.arguments.trim() !== '') {
    let pretty = item.arguments
    try {
      pretty = JSON.stringify(JSON.parse(item.arguments), null, 2)
    } catch {
      // 参数不是合法 JSON 时保留原文。
    }
    lines.push('<details><summary>参数</summary>', '', codeBlock(pretty, 'json'), '', '</details>', '')
  }

  if (item.attachments > 0) {
    lines.push(`_（该步附带 ${item.attachments} 个图片/文件，未导出）_`, '')
  }

  if (item.result !== '' || item.isError) {
    const tail = item.resultTruncated
      ? `\n\n…（已截断，原始 ${item.resultOriginalLength} 字符）`
      : ''
    lines.push(
      '<details><summary>结果</summary>',
      '',
      codeBlock(`${item.result}${tail}`),
      '',
      '</details>',
      '',
    )
  }
  return lines
}

/**
 * 渲染助手条目。
 * @param {object} item 助手条目。
 * @param {{withReasoning: boolean, withTime: boolean}} options 渲染选项。
 * @returns {string[]} Markdown 行。
 */
function renderAssistant(item, options) {
  const head = ['🤖 助手']
  const parts = []
  if (options.withTime) {
    const at = formatTime(item.time)
    if (at !== '') parts.push(at.slice(11))
  }
  if (item.usage) {
    const input = item.usage.inputTokens ?? '?'
    const output = item.usage.outputTokens ?? '?'
    parts.push(`in ${input} / out ${output} tok`)
  }
  if (item.interrupted) parts.push('被中断')
  if (parts.length > 0) head.push(parts.join(' · '))

  const lines = [`### ${head.join(' · ')}`, '']
  if (options.withReasoning && item.reasoning !== '') {
    lines.push('<details><summary>💭 思考过程</summary>', '', item.reasoning, '', '</details>', '')
  }
  if (item.text !== '') lines.push(item.text, '')
  return lines
}

/**
 * 渲染附录（仅模型配置）。
 *
 * 系统提示词不再导出：对读文档的人没有价值，而且几万字符会把正文压下去。
 *
 * @param {object} document 归一化文档。
 * @returns {string[]} Markdown 行。
 */
function appendix(document) {
  const lines = []
  if (document.meta.config) {
    lines.push('---', '', '## 附录：模型配置', '', codeBlock(JSON.stringify(document.meta.config, null, 2), 'json'), '')
  }
  return lines
}

/**
 * 把文档渲染成 Markdown。
 * @param {object} document `buildDocument` 的产物。
 * @param {{mode?: 'dialog'|'trajectory'}} options 渲染选项。
 * @returns {string} Markdown 文本。
 */
export function renderMarkdown(document, options = {}) {
  const mode = options.mode === 'trajectory' ? 'trajectory' : 'dialog'
  const withReasoning = mode === 'trajectory'
  const withTime = mode === 'trajectory'
  const sentence = mode === 'trajectory' ? '（含轨迹）' : ''

  const lines = [`# ${document.meta.title}${sentence}`, '', ...metaBlock(document), '']
  lines.push('---', '')

  let previousKind = ''
  for (const item of document.items) {
    if (item.kind === 'tool') {
      if (mode !== 'trajectory') continue
      lines.push(...renderTool(item))
      previousKind = 'tool'
      continue
    }

    if (item.kind === 'user') {
      lines.push(`### 👤 我${withTime ? ` · ${formatTime(item.time)}` : ''}`, '', item.text, '')
      previousKind = 'user'
      continue
    }

    // 对话档只输出正文：纯思考、纯工具间隙的步骤直接跳过，避免留下成串空行。
    if (!withReasoning && item.text === '') continue

    // dialog 档把同一轮里连续的助手片段合并成一个段落，读起来才像一段对话。
    if (mode === 'dialog' && previousKind === 'assistant') {
      lines.push(item.text, '')
      continue
    }

    lines.push(...renderAssistant(item, { withReasoning, withTime }))
    previousKind = 'assistant'
  }

  if (mode === 'trajectory') lines.push(...appendix(document))
  if (document.skippedInjected > 0) {
    lines.push('---', '', `_（已省略 ${document.skippedInjected} 条注入到会话历史的非用户消息：审批通知、运行时快照、技能目录、记忆召回等。）_`, '')
  }
  return lines.join('\n')
}
