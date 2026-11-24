/**
 * 归一化文档 → JSON。
 *
 * 面向程序消费：字段稳定、结构扁平，不带任何渲染痕迹。
 */

/**
 * 把文档序列化成 JSON 文本。
 * @param {object} document `buildDocument` 的产物。
 * @param {{mode?: 'dialog'|'trajectory'}} options 渲染选项。
 * @returns {string} 缩进过的 JSON 文本。
 */
export function renderJson(document, options = {}) {
  const mode = options.mode === 'trajectory' ? 'trajectory' : 'dialog'
  const messages =
    mode === 'trajectory'
      ? document.items
      : document.items.filter((item) => item.kind !== 'tool')

  const payload = {
    schema: document.schema,
    mode,
    meta: document.meta,
    counts: document.counts,
    eventCount: document.eventCount,
    skippedInjected: document.skippedInjected,
    messages,
  }
  // 不再输出 systemPrompts：它是 Harness 的运行时资产，导出文件只承载会话内容。
  return JSON.stringify(payload, null, 2)
}
