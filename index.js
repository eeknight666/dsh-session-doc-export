/**
 * Session 文档导出 —— Host 半。
 *
 * 职责：注册一条带认证的下载路由，把某个会话的事件流渲染成人可读的文档。
 * 与官方 `dsh-session-log-export`（导出原始 jsonl ZIP）并存，互不干扰：
 * 那个给程序读，这个给人读。
 *
 * 路由：GET/HEAD /api/session.export-doc
 *
 * 四种用法：
 *   ?list=1                      列出本机会话（不含标题；标题单独取，见下）
 *   ?titles=1&ids=a,b,c          折叠这些会话的标题
 *   ?sessionId=x                 导出单个会话
 *   ?sessionIds=a,b,c            导出选中的多个会话，打包成 ZIP
 *   ?scope=all                   导出本机全部会话，打包成 ZIP
 *
 * 公共参数：
 *   format     md | html | json（默认 md）
 *   mode       dialog | trajectory（默认 dialog）
 *   truncate   单个工具结果的最大字符数（默认 20000，限制在 1000..200000）
 *
 * 为什么列表和标题分两步：`SessionHeader` 里没有标题，标题是 `session/title`
 * 事件，折叠要读会话日志。本机实测 81 个会话 / 121 MB，一次性折叠会让选择器
 * 卡十几秒；分开之后列表秒回，标题边取边填。
 */

import { buildDocument } from './lib/read-session.js'
import { renderMarkdown } from './lib/render-markdown.js'
import { renderHtml } from './lib/render-html.js'
import { renderJson } from './lib/render-json.js'
import { buildZip } from './lib/zip.js'

export const name = 'session-doc-export'

/** 硬依赖：下载路由挂在 connection 的 fetch 载体上，斜杠命令挂在 commands 注册表上。 */
export const inject = ['connection', 'commands']

/** 路由路径，与 client 半共享同一常量语义。 */
export const EXPORT_PATH = '/api/session.export-doc'

/** 斜杠命令名。 */
const COMMAND_NAME = 'export-doc'

/** 默认截断长度（字符）。 */
const DEFAULT_TRUNCATE = 20000
const MIN_TRUNCATE = 1000
const MAX_TRUNCATE = 200000

/** 批量导出的会话数上限：防止一次点下去把几百个会话全渲染进内存。 */
const BATCH_LIMIT = 200

/**
 * 读取一个会话的全部事件；活跃会话先过一道持久化屏障，保证尾部完整。
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 * @param {string} sessionId 会话 id。
 * @param {AbortSignal|undefined} signal 取消信号。
 * @returns {Promise<{header: object, events: object[]}|undefined>} 会话内容；不存在时 undefined。
 */
async function loadSession(ctx, sessionId, signal) {
  // 正在跑的会话可能还有未落盘的内存事件，先 flush。
  const sessions = ctx.get('sessions')
  if (sessions !== undefined) {
    const live = typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
    if (live !== undefined && typeof sessions.flush === 'function') {
      await sessions.flush(live)
    }
  }

  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('sessionPersistence 服务不可用')

  let handle
  try {
    handle = await persistence.open(sessionId, 'read', { signal })
  } catch (error) {
    if (error?.name === 'SessionPersistenceNotFoundError') return undefined
    throw error
  }
  try {
    const { events } = await handle.read(0, undefined, { signal })
    return { header: handle.header, events }
  } finally {
    await handle.close()
  }
}

/**
 * 把查询参数归一化成渲染选项。
 * @param {URLSearchParams} params 查询参数。
 * @returns {{format: 'md'|'html'|'json', mode: 'dialog'|'trajectory', truncate: number}}
 */
function readOptions(params) {
  const formatParam = (params.get('format') ?? 'md').toLowerCase()
  const format = formatParam === 'html' || formatParam === 'json' ? formatParam : 'md'
  const mode = params.get('mode') === 'trajectory' ? 'trajectory' : 'dialog'
  const raw = Number(params.get('truncate') ?? DEFAULT_TRUNCATE)
  const truncate = Number.isFinite(raw)
    ? Math.min(MAX_TRUNCATE, Math.max(MIN_TRUNCATE, Math.trunc(raw)))
    : DEFAULT_TRUNCATE
  return { format, mode, truncate }
}

/**
 * 把标题清理成可用作文件名的片段。
 * Windows/Unix 文件名非法字符与连续空白统一折成下划线。
 * @param {string} title 会话标题。
 * @returns {string} 安全片段（可能为空串）。
 */
export function sanitizeTitle(title) {
  return String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

/**
 * 形如 `20261124-0930` 的时间戳片段。
 * @param {Date} [now] 时间，默认当前。
 * @returns {string} 时间戳。
 */
export function timestamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  )
}

/**
 * 格式 → 扩展名。
 * @param {string} format 格式标识。
 * @returns {string} 扩展名。
 */
function extensionFor(format) {
  return format === 'html' ? 'html' : format === 'json' ? 'json' : 'md'
}

/**
 * 生成单个会话的下载文件名：标题 + 档位 + 日期时间 + 扩展名。
 * @param {object} meta 文档元信息。
 * @param {{format: string, mode: string}} options 渲染选项。
 * @returns {string} 文件名。
 */
export function filenameFor(meta, options) {
  const base = sanitizeTitle(meta.title) || '会话'
  const suffix = options.mode === 'trajectory' ? '_含轨迹' : ''
  return `${base}${suffix}_${timestamp()}.${extensionFor(options.format)}`
}

/**
 * 生成批量导出的 ZIP 文件名。
 * @param {{format: string, mode: string}} options 渲染选项。
 * @param {number} [count] 会话数量；给出时带进文件名，便于区分。
 * @returns {string} 文件名。
 */
export function bundleFilename(options, count) {
  const suffix = options.mode === 'trajectory' ? '_含轨迹' : ''
  const scope = Number.isFinite(count) ? `${count}个会话` : '全部'
  return `会话导出_${scope}${suffix}_${timestamp()}.zip`
}

/**
 * 按 RFC 5987 编码 `filename*` 参数值。
 * @param {string} value 原始文件名。
 * @returns {string} 百分号编码后的值。
 */
function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** 各格式的 MIME 与编码。 */
const FORMAT_META = {
  md: { contentType: 'text/markdown; charset=utf-8' },
  html: { contentType: 'text/html; charset=utf-8' },
  json: { contentType: 'application/json; charset=utf-8' },
}

/**
 * 构造带 RFC 5987 编码的 Content-Disposition。
 * @param {string} filename 原始文件名。
 * @returns {string} 响应头值。
 */
function contentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`
}

/**
 * 解析逗号分隔的 id 串，去空、去重、保序。
 * @param {string|null|undefined} raw 原始串。
 * @returns {string[]|null} id 列表；入参缺失时 null。
 */
export function parseIdList(raw) {
  if (raw === null || raw === undefined) return null
  const seen = new Set()
  for (const part of String(raw).split(',')) {
    const id = part.trim()
    if (id !== '') seen.add(id)
  }
  return [...seen]
}

/**
 * 解析 `sessionIds` 查询参数。
 * @param {URLSearchParams} params 查询参数。
 * @returns {string[]|null} 去重后的 id 列表；参数缺失时 null。
 */
export function readSessionIds(params) {
  return parseIdList(params.get('sessionIds'))
}

/**
 * 列出本机会话（全部工作区，含子 Agent 会话），按创建时间倒序。
 *
 * 优先用 `sessionQuery.listSessions()`：它给的是"逻辑语料"，已合并 live 与
 * 持久化两侧；没有该服务时退回 `sessionPersistence.list()`。
 * 两者都拿不到标题（标题不在 `SessionHeader` 里），标题走 {@link readTitles}。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 * @param {AbortSignal|undefined} signal 取消信号。
 * @returns {Promise<object[]>} 会话摘要列表。
 */
export async function listPickerSessions(ctx, signal) {
  const query = ctx.get('sessionQuery')
  const persistence = ctx.get('sessionPersistence')
  const hasQuery = query !== undefined && typeof query.listSessions === 'function'
  const hasPersistence = persistence !== undefined && typeof persistence.list === 'function'
  if (!hasQuery && !hasPersistence) {
    throw new Error('会话存储不可用（既没有 sessionQuery，也没有 sessionPersistence）')
  }

  /** @type {{header: object, live: boolean, eventCount?: number, sizeBytes?: number}[]} */
  let rows = []
  let queryFailed = null

  if (hasQuery) {
    try {
      const records = await query.listSessions(signal)
      rows = records.map((record) => ({
        header: record?.header ?? {},
        live: record?.live === true,
      }))
    } catch (error) {
      // 语料索引可能未就绪或版本不一致：退回后端列举，别让整张列表挂掉。
      if (signal?.aborted) throw error
      queryFailed = error
    }
  }

  if (rows.length === 0 && persistence !== undefined && typeof persistence.list === 'function') {
    const snapshots = await persistence.list({ signal })
    rows = snapshots.map((snapshot) => ({
      header: snapshot?.header ?? {},
      live: false,
      eventCount: snapshot?.eventCount,
      sizeBytes: snapshot?.sizeBytes,
    }))
  }

  if (rows.length === 0 && queryFailed !== null) {
    throw new Error(queryFailed?.message ?? String(queryFailed))
  }

  return rows
    .map((row) => {
      const header = row.header ?? {}
      return {
        id: String(header.id ?? ''),
        createdAt: Number(header.createdAt ?? 0),
        cwd: String(header.cwd ?? ''),
        parentSession: header.parentSession === undefined ? '' : String(header.parentSession),
        origin: header.origin === 'subagent' ? 'subagent' : '',
        delegationDepth: Number.isFinite(Number(header.delegationDepth))
          ? Number(header.delegationDepth)
          : 0,
        live: row.live === true,
        eventCount: Number.isFinite(row.eventCount) ? row.eventCount : null,
        sizeBytes: Number.isFinite(row.sizeBytes) ? row.sizeBytes : null,
      }
    })
    .filter((row) => row.id !== '')
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 折叠一批会话的标题。
 *
 * 单个会话折叠失败（日志损坏、正在重建）只丢它自己的标题，不影响其余。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 * @param {string[]} ids 会话 id。
 * @param {AbortSignal|undefined} signal 取消信号。
 * @returns {Promise<Record<string, string>>} id → 标题；没有标题的会话不出现在结果里。
 */
export async function readTitles(ctx, ids, signal) {
  /** @type {Record<string, string>} */
  const titles = {}
  if (ids.length === 0) return titles
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.readTitleSnapshots !== 'function') return titles

  const results = await query.readTitleSnapshots(ids, signal)
  for (const result of results) {
    if (result?.status !== 'fulfilled') continue
    const title = result.value?.title?.title
    if (typeof title !== 'string') continue
    const trimmed = title.trim()
    if (trimmed === '') continue
    titles[String(result.sessionId)] = trimmed
  }
  return titles
}

/**
 * 按格式渲染归一化文档。
 * @param {object} document 归一化文档。
 * @param {{format: string, mode: 'dialog'|'trajectory'}} options 渲染选项。
 * @returns {string} 文档正文。
 */
function renderBody(document, options) {
  if (options.format === 'html') return renderHtml(document, { mode: options.mode })
  if (options.format === 'json') return renderJson(document, { mode: options.mode })
  return renderMarkdown(document, { mode: options.mode })
}

/**
 * 批量导出：确定目标会话 → 逐个渲染 → 打成一个 ZIP。
 *
 * 给 `sessionIds` 就只导这几个（保持给定顺序）；否则导出本机全部。
 * 单个会话来读取失败（损坏、正在重建）时跳过并记录，不拖垮整批。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 * @param {{format: string, mode: 'dialog'|'trajectory', truncate: number}} options 渲染选项。
 * @param {AbortSignal|undefined} signal 取消信号。
 * @param {string[]|null} [sessionIds] 选中的会话 id；null 表示全部。
 * @returns {Promise<{body: Buffer, count: number, skipped: string[]}>} ZIP 与统计。
 */
async function exportBundle(ctx, options, signal, sessionIds = null) {
  /** @type {string[]} */
  let targets

  if (sessionIds !== null) {
    if (sessionIds.length === 0) throw new Error('没有选择任何会话')
    targets = sessionIds.slice(0, BATCH_LIMIT)
  } else {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('sessionPersistence 服务不可用')
    if (typeof persistence.list !== 'function') {
      throw new Error('当前持久化后端不支持列举会话，无法批量导出')
    }
    const snapshots = await persistence.list({ signal })
    targets = snapshots
      .filter((snapshot) => typeof snapshot?.header?.id === 'string' && snapshot.header.id !== '')
      .sort((a, b) => Number(a.header.createdAt ?? 0) - Number(b.header.createdAt ?? 0))
      .slice(0, BATCH_LIMIT)
      .map((snapshot) => String(snapshot.header.id))
  }

  /** @type {{name: string, data: Buffer}[]} */
  const entries = []
  /** @type {string[]} */
  const skipped = []

  for (const sessionId of targets) {
    if (signal?.aborted) throw new Error('已取消')
    try {
      const loaded = await loadSession(ctx, sessionId, signal)
      if (loaded === undefined) {
        // list 里有、但读的时候已经不在了：仍然记一笔跳过，便于排查。
        skipped.push(`${sessionId}: 会话不存在`)
        continue
      }
      const document = buildDocument(loaded.header, loaded.events, {
        truncateChars: options.truncate,
      })
      const body = renderBody(document, options)
      const base = sanitizeTitle(document.meta.title) || `会话_${entries.length + 1}`
      const suffix = options.mode === 'trajectory' ? '_含轨迹' : ''
      const serial = String(entries.length + 1).padStart(3, '0')
      entries.push({
        name: `${serial}_${base}${suffix}.${extensionFor(options.format)}`,
        data: Buffer.from(body, 'utf8'),
      })
    } catch (error) {
      if (signal?.aborted) throw new Error('已取消')
      skipped.push(`${sessionId}: ${error?.message ?? String(error)}`)
    }
  }

  if (entries.length === 0) throw new Error('没有可导出的会话')
  return { body: buildZip(entries), count: entries.length, skipped }
}

/**
 * 渲染一条 JSON 响应。
 * @param {unknown} payload 响应体。
 * @param {number} [status] HTTP 状态码。
 * @returns {Response} 响应。
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * 渲染一条下载响应。
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 * @param {Request} request 入站请求。
 * @returns {Promise<Response>} 响应。
 */
async function exportResponse(ctx, request) {
  const url = new URL(request.url)
  const params = url.searchParams
  const options = readOptions(params)

  // 预检请求不需要真的渲染一遍大文档。
  if (request.method === 'HEAD') return new Response(null, { status: 200 })

  // —— 版本探针：改完代码判断 Host 半是否真的重新加载过 ——
  // 旧版本没有这个分支，所以它回落到下面的 400；新版本回 JSON。
  if (params.get('ping') === '1') {
    return jsonResponse({ route: EXPORT_PATH, revision: 3, handles: ['list', 'titles', 'sessionIds', 'scope'] })
  }

  // —— 列举会话：给选择器用，不含标题 ——
  if (params.get('list') === '1') {
    try {
      return jsonResponse({ sessions: await listPickerSessions(ctx, request.signal) })
    } catch (error) {
      return jsonResponse({ error: `列举会话失败：${error?.message ?? String(error)}` }, 500)
    }
  }

  // —— 折叠标题：选择器拿到列表后单独调 ——
  if (params.get('titles') === '1') {
    const ids = parseIdList(params.get('ids')) ?? []
    try {
      return jsonResponse({ titles: await readTitles(ctx, ids.slice(0, BATCH_LIMIT), request.signal) })
    } catch (error) {
      return jsonResponse({ error: `折叠标题失败：${error?.message ?? String(error)}` }, 500)
    }
  }

  const selectedIds = readSessionIds(params)
  if (selectedIds !== null && selectedIds.length === 0 && params.get('scope') !== 'all') {
    return new Response('sessionIds 为空：没有选择任何会话', { status: 400 })
  }
  const batch = params.get('scope') === 'all' || (selectedIds !== null && selectedIds.length > 0)

  if (batch) {
    let bundle
    try {
      bundle = await exportBundle(ctx, options, request.signal, selectedIds)
    } catch (error) {
      return new Response(`批量导出失败：${error?.message ?? String(error)}`, { status: 500 })
    }
    return new Response(bundle.body, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': contentDisposition(bundleFilename(options, bundle.count)),
        'cache-control': 'no-store',
        'x-export-count': String(bundle.count),
        'x-export-skipped': String(bundle.skipped.length),
      },
    })
  }

  const sessionId = params.get('sessionId') ?? ''
  if (sessionId === '') {
    return new Response('缺少 sessionId 查询参数（导出选中会话请用 sessionIds，批量导出请用 scope=all）', {
      status: 400,
    })
  }

  let loaded
  try {
    loaded = await loadSession(ctx, sessionId, request.signal)
  } catch (error) {
    return new Response(`读取会话失败：${error?.message ?? String(error)}`, { status: 500 })
  }
  if (loaded === undefined) return new Response('会话不存在', { status: 404 })

  const document = buildDocument(loaded.header, loaded.events, { truncateChars: options.truncate })
  const body = renderBody(document, options)

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': FORMAT_META[options.format].contentType,
      'content-disposition': contentDisposition(filenameFor(document.meta, options)),
      'cache-control': 'no-store',
    },
  })
}

/**
 * 解析 `/export-doc` 的参数。
 *
 *   /export-doc                 → Markdown + 仅对话 + 当前会话
 *   /export-doc trajectory      → Markdown + 含轨迹 + 当前会话
 *   /export-doc html            → HTML + 仅对话 + 当前会话
 *   /export-doc html trajectory → HTML + 含轨迹 + 当前会话
 *   /export-doc all html        → 全部会话，打包成 ZIP
 *
 * @param {string} rawInput 命令原文（不含命令名）。
 * @returns {{format: 'md'|'html'|'json', mode: 'dialog'|'trajectory', scope: 'session'|'all'}|{error: string}} 选项或错误。
 */
function parseCommandArguments(rawInput) {
  const tokens = String(rawInput ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '')
  let format = 'md'
  let mode = 'dialog'
  let scope = 'session'
  for (const token of tokens) {
    if (token === 'html' || token === 'json') format = token
    else if (token === 'md' || token === 'markdown') format = 'md'
    else if (token === 'trajectory' || token === 'trace' || token === '轨迹') mode = 'trajectory'
    else if (token === 'dialog' || token === '对话') mode = 'dialog'
    else if (token === 'all' || token === 'batch' || token === '全部') scope = 'all'
    else return { error: `未知参数：${token}` }
  }
  return { format, mode, scope }
}

/**
 * 挂载下载路由与 `/export-doc` 命令。
 * @param {import('@deepseek-ai/cordis').Context} ctx Host 上下文。
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: EXPORT_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => exportResponse(ctx, request),
      }),
    'session-doc-export: 下载路由',
  )

  ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: '@local/session-doc-export',
        name: COMMAND_NAME,
        description:
          '把当前会话（或加 all 导出全部会话 ZIP）导出为可读文档（Markdown / HTML / JSON，可选含工具轨迹）',
        handler: (invocation) => {
          const parsed = parseCommandArguments(invocation?.rawInput ?? '')
          if ('error' in parsed) return { kind: 'error', text: parsed.error }
          // 选项随成功结果回传给浏览器半包，由它触发真正的下载。
          return { kind: 'success', text: JSON.stringify(parsed) }
        },
      }),
    'session-doc-export: 斜杠命令',
  )
}
