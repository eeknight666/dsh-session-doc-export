/**
 * 精简 Markdown → HTML 片段转换。
 *
 * 只覆盖对话正文里真实出现的语法（标题、代码块、表格、列表、引用、粗斜体、
 * 行内代码、链接、分隔线）。遇到不认识的结构就按段落原样输出，宁可朴素也不出错。
 * 刻意不引入第三方依赖：插件要能离线打包进 profile。
 */

/**
 * 转义 HTML 特殊字符。
 * @param {string} text 原文。
 * @returns {string} 转义结果。
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 处理一行里的行内标记。
 * @param {string} text 已确认不含块级结构的单行文本。
 * @returns {string} HTML 片段。
 */
function inline(text) {
  // 先按行内代码切分，代码内容只转义、不再套用其他标记。
  const segments = String(text).split(/(`[^`\n]+`)/g)
  return segments
    .map((segment) => {
      if (segment.length >= 2 && segment.startsWith('`') && segment.endsWith('`')) {
        return `<code>${escapeHtml(segment.slice(1, -1))}</code>`
      }
      let html = escapeHtml(segment)
      html = html.replace(
        /!\[([^\]]*)\]\(([^)\s]+)\)/g,
        '<span class="md-image">[图片：$1]</span>',
      )
      html = html.replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
      )
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
      html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')
      html = html.replace(/(^|[\s(（])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      return html
    })
    .join('')
}

/**
 * 表格分隔行的判定：先按列拆开，再要求每个单元格都是 `---` / `:--` / `--:`。
 *
 * 早期实现拿整行做正则（`^\|?[\s:-]*-[\s:-]*\|?$`），只认单列表格，
 * 真实会话里 `| --- | --- |` 这种多列分隔行一律失配，
 * 结果全部表格退化成带竖线的普通段落。
 *
 * @param {string} line 疑似分隔行。
 * @returns {boolean} 是否是合法的表格分隔行。
 */
function isTableDivider(line) {
  const cells = splitRow(line)
  if (cells.length < 2) return false
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell))
}

/**
 * 把一行表格拆成单元格文本数组。
 * @param {string} line 表格行。
 * @returns {string[]} 单元格原文。
 */
function splitRow(line) {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  return body.split('|').map((cell) => cell.trim())
}

/**
 * 转换 Markdown 文本为 HTML 片段。
 * @param {string} markdown Markdown 正文。
 * @returns {string} HTML 片段。
 */
export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  /** @type {string[]|null} 当前打开的列表类型 */
  let listType = null
  let paragraph = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (listType === null) return
    out.push(`</${listType}>`)
    listType = null
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    // 代码围栏
    const fenceMatch = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line)
    if (fenceMatch) {
      flushAll()
      const marker = fenceMatch[1]
      const language = fenceMatch[2]
      const body = []
      index += 1
      while (index < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      const cls = language ? ` class="language-${escapeHtml(language)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    // 空行
    if (line.trim() === '') {
      flushAll()
      continue
    }

    // 分隔线
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll()
      out.push('<hr>')
      continue
    }

    // 标题
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`)
      continue
    }

    // 表格（当前行 + 下一行是分隔行）
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushAll()
      const head = splitRow(line)
      index += 1
      const rows = []
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim() !== '') {
        index += 1
        rows.push(splitRow(lines[index]))
      }
      const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join('')
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`)
      continue
    }

    // 引用
    if (/^\s{0,3}>\s?/.test(line)) {
      flushAll()
      const quoted = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      index -= 1
      out.push(`<blockquote>${markdownToHtml(quoted.join('\n'))}</blockquote>`)
      continue
    }

    // 列表
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const wanted = bullet ? 'ul' : 'ol'
      if (listType !== wanted) {
        flushList()
        out.push(`<${wanted}>`)
        listType = wanted
      }
      out.push(`<li>${inline((bullet ?? ordered)[1])}</li>`)
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushAll()
  return out.join('\n')
}
