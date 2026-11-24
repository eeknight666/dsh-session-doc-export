/**
 * Session 文档导出 —— Client 半。
 *
 * 在会话页右上角的操作区加一个「导出」按钮，点开后选格式与档位；
 * 选「选择会话…」会打开一个独立浮层，列出本机会话供逐条勾选。
 *
 * 刻意不 import 任何 Harness Client 包（primitives 等）：
 * 按钮、面板、浮层、样式全部自己实现，只用 React 与主题 CSS 变量。
 * 浮层用 `react-dom` 的 createPortal 挂到 body，避免被会话头部的
 * overflow / transform 裁掉；拿不到 react-dom 时退回原地渲染。
 */

window.__ModuleLoader__.load({
  id: '@local/session-doc-export',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 能 portal 就 portal；宿主没给 react-dom 时退回原地渲染。 */
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (typeof ReactDOM?.createPortal === 'function') createPortal = ReactDOM.createPortal
    } catch {
      // 没有 react-dom：浮层仍然可用，只是可能被祖先样式裁切。
    }

    /** Client 半的 locale 命名空间。 */
    const NS = 'session-doc-export'
    /** 下载路由，与 Host 半的 EXPORT_PATH 一致。 */
    const ROUTE = 'api/session.export-doc'
    /** 注入样式用的固定 id，HMR 重载时避免重复插入。 */
    const STYLE_ID = 'session-doc-export-style'

    const CSS = `
.sde-root { position: relative; display: inline-flex; flex: none; }
.sde-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.sde-btn:hover, .sde-btn[aria-expanded="true"] {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.sde-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sde-btn svg { width: 15px; height: 15px; display: block; }
.sde-panel {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
  width: 254px; padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
  font-size: 13px; line-height: 1.5;
}
.sde-group + .sde-group { margin-top: 10px; }
.sde-label {
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary); margin-bottom: 5px;
}
.sde-options { display: flex; flex-wrap: wrap; gap: 4px; }
.sde-opt {
  flex: 1 1 auto; min-width: 62px; padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font-size: 12px; cursor: pointer; transition: border-color .12s ease, background-color .12s ease;
}
.sde-opt:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-opt[aria-pressed="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary); font-weight: 600;
}
.sde-submit {
  width: 100%; margin-top: 12px; padding: 7px 10px;
  border: 0; border-radius: 6px; cursor: pointer;
  background: var(--dsw-alias-brand-primary); color: #fff;
  font-size: 13px; font-weight: 600;
}
.sde-submit:disabled { opacity: .55; cursor: default; }
.sde-error {
  margin-top: 8px; font-size: 12px; line-height: 1.45;
  color: var(--dsw-alias-state-error-primary); word-break: break-word;
}
.sde-hint { margin-top: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }

.sde-backdrop { position: fixed; inset: 0; z-index: 95; background: rgba(0, 0, 0, .34); }
.sde-dialog {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 96;
  width: min(560px, calc(100vw - 32px)); max-height: min(600px, calc(100vh - 64px));
  display: flex; flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 52px rgba(0, 0, 0, .3);
  font-size: 13px; line-height: 1.5; overflow: hidden;
}
.sde-dialog-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 8px; font-weight: 600; font-size: 13px;
}
.sde-close {
  border: 0; background: transparent; cursor: pointer; flex: none;
  color: var(--dsw-alias-label-secondary); font-size: 18px; line-height: 1;
  padding: 0 6px; border-radius: 4px;
}
.sde-close:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-toolbar { display: flex; gap: 6px; padding: 0 14px 8px; }
.sde-search {
  flex: 1 1 auto; min-width: 0; padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font-size: 12px;
}
.sde-search:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.sde-mini {
  flex: none; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px; background: transparent; color: inherit;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.sde-mini:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-list { flex: 1 1 auto; overflow: auto; padding: 0 8px 8px; min-height: 140px; }
.sde-group { margin-bottom: 6px; }
.sde-group-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 6px; border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600;
  font-family: inherit; text-align: left; cursor: pointer;
}
.sde-group-head:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-caret { flex: none; width: 10px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.sde-group-name {
  flex: 0 1 auto; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sde-group-count {
  flex: none; font-weight: 400; font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.sde-group-pick {
  flex: none; margin-left: auto; padding: 2px 7px; border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 400;
  font-family: inherit; cursor: pointer; white-space: nowrap;
}
.sde-group-pick:hover { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.sde-row {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 6px; border-radius: 6px; cursor: pointer;
}
.sde-row:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-row input { margin: 3px 0 0; flex: none; cursor: pointer; }
.sde-row-body { min-width: 0; flex: 1 1 auto; }
.sde-row-title {
  font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sde-row-title.is-empty { color: var(--dsw-alias-label-secondary); font-style: italic; }
.sde-row-meta {
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;
}
.sde-tag { padding: 0 4px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); }
.sde-note { padding: 4px 14px 14px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sde-note.is-error { color: var(--dsw-alias-state-error-primary); }
.sde-dialog-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.sde-count { flex: 1 1 auto; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sde-action {
  flex: none; padding: 6px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 12px;
}
.sde-action:hover { background: var(--dsw-alias-bg-layer-2); }
.sde-action.is-primary {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary); color: #fff; font-weight: 600;
}
.sde-action.is-primary:disabled { opacity: .55; cursor: default; }
`

    /** 内置中英文文案。 */
    const zh = {
      'button.label': '导出对话',
      'panel.format': '格式',
      'panel.mode': '内容',
      'panel.scope': '范围',
      'format.md': 'Markdown',
      'format.html': 'HTML',
      'format.json': 'JSON',
      'mode.dialog': '仅对话',
      'mode.trajectory': '对话 + 轨迹',
      'scope.session': '当前会话',
      'scope.pick': '选择会话…',
      'scope.picked': '已选',
      'scope.unit': '个',
      'panel.submit': '导出',
      'panel.busy': '正在导出…',
      'panel.hint': 'Markdown 适合发人，HTML 双击可看，JSON 给程序读。',
      'panel.hint.picked': '选中的会话会打包成一个 ZIP，每个会话一个文件。',
      'picker.title': '选择要导出的会话',
      'picker.search': '搜索标题或 id',
      'picker.all': '全选',
      'picker.clear': '清空',
      'picker.cancel': '取消',
      'picker.confirm': '导出选中',
      'picker.loading': '正在读取会话列表…',
      'picker.titles': '正在补充标题…',
      'picker.empty': '没有匹配的会话',
      'picker.empty.hint': '换一个关键词试试',
      'picker.total': '共',
      'picker.untitled': '（未命名会话）',
      'picker.subagent': '子 Agent',
      'picker.live': '进行中',
      'picker.other': '其他工作区',
      'picker.noworkspace': '（未记录工作区）',
      'picker.group.all': '全选',
      'picker.group.clear': '取消全选',
      'picker.group.picked': '已选',
      'picker.failed': '读取会话列表失败',
      'error.failed': '导出失败',
      'error.noselection': '还没有勾选任何会话',
    }
    const en = {
      'button.label': 'Export conversation',
      'panel.format': 'Format',
      'panel.mode': 'Content',
      'panel.scope': 'Scope',
      'format.md': 'Markdown',
      'format.html': 'HTML',
      'format.json': 'JSON',
      'mode.dialog': 'Conversation',
      'mode.trajectory': 'With trajectory',
      'scope.session': 'This session',
      'scope.pick': 'Pick sessions…',
      'scope.picked': 'picked',
      'scope.unit': '',
      'panel.submit': 'Export',
      'panel.busy': 'Exporting…',
      'panel.hint': 'Markdown for sharing, HTML for double-click reading, JSON for tooling.',
      'panel.hint.picked': 'Picked sessions are packed into one ZIP, one file per session.',
      'picker.title': 'Pick sessions to export',
      'picker.search': 'Filter by title or id',
      'picker.all': 'All',
      'picker.clear': 'None',
      'picker.cancel': 'Cancel',
      'picker.confirm': 'Export picked',
      'picker.loading': 'Loading sessions…',
      'picker.titles': 'Fetching titles…',
      'picker.empty': 'No matching session',
      'picker.empty.hint': 'Try another keyword',
      'picker.total': 'total',
      'picker.untitled': '(untitled session)',
      'picker.subagent': 'subagent',
      'picker.live': 'live',
      'picker.other': 'other workspace',
      'picker.noworkspace': '(no workspace)',
      'picker.group.all': 'all',
      'picker.group.clear': 'clear',
      'picker.group.picked': 'picked',
      'picker.failed': 'Failed to load sessions',
      'error.failed': 'Export failed',
      'error.noselection': 'No session picked yet',
    }

    /**
     * 从 Content-Disposition 里取 UTF-8 文件名。
     * @param {string|null} header 响应头。
     * @returns {string|null} 文件名。
     */
    function parseFilename(header) {
      if (typeof header !== 'string' || header === '') return null
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
      if (encoded) {
        try {
          return decodeURIComponent(encoded[1].trim())
        } catch {
          // 编码损坏时退回 ASCII 形式。
        }
      }
      const plain = /filename="([^"]+)"/i.exec(header)
      return plain ? plain[1] : null
    }

    /**
     * 时间戳 → `YYYY-MM-DD HH:mm`（本地时区）。
     * @param {number} time 毫秒时间戳。
     * @returns {string} 时间文本；非法输入返回空串。
     */
    function formatTime(time) {
      const value = Number(time)
      if (!Number.isFinite(value) || value <= 0) return ''
      const date = new Date(value)
      const pad = (part) => String(part).padStart(2, '0')
      return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
      )
    }

    /**
     * 取路径的最后一段，用于在列表里区分工作区。
     * @param {string} cwd 绝对路径。
     * @returns {string} 末段；无法提取时返回原串。
     */
    function shortCwd(cwd) {
      const parts = String(cwd ?? '')
        .split(/[\\/]+/)
        .filter((part) => part !== '')
      return parts.length === 0 ? String(cwd ?? '') : parts[parts.length - 1]
    }

    /**
     * 取路径的最后 N 段，用 `/` 连接。重名目录靠多取一段来区分。
     * @param {string} path 绝对路径。
     * @param {number} count 取几段。
     * @returns {string} 路径尾段。
     */
    function tailPath(path, count) {
      const parts = String(path ?? '')
        .split(/[\\/]+/)
        .filter((part) => part !== '')
      if (parts.length === 0) return String(path ?? '')
      return parts.slice(Math.max(0, parts.length - count)).join('/')
    }

    /**
     * 按工作区（会话的 cwd）把会话分组。同一个目录下的会话聚在一起，
     * 才能在几十上百条里按项目挑选，而不是在一个平铺列表里靠搜索碰。
     *
     * 组按组内最新会话倒序排列（最近的在最上面）；两个不同路径但末段同名的
     * 目录，用末两段区分，避免出现两个都叫 `src` 的组。
     *
     * @param {object[]} sessions 会话摘要数组。
     * @returns {{key: string, label: string, latest: number, items: object[]}[]} 分组。
     */
    function groupSessions(sessions) {
      const buckets = new Map()
      for (const session of sessions) {
        const key = String(session.cwd ?? '')
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(session)
      }

      const seen = new Map()
      for (const key of buckets.keys()) {
        const name = shortCwd(key)
        seen.set(name, (seen.get(name) ?? 0) + 1)
      }

      const groups = []
      for (const [key, items] of buckets) {
        const name = shortCwd(key)
        const label = seen.get(name) > 1 ? tailPath(key, 2) : name
        let latest = 0
        for (const session of items) latest = Math.max(latest, Number(session.createdAt) || 0)
        groups.push({ key, label, latest, items })
      }
      groups.sort((left, right) => right.latest - left.latest)
      return groups
    }

    /**
     * 把一次失败响应压成可读的错误。带上响应体，因为 Host 半的 4xx/5xx
     * 正文就是诊断信息（哪个分支、缺什么参数），只报状态码会让排查无从下手。
     * @param {Response} response 失败的响应。
     * @returns {Promise<string>} 形如 `HTTP 400 缺少 sessionId…`。
     */
    async function describeFailure(response) {
      const detail = await response.text().catch(() => '')
      const trimmed = detail.trim().slice(0, 300)
      return trimmed === '' ? `HTTP ${response.status}` : `HTTP ${response.status} ${trimmed}`
    }

    /**
     * 读取本机会话列表（不含标题）。
     * @param {AbortSignal} signal 取消信号。
     * @returns {Promise<object[]>} 会话摘要数组。
     */
    async function fetchSessionList(signal) {
      const response = await fetch(`${ROUTE}?list=1`, { signal })
      if (!response.ok) throw new Error(await describeFailure(response))
      const payload = await response.json()
      if (typeof payload?.error === 'string') throw new Error(payload.error)
      return Array.isArray(payload?.sessions) ? payload.sessions : []
    }

    /**
     * 折叠一批会话的标题。
     * @param {string[]} ids 会话 id。
     * @param {AbortSignal} signal 取消信号。
     * @returns {Promise<Record<string, string>>} id → 标题。
     */
    async function fetchSessionTitles(ids, signal) {
      if (ids.length === 0) return {}
      const query = new URLSearchParams({ titles: '1', ids: ids.join(',') })
      const response = await fetch(`${ROUTE}?${query.toString()}`, { signal })
      if (!response.ok) throw new Error(await describeFailure(response))
      const payload = await response.json()
      if (typeof payload?.error === 'string') throw new Error(payload.error)
      return payload?.titles !== null && typeof payload?.titles === 'object' ? payload.titles : {}
    }

    /**
     * 触发一次浏览器下载。
     * @param {{sessionId: string, scope: 'session'|'all'|'selected', sessionIds?: string[], format: 'md'|'html'|'json', mode: 'dialog'|'trajectory'}} options 导出选项。
     * @param {AbortSignal} signal 取消信号。
     * @returns {Promise<void>} 下载开始后 resolve。
     */
    async function downloadDocument(options, signal) {
      const query = new URLSearchParams({ format: options.format, mode: options.mode })
      let isZip = false
      if (options.scope === 'all') {
        query.set('scope', 'all')
        isZip = true
      } else if (options.scope === 'selected' && Array.isArray(options.sessionIds)) {
        if (options.sessionIds.length === 0) throw new Error('EMPTY_SELECTION')
        query.set('sessionIds', options.sessionIds.join(','))
        isZip = true
      } else {
        query.set('sessionId', options.sessionId)
      }
      const response = await fetch(`${ROUTE}?${query.toString()}`, { signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(detail === '' ? `HTTP ${response.status}` : detail)
      }
      const blob = await response.blob()
      const filename =
        parseFilename(response.headers.get('content-disposition')) ??
        (isZip
          ? '会话导出.zip'
          : `会话_${String(options.sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.${options.format}`)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      anchor.click()
      // 给浏览器留出接管下载的时间再回收。
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    }

    /**
     * 会话勾选浮层。
     * @param {object} props 状态与回调。
     * @returns {import('react').ReactElement|null} 浮层；未打开时 null。
     */
    function SessionPicker(props) {
      const {
        open,
        t,
        sessions,
        titles,
        loadingSessions,
        loadingTitles,
        listError,
        selected,
        currentSessionId,
        query,
        setQuery,
        collapsed,
        onToggle,
        onSelectAll,
        onClear,
        onToggleGroup,
        onSelectGroup,
        onUnselectGroup,
        onConfirm,
        onClose,
      } = props

      if (!open) return null

      const selectedSet = {}
      for (const id of selected) selectedSet[id] = true

      const needle = query.trim().toLowerCase()
      const matches = (session) => {
        if (needle === '') return true
        const title = titles[session.id] ?? ''
        return (
          title.toLowerCase().includes(needle) ||
          session.id.toLowerCase().includes(needle) ||
          String(session.cwd ?? '').toLowerCase().includes(needle)
        )
      }

      // 先分组再过滤：只留下有命中的组，组内只留命中的行。
      const groups = groupSessions(sessions)
        .map((group) => ({ ...group, items: group.items.filter(matches) }))
        .filter((group) => group.items.length > 0)
      let visibleCount = 0
      for (const group of groups) visibleCount += group.items.length

      /** 单个会话行。 */
      const renderRow = (session) => {
        const title = titles[session.id] ?? ''
        const checked = selectedSet[session.id] === true
        const meta = []
        const time = formatTime(session.createdAt)
        if (time !== '') meta.push(h('span', { key: 'time' }, time))
        if (session.origin === 'subagent') {
          meta.push(h('span', { key: 'sub', className: 'sde-tag' }, t('picker.subagent')))
        }
        if (session.live === true) {
          meta.push(h('span', { key: 'live', className: 'sde-tag' }, t('picker.live')))
        }
        return h(
          'label',
          { key: session.id, className: 'sde-row' },
          h('input', {
            type: 'checkbox',
            checked,
            onChange: () => onToggle(session.id),
          }),
          h(
            'div',
            { className: 'sde-row-body' },
            h(
              'div',
              { className: `sde-row-title${title === '' ? ' is-empty' : ''}` },
              title === '' ? t('picker.untitled') : title,
            ),
            meta.length === 0 ? null : h('div', { className: 'sde-row-meta' }, meta),
          ),
        )
      }

      /** 一个工作区分组：组头（折叠 + 组内全选）加组内行。 */
      const renderGroup = (group) => {
        // 搜索时强制展开，否则命中项被折叠藏起来等于没搜到。
        const collapsedNow = needle === '' && collapsed[group.key] === true
        const ids = group.items.map((session) => session.id)
        const pickedHere = ids.filter((id) => selectedSet[id] === true).length
        const allHere = pickedHere === ids.length
        const countText =
          pickedHere === 0 ? String(ids.length) : `${t('picker.group.picked')} ${pickedHere}/${ids.length}`
        const label = group.key === '' ? t('picker.noworkspace') : group.label
        return h(
          'div',
          { key: group.key === '' ? '\u0000none' : group.key, className: 'sde-group' },
          h(
            'div',
            {
              className: 'sde-group-head',
              title: group.key === '' ? t('picker.noworkspace') : group.key,
              onClick: () => onToggleGroup(group.key),
            },
            h('span', { className: 'sde-caret' }, collapsedNow ? '▸' : '▾'),
            h('span', { className: 'sde-group-name' }, label),
            h('span', { className: 'sde-group-count' }, countText),
            h(
              'button',
              {
                type: 'button',
                className: 'sde-group-pick',
                onClick: (event) => {
                  event.stopPropagation()
                  if (allHere) onUnselectGroup(ids)
                  else onSelectGroup(ids)
                },
              },
              allHere ? t('picker.group.clear') : t('picker.group.all'),
            ),
          ),
          collapsedNow ? null : h('div', { className: 'sde-group-body' }, group.items.map(renderRow)),
        )
      }

      const groupNodes = groups.map(renderGroup)

      let note = null
      if (loadingSessions) {
        note = h('div', { key: 'note', className: 'sde-note' }, t('picker.loading'))
      } else if (listError !== '') {
        note = h('div', { key: 'note', className: 'sde-note is-error' }, `${t('picker.failed')}：${listError}`)
      } else if (visibleCount === 0) {
        note = h('div', { key: 'note', className: 'sde-note' }, `${t('picker.empty')}（${t('picker.empty.hint')}）`)
      }

      // 只有一种情况显示纯列表；其余都是「提示 + 可能还有的行」。
      const listChildren =
        note === null
          ? groupNodes
          : visibleCount === 0 || loadingSessions || listError !== ''
            ? [note]
            : [note, ...groupNodes]

      const counter = `${t('picker.total')} ${sessions.length} · ${t('picker.confirm')} ${selected.length}`
      const titlesHint = loadingTitles ? t('picker.titles') : ''

      return h(
        React.Fragment,
        null,
        h('div', { className: 'sde-backdrop', onClick: onClose }),
        h(
          'div',
          {
            className: 'sde-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('picker.title'),
          },
          h(
            'div',
            { className: 'sde-dialog-head' },
            h('span', null, t('picker.title')),
            h(
              'button',
              { type: 'button', className: 'sde-close', onClick: onClose, 'aria-label': t('picker.cancel') },
              '×',
            ),
          ),
          h(
            'div',
            { className: 'sde-toolbar' },
            h('input', {
              className: 'sde-search',
              type: 'search',
              placeholder: t('picker.search'),
              value: query,
              onChange: (event) => setQuery(event.currentTarget.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'sde-mini',
                onClick: () =>
                  onSelectAll(groups.flatMap((group) => group.items.map((session) => session.id))),
              },
              t('picker.all'),
            ),
            h('button', { type: 'button', className: 'sde-mini', onClick: onClear }, t('picker.clear')),
          ),
          h('div', { className: 'sde-list' }, listChildren),
          h(
            'div',
            { className: 'sde-dialog-foot' },
            h(
              'span',
              { className: 'sde-count' },
              `${counter}${titlesHint === '' ? '' : ` · ${titlesHint}`}`,
            ),
            h('button', { type: 'button', className: 'sde-action', onClick: onClose }, t('picker.cancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'sde-action is-primary',
                disabled: selected.length === 0,
                onClick: onConfirm,
              },
              `${t('picker.confirm')} ${selected.length}`,
            ),
          ),
        ),
      )
    }

    /**
     * 导出按钮 + 选择面板 + 会话勾选浮层。
     * @param {{sessionId: string, t: (key: string) => string}} props Slot 注入的会话与文案。
     * @returns {import('react').ReactElement} 按钮与面板。
     */
    function ExportButton(props) {
      const { sessionId, t } = props
      const [open, setOpen] = React.useState(false)
      const [format, setFormat] = React.useState('md')
      const [mode, setMode] = React.useState('dialog')
      const [scope, setScope] = React.useState('session')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      const [pickerOpen, setPickerOpen] = React.useState(false)
      const [sessions, setSessions] = React.useState([])
      const [titles, setTitles] = React.useState({})
      const [loadingSessions, setLoadingSessions] = React.useState(false)
      const [loadingTitles, setLoadingTitles] = React.useState(false)
      const [listError, setListError] = React.useState('')
      const [selected, setSelected] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})

      const rootRef = React.useRef(null)

      React.useEffect(() => {
        if (!open && !pickerOpen) return undefined
        const onPointerDown = (event) => {
          // 浮层是 portal 到 body 的，点击它同样会落在 root 之外；
          // 此时面板必须留着，否则选完会话回到面板看不到结果。
          if (pickerOpen) return
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) {
            setOpen(false)
          }
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (pickerOpen) setPickerOpen(false)
          else setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open, pickerOpen])

      React.useEffect(() => {
        setError('')
      }, [format, mode, scope])

      // 打开选择器时：先取列表，再异步、分批补标题。
      // 标题折叠要读会话日志（本机实测 81 个会话 / 121 MB），一次性请求会让
      // 浮层转十几秒；分批之后第一批标题很快就能显示，慢的批次不拖住整个列表。
      React.useEffect(() => {
        if (!pickerOpen) return undefined
        const controller = new AbortController()
        setListError('')
        setLoadingSessions(true)
        setLoadingTitles(false)

        const loadTitles = async (ids) => {
          // 单批 8 秒超时；整轮 30 秒封顶，剩下的就让它显示「（未命名会话）」。
          const CHUNK = 20
          const BATCH_TIMEOUT = 8000
          const deadline = Date.now() + 30000
          setLoadingTitles(true)
          for (let start = 0; start < ids.length; start += CHUNK) {
            if (controller.signal.aborted || Date.now() > deadline) break
            const batch = new AbortController()
            const relay = () => batch.abort()
            controller.signal.addEventListener('abort', relay)
            const timer = window.setTimeout(() => batch.abort(), BATCH_TIMEOUT)
            try {
              const map = await fetchSessionTitles(ids.slice(start, start + CHUNK), batch.signal)
              if (controller.signal.aborted) return
              setTitles((previous) => ({ ...previous, ...map }))
            } catch {
              // 这一批取不到就跳过，不中断其余批次。
            } finally {
              window.clearTimeout(timer)
              controller.signal.removeEventListener('abort', relay)
            }
          }
          if (!controller.signal.aborted) setLoadingTitles(false)
        }

        fetchSessionList(controller.signal)
          .then((list) => {
            if (controller.signal.aborted) return undefined
            setSessions(list)
            setLoadingSessions(false)
            return loadTitles(list.map((session) => session.id))
          })
          .catch((failure) => {
            if (controller.signal.aborted) return
            setListError(failure instanceof Error ? failure.message : String(failure))
            setLoadingSessions(false)
            setLoadingTitles(false)
          })

        return () => controller.abort()
      }, [pickerOpen])

      const toggle = (id) => {
        setSelected((current) =>
          current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        )
      }

      const selectAll = (ids) => {
        setSelected((current) => {
          const merged = new Set(current)
          for (const id of ids) merged.add(id)
          return [...merged]
        })
      }

      const unselectAll = (ids) => {
        const drop = new Set(ids)
        setSelected((current) => current.filter((id) => !drop.has(id)))
      }

      const toggleGroup = (key) => {
        setCollapsed((current) => ({ ...current, [key]: current[key] !== true }))
      }

      const run = async () => {
        if (busy) return
        if (scope === 'selected' && selected.length === 0) {
          setError(t('error.noselection'))
          return
        }
        setBusy(true)
        setError('')
        const controller = new AbortController()
        try {
          await downloadDocument(
            { sessionId, scope, sessionIds: selected, format, mode },
            controller.signal,
          )
          setOpen(false)
          setPickerOpen(false)
        } catch (failure) {
          if (!controller.signal.aborted) {
            const message = failure instanceof Error ? failure.message : String(failure)
            setError(
              message === 'EMPTY_SELECTION'
                ? t('error.noselection')
                : `${t('error.failed')}：${message}`,
            )
          }
        } finally {
          setBusy(false)
        }
      }

      const option = (value, current, label, onSelect) =>
        h(
          'button',
          {
            type: 'button',
            className: 'sde-opt',
            'aria-pressed': current === value,
            onClick: () => onSelect(value),
          },
          label,
        )

      const pickerNode = h(SessionPicker, {
        open: pickerOpen,
        t,
        sessions,
        titles,
        loadingSessions,
        loadingTitles,
        listError,
        selected,
        currentSessionId: sessionId,
        query,
        setQuery,
        collapsed,
        onToggle: toggle,
        onSelectAll: selectAll,
        onClear: () => setSelected([]),
        onToggleGroup: toggleGroup,
        onSelectGroup: selectAll,
        onUnselectGroup: unselectAll,
        onConfirm: run,
        onClose: () => setPickerOpen(false),
      })

      const pickerMounted =
        pickerOpen && createPortal !== null && typeof document !== 'undefined' && document.body
          ? createPortal(pickerNode, document.body)
          : pickerNode

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'sde-root', ref: rootRef },
          h(
            'button',
            {
              type: 'button',
              className: 'sde-btn',
              title: t('button.label'),
              'aria-label': t('button.label'),
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              onClick: () => setOpen((value) => !value),
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                'aria-hidden': true,
              },
              h('path', { d: 'M9.5 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4.75z' }),
              h('path', { d: 'M9.5 1.75v3h3' }),
              h('path', { d: 'M8 7.75v4.5M5.9 10.35 8 12.45l2.1-2.1' }),
            ),
          ),
          open
            ? h(
                'div',
                { className: 'sde-panel', role: 'dialog', 'aria-label': t('button.label') },
                h(
                  'div',
                  { className: 'sde-group' },
                  h('div', { className: 'sde-label' }, t('panel.format')),
                  h(
                    'div',
                    { className: 'sde-options' },
                    option('md', format, t('format.md'), setFormat),
                    option('html', format, t('format.html'), setFormat),
                    option('json', format, t('format.json'), setFormat),
                  ),
                ),
                h(
                  'div',
                  { className: 'sde-group' },
                  h('div', { className: 'sde-label' }, t('panel.mode')),
                  h(
                    'div',
                    { className: 'sde-options' },
                    option('dialog', mode, t('mode.dialog'), setMode),
                    option('trajectory', mode, t('mode.trajectory'), setMode),
                  ),
                ),
                h(
                  'div',
                  { className: 'sde-group' },
                  h('div', { className: 'sde-label' }, t('panel.scope')),
                  h(
                    'div',
                    { className: 'sde-options' },
                    option('session', scope, t('scope.session'), setScope),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'sde-opt',
                        'aria-pressed': scope === 'selected',
                        onClick: () => {
                          setScope('selected')
                          setPickerOpen(true)
                        },
                      },
                      scope === 'selected' && selected.length > 0
                        ? `${t('scope.pick')} ${selected.length}${t('scope.unit')}`
                        : t('scope.pick'),
                    ),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sde-submit',
                    disabled: busy,
                    onClick: run,
                  },
                  busy ? t('panel.busy') : t('panel.submit'),
                ),
                error === '' ? null : h('div', { className: 'sde-error' }, error),
                h(
                  'div',
                  { className: 'sde-hint' },
                  scope === 'selected' ? t('panel.hint.picked') : t('panel.hint'),
                ),
              )
            : null,
        ),
        pickerMounted,
      )
    }

    /**
     * 解析 `/export-doc` 命令回传的选项。
     * @param {unknown} result 命令执行结果。
     * @returns {{format: 'md'|'html'|'json', mode: 'dialog'|'trajectory', scope: 'session'|'all'}|null} 选项；不是本命令时 null。
     */
    function parseCommandPayload(result) {
      if (result === null || typeof result !== 'object' || result.kind !== 'success') return null
      const text = typeof result.text === 'string' ? result.text : ''
      if (text === '') return null
      try {
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object') return null
        const format = parsed.format === 'html' || parsed.format === 'json' ? parsed.format : 'md'
        const mode = parsed.mode === 'trajectory' ? 'trajectory' : 'dialog'
        const scope = parsed.scope === 'all' ? 'all' : 'session'
        return { format, mode, scope }
      } catch {
        return null
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => {
            if (document.getElementById(STYLE_ID) !== null) return () => {}
            const style = document.createElement('style')
            style.id = STYLE_ID
            style.dataset.plugin = '@local/session-doc-export'
            style.textContent = CSS
            document.head.appendChild(style)
            return () => style.remove()
          },
          'session-doc-export: 样式',
        )

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-doc-export: 文案')

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'session-doc-export',
              order: -10,
              locale: NS,
            },
            ExportButton,
          ),
        )

        // 斜杠命令：Host 半回传选项，这里负责真正触发浏览器下载。
        ctx.on('command/executed', (sessionId, commandName, result) => {
          if (commandName !== 'export-doc') return
          const payload = parseCommandPayload(result)
          if (payload === null) return
          const controller = new AbortController()
          downloadDocument(
            { sessionId, scope: payload.scope, format: payload.format, mode: payload.mode },
            controller.signal,
          ).catch((failure) => {
            console.error(`[session-doc-export] 命令触发的导出失败：${failure?.message ?? failure}`)
          })
        })
      },
      /** 供离线自检使用的纯函数（cordis 只读 inject/apply，多出的字段无副作用）。 */
      __test: { formatTime, shortCwd, tailPath, groupSessions, parseCommandPayload, SessionPicker },
    }
  },
})
