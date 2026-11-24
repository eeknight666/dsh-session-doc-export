/**
 * 会话事件 → 归一化文档。
 *
 * 这一层是纯函数：只吃 `{ header, events }`，不碰 DSH 运行时，
 * 因此可以脱离 Harness 单独跑测试（见 _dsh-plugins/session-doc-export/test/）。
 *
 * 三个必须处理的真实细节：
 * 1. `user/message` 的内容在 `data.content`，其他事件在 `data.message.content`。
 * 2. 日志里大量 `user/message` 的 `source.kind` 不是 `user`（审批通知、运行时快照、
 *    skill 目录、graph-memory 召回……），对话导出必须只保留真人输入。
 * 3. 事件流带 surface 语义：`surfaceOp: 'append'` 追加，`{op:'replace', startSeq, endSeq}`
 *    表示压缩把旧区间整段换掉。直接按顺序拼会把被删掉的内容也导出。
 */

/** 参与 surface 折叠的事件类型。 */
const SURFACE_TYPES = new Set([
  'system/message',
  'developer/message',
  'user/message',
  'assistant/message',
  'tool/result',
])

/**
 * 取事件的内容块数组。
 * @param {object} event 一条会话事件。
 * @returns {object[]} 内容块数组（可能为空）。
 */
export function contentBlocks(event) {
  const data = event.data ?? {}
  // user/message 的 data 就是消息本身，其余事件把消息包在 data.message 里。
  if (event.type === 'user/message') return Array.isArray(data.content) ? data.content : []
  const message = data.message
  return Array.isArray(message?.content) ? message.content : []
}

/**
 * 把内容块里的文本拼成一段。
 * @param {object[]} blocks 内容块数组。
 * @returns {string} 纯文本（已去首尾空白）。
 */
export function plainText(blocks) {
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

/**
 * 按 surface 语义折叠事件，得到"用户最终看到的那一版"消息序列。
 * @param {object[]} events 会话事件（按 seq 升序）。
 * @returns {object[]} 折叠后的事件。
 */
export function foldSurface(events) {
  /** @type {object[]} */
  const surface = []
  for (const event of events) {
    if (!SURFACE_TYPES.has(event.type)) continue
    const op = event.surfaceOp
    if (op === undefined || op === 'append') {
      surface.push(event)
      continue
    }
    if (op && op.op === 'replace') {
      const from = Number(op.startSeq)
      const to = Number(op.endSeq)
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let index = surface.length - 1; index >= 0; index -= 1) {
          const seq = Number(surface[index].seq)
          if (seq >= from && seq <= to) surface.splice(index, 1)
        }
      }
      // 替换动作本身携带新内容，折叠后要保留。
      surface.push(event)
    }
  }
  return surface
}

/**
 * 抽取会话元信息。
 * @param {object} header 会话头。
 * @param {object[]} events 会话事件。
 * @returns {{id: string, title: string, createdAt: number, cwd: string, model: string, config: object|null}}
 */
export function sessionMeta(header, events) {
  let title = ''
  for (const event of events) {
    if (event.type !== 'session/title') continue
    const data = event.data ?? {}
    const value = data.title ?? data.value ?? data.text
    if (typeof value === 'string' && value.trim() !== '') title = value.trim()
  }

  let model = ''
  let config = null
  for (const event of events) {
    if (event.type === 'request/context') {
      const data = event.data ?? {}
      const parts = [data.provider, data.model].filter(Boolean)
      if (parts.length > 0) model = parts.join(' / ')
    }
    if (event.type === 'request/header') {
      const headerConfig = event.data?.header?.config
      if (headerConfig && typeof headerConfig === 'object') config = headerConfig
    }
  }

  return {
    id: String(header.id ?? ''),
    title: title || '未命名会话',
    createdAt: Number(header.createdAt ?? 0),
    cwd: String(header.cwd ?? ''),
    model,
    config,
  }
}

/**
 * 抽取系统提示词（可能随会话中间发生过变更，取每一版的文本）。
 * @param {object[]} events 会话事件。
 * @returns {string[]} 每个不同系统提示词的文本，按出现顺序去重。
 */
export function systemPrompts(events) {
  const prompts = []
  for (const event of events) {
    if (event.type !== 'system/message') continue
    const text = plainText(contentBlocks(event))
    if (text !== '' && !prompts.includes(text)) prompts.push(text)
  }
  return prompts
}

/**
 * 截断长文本并附带说明，三种输出格式共用同一策略。
 * @param {string} text 原始文本。
 * @param {number} limit 允许的最大字符数；0 或负数表示不截断。
 * @returns {{text: string, truncated: boolean, originalLength: number}}
 */
export function clip(text, limit) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (!Number.isFinite(limit) || limit <= 0 || value.length <= limit) {
    return { text: value, truncated: false, originalLength: value.length }
  }
  return { text: value.slice(0, limit), truncated: true, originalLength: value.length }
}

/**
 * 把证据（tool/call 与 tool/result）配对成工具条目。
 * @param {object[]} events 会话事件。
 * @returns {Map<string, object>} callId → tool/call 事件。
 */
function indexToolCalls(events) {
  /** @type {Map<string, object>} */
  const calls = new Map()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const callId = event.data?.callId
    if (callId !== undefined) calls.set(String(callId), event)
  }
  return calls
}

/**
 * 把一条消息的时间戳格式化成 `YYYY-MM-DD HH:mm:ss`（本地时区）。
 * @param {number} time 毫秒时间戳。
 * @returns {string} 本地时间文本。
 */
export function formatTime(time) {
  const value = Number(time)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const pad = (part) => String(part).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * 构造归一化文档，三种输出格式都从这里取数据。
 * @param {object} header 会话头。
 * @param {object[]} events 会话事件。
 * @param {{truncateChars?: number}} options 渲染选项。
 * @returns {object} 归一化文档。
 */
export function buildDocument(header, events, options = {}) {
  const truncateChars = Number.isFinite(options.truncateChars) ? options.truncateChars : 20000
  const meta = sessionMeta(header, events)
  const surface = foldSurface(events)
  const calls = indexToolCalls(events)

  /** @type {object[]} */
  const items = []
  let skippedInjected = 0

  for (const event of surface) {
    if (event.type === 'user/message') {
      const kind = event.data?.source?.kind
      if (kind !== 'user') {
        skippedInjected += 1
        continue
      }
      const text = plainText(contentBlocks(event))
      if (text === '') continue
      items.push({ kind: 'user', time: Number(event.time ?? 0), text })
      continue
    }

    if (event.type === 'assistant/message') {
      const blocks = contentBlocks(event)
      const text = plainText(blocks)
      const reasoning = blocks
        .filter((block) => block?.type === 'reasoning' && typeof block.text === 'string')
        .map((block) => block.text.trim())
        .filter((chunk) => chunk !== '')
        .join('\n\n')
      if (text === '' && reasoning === '') continue
      const usage = event.data?.usage && typeof event.data.usage === 'object' ? event.data.usage : null
      items.push({
        kind: 'assistant',
        time: Number(event.time ?? 0),
        text,
        reasoning,
        usage,
        interrupted: event.data?.interrupted === true,
      })
      continue
    }

    if (event.type === 'tool/result') {
      const message = event.data?.message ?? {}
      const callId = String(message.toolCallId ?? '')
      const call = calls.get(callId)
      const blocks = Array.isArray(message.content) ? message.content : []
      const raw = plainText(blocks)
      const clipped = clip(raw, truncateChars)
      const attachments = blocks.filter(
        (block) => block?.type === 'image' || block?.type === 'file',
      ).length
      items.push({
        kind: 'tool',
        time: Number(event.time ?? 0),
        callId,
        name: typeof call?.data?.name === 'string' ? call.data.name : '未知工具',
        arguments: typeof call?.data?.arguments === 'string' ? call.data.arguments : '',
        result: clipped.text,
        resultTruncated: clipped.truncated,
        resultOriginalLength: clipped.originalLength,
        isError: message.isError === true,
        attachments,
        error: event.data?.error ?? null,
      })
    }
  }

  const prompts = systemPrompts(events)
  const counts = { user: 0, assistant: 0, tool: 0 }
  for (const item of items) counts[item.kind] += 1

  return {
    schema: 'dsh.session-doc.v1',
    meta,
    items,
    systemPrompts: prompts.map((prompt) => clip(prompt, truncateChars)),
    skippedInjected,
    counts,
    eventCount: events.length,
  }
}
