/**
 * Host 半自检：用 mock 上下文跑 apply，断言路由与命令注册正确，
 * 再通过路由 handler 走一遍真实响应（fixture 提供事件）。
 *
 *   node _dsh-plugins\session-doc-export\test\host-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  apply,
  EXPORT_PATH,
  filenameFor,
  inject as hostInject,
  listPickerSessions,
  name as pluginName,
  parseIdList,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const { header, events } = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'))

const SESSION_ID = String(header.id)
const routes = []
const commands = []
const effects = []

const fakeHandle = {
  header,
  read: async () => ({ events }),
  close: async () => {},
}

const fakePersistence = {
  open: async (id) => {
    if (String(id) !== SESSION_ID) {
      const error = new Error('not found')
      error.name = 'SessionPersistenceNotFoundError'
      throw error
    }
    return fakeHandle
  },
  // 批量导出会走 list()：多给一个不存在的会话，验证「单条失败不拖垮整批」。
  list: async () => [
    { header: { ...header, id: 'session-really-gone', createdAt: 1 } },
    { header },
  ],
}

// 选择器用的语料服务：给出两条有效会话（其中一条 is 子 Agent 且标题折叠失败），
// 外加一条 id 为空的脏数据，验证过滤与排序。
const fakeQuery = {
  listSessions: async () => [
    {
      header: { ...header, id: 'session-newer', createdAt: 2_000, cwd: 'D:\\work\\alpha' },
      live: true,
      persisted: true,
    },
    {
      header: {
        ...header,
        id: 'session-older',
        createdAt: 1_000,
        cwd: 'D:\\work\\beta',
        origin: 'subagent',
        delegationDepth: 1,
      },
      live: false,
      persisted: true,
    },
    { header: { ...header, id: '' }, live: false, persisted: false },
  ],
  readTitleSnapshots: async (ids) =>
    ids.map((id) =>
      id === 'session-older'
        ? { sessionId: id, status: 'rejected', reason: new Error('log 损坏') }
        : {
            sessionId: id,
            status: 'fulfilled',
            value: { session: header, title: { title: `标题-${id}` } },
          },
    ),
}

const ctx = {
  effect(factory, label) {
    effects.push(label)
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  connection: {
    fetch: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  },
  commands: {
    register(command) {
      commands.push(command)
      return () => {}
    },
  },
  get(service) {
    if (service === 'sessionPersistence') return fakePersistence
    if (service === 'sessionQuery') return fakeQuery
    return undefined
  },
}

apply(ctx)

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

check(pluginName === 'session-doc-export', `插件名应为 session-doc-export，实际 ${pluginName}`)
check(hostInject.includes('connection'), 'inject 应包含 connection')
check(hostInject.includes('commands'), 'inject 应包含 commands')
check(routes.length === 1, `应注册 1 条路由，实际 ${routes.length}`)
check(routes[0]?.path === EXPORT_PATH, `路由路径应为 ${EXPORT_PATH}`)
check(
  JSON.stringify(routes[0]?.methods) === JSON.stringify(['GET', 'HEAD']),
  `路由方法应为 GET/HEAD，实际 ${JSON.stringify(routes[0]?.methods)}`,
)
check(commands.length === 1, `应注册 1 个命令，实际 ${commands.length}`)
check(commands[0]?.name === 'export-doc', `命令名应为 export-doc，实际 ${commands[0]?.name}`)

const fetchRoute = routes[0]

/** 打一次下载路由。 */
async function call(query) {
  const request = new Request(`http://127.0.0.1:3080${EXPORT_PATH}?${query}`)
  return fetchRoute.fetch(request)
}

console.log('--- 路由响应 ---')
for (const [label, query, expectStatus] of [
  ['md/dialog', `sessionId=${SESSION_ID}&format=md&mode=dialog`, 200],
  ['md/trajectory', `sessionId=${SESSION_ID}&format=md&mode=trajectory`, 200],
  ['html/trajectory', `sessionId=${SESSION_ID}&format=html&mode=trajectory`, 200],
  ['json/dialog', `sessionId=${SESSION_ID}&format=json&mode=dialog`, 200],
  ['未知格式回退 md', `sessionId=${SESSION_ID}&format=xml`, 200],
  ['缺少 sessionId', 'format=md', 400],
  ['会话不存在', 'sessionId=session-does-not-exist', 404],
  ['截断下界被夹紧', `sessionId=${SESSION_ID}&format=md&mode=trajectory&truncate=1`, 200],
]) {
  const response = await call(query)
  const body = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const disposition = response.headers.get('content-disposition') ?? ''
  console.log(
    `${label.padEnd(20)} ${String(response.status).padStart(3)}  ${String(body.length).padStart(8)} 字符  ${contentType}`,
  )
  check(response.status === expectStatus, `${label} 状态应为 ${expectStatus}，实际 ${response.status}`)
  if (expectStatus === 200) {
    check(body.length > 0, `${label} 响应不应为空`)
    check(disposition.includes('attachment'), `${label} 应带 attachment`)
    check(disposition.includes("filename*=UTF-8''"), `${label} 应带 RFC5987 文件名`)
  }
}

// HEAD 不应渲染正文
const headRequest = new Request(`http://127.0.0.1:3080${EXPORT_PATH}?sessionId=${SESSION_ID}`, {
  method: 'HEAD',
})
const headResponse = await fetchRoute.fetch(headRequest)
console.log(`HEAD 预检            ${String(headResponse.status).padStart(3)}  body=${await headResponse.text() === '' ? '空' : '非空'}`)
check(headResponse.status === 200, `HEAD 应为 200，实际 ${headResponse.status}`)

// 批量导出：scope=all 应返回 ZIP，且单条会话损坏时跳过而不是整体失败。
console.log('--- 批量导出 ---')
for (const query of ['scope=all&format=md&mode=dialog', 'scope=all&format=html&mode=trajectory']) {
  const response = await call(query)
  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? ''
  const count = response.headers.get('x-export-count')
  const skipped = response.headers.get('x-export-skipped')
  console.log(
    `${query.padEnd(34)} ${String(response.status).padStart(3)}  ${String(buffer.length).padStart(7)} 字节  count=${count} skipped=${skipped}`,
  )
  check(response.status === 200, `${query} 状态应为 200，实际 ${response.status}`)
  check(contentType.includes('application/zip'), `${query} 应返回 ZIP，实际 ${contentType}`)
  check(
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    `${query} 应以 ZIP 本地头签名开头`,
  )
  check(count === '1', `${query} 应成功导出 1 个会话，实际 ${count}`)
  check(skipped === '1', `${query} 应跳过 1 个失效会话，实际 ${skipped}`)
  const disposition = response.headers.get('content-disposition') ?? ''
  check(disposition.includes('.zip'), `${query} 文件名应以 .zip 结尾`)
  check(disposition.includes("filename*=UTF-8''"), `${query} 应带 RFC5987 文件名`)
}

const batchHead = await fetchRoute.fetch(
  new Request(`http://127.0.0.1:3080${EXPORT_PATH}?scope=all`, { method: 'HEAD' }),
)
console.log(`HEAD 批量预检        ${String(batchHead.status).padStart(3)}  body=${await batchHead.text() === '' ? '空' : '非空'}`)
check(batchHead.status === 200, `HEAD 批量预检应为 200，实际 ${batchHead.status}`)

// ---- 选择器：列表 / 标题 / 定向导出 ----
console.log('--- 选择器 ---')
const listResponse = await call('list=1')
const listPayload = await listResponse.json()
const listed = Array.isArray(listPayload?.sessions) ? listPayload.sessions : []
console.log(
  `  list=1  ${listResponse.status}  ` +
    JSON.stringify(listed.map((row) => `${row.id}@${row.createdAt}${row.origin === 'subagent' ? '/sub' : ''}`)),
)
check(listResponse.status === 200, `list=1 状态应为 200，实际 ${listResponse.status}`)
check(listed.length === 2, `列表应过滤掉空 id，剩 2 条，实际 ${listed.length}`)
check(listed[0]?.id === 'session-newer', '列表应按创建时间倒序（最新的在前）')
check(listed[1]?.id === 'session-older', '第二条应为较旧的会话')
check(listed[0]?.live === true, 'live 标记应透传')
check(listed[1]?.origin === 'subagent', '子 Agent 标记应透传')
check(listed[1]?.delegationDepth === 1, '委派深度应透传')
check(listed.every((row) => typeof row.cwd === 'string'), 'cwd 应始终是字符串')

const titlesResponse = await call('titles=1&ids=session-newer,session-older')
const titlesPayload = await titlesResponse.json()
console.log(`  titles=1 ${titlesResponse.status}  ${JSON.stringify(titlesPayload.titles)}`)
check(titlesResponse.status === 200, `titles=1 状态应为 200，实际 ${titlesResponse.status}`)
check(
  titlesPayload.titles?.['session-newer'] === '标题-session-newer',
  `标题应折叠成功，实际 ${JSON.stringify(titlesPayload.titles)}`,
)
check(
  !Object.prototype.hasOwnProperty.call(titlesPayload.titles ?? {}, 'session-older'),
  '单个会话折叠失败只丢它自己的标题，不应影响其余',
)

const pickedResponse = await call(`sessionIds=${SESSION_ID},session-ghost&format=md&mode=dialog`)
const pickedBuffer = Buffer.from(await pickedResponse.arrayBuffer())
const pickedCount = pickedResponse.headers.get('x-export-count')
const pickedSkipped = pickedResponse.headers.get('x-export-skipped')
console.log(
  `  sessionIds 定向导出  ${String(pickedResponse.status).padStart(3)}  ${String(pickedBuffer.length).padStart(7)} 字节  ` +
    `count=${pickedCount} skipped=${pickedSkipped}`,
)
check(pickedResponse.status === 200, `定向导出状态应为 200，实际 ${pickedResponse.status}`)
check(
  (pickedResponse.headers.get('content-type') ?? '').includes('application/zip'),
  '定向导出应返回 ZIP',
)
check(
  pickedBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  '定向导出应以 ZIP 本地头签名开头',
)
check(pickedCount === '1', `定向导出应只含 1 个会话，实际 ${pickedCount}`)
check(pickedSkipped === '1', `不存在的会话应计入 skipped，实际 ${pickedSkipped}`)

const emptyPick = await call('sessionIds=&format=md')
console.log(`  空 sessionIds        ${String(emptyPick.status).padStart(3)}`)
check(emptyPick.status === 400, `空 sessionIds 应返回 400，实际 ${emptyPick.status}`)

console.log('--- id 列表解析 ---')
for (const [raw, expected] of [
  ['a,b,c', ['a', 'b', 'c']],
  [' a , b ,, a ', ['a', 'b']],
  ['', []],
  [null, null],
]) {
  const got = parseIdList(raw)
  console.log(`  ${JSON.stringify(raw).padEnd(16)} -> ${JSON.stringify(got)}`)
  check(JSON.stringify(got) === JSON.stringify(expected), `parseIdList(${JSON.stringify(raw)}) 应为 ${JSON.stringify(expected)}`)
}

// ---- 语料服务不可用时的降级 ----
console.log('--- 列表降级 ---')
const brokenQueryCtx = {
  get(service) {
    if (service === 'sessionQuery') {
      return {
        listSessions: async () => {
          throw new Error('索引未就绪')
        },
      }
    }
    if (service === 'sessionPersistence') {
      return {
        list: async () => [{ header: { ...header, id: 'session-fallback', createdAt: 5 } }],
      }
    }
    return undefined
  },
}
const fallbackRows = await listPickerSessions(brokenQueryCtx, undefined)
console.log(`  sessionQuery 抛错 -> ${JSON.stringify(fallbackRows.map((row) => row.id))}`)
check(
  fallbackRows.length === 1 && fallbackRows[0].id === 'session-fallback',
  'sessionQuery 失败时应退回 sessionPersistence.list()',
)

const bareCtx = { get: () => undefined }
let degraded = false
try {
  await listPickerSessions(bareCtx, undefined)
} catch {
  degraded = true
}
console.log(`  两个服务都缺失 -> ${degraded ? '抛错' : '静默返回'}`)
check(degraded, '两个服务都缺失时应抛出明确错误，而不是返回空列表')

// 命令行为
console.log('--- 命令行为 ---')
for (const [args, expected] of [
  ['', { format: 'md', mode: 'dialog', scope: 'session' }],
  ['trajectory', { format: 'md', mode: 'trajectory', scope: 'session' }],
  ['html', { format: 'html', mode: 'dialog', scope: 'session' }],
  ['html trajectory', { format: 'html', mode: 'trajectory', scope: 'session' }],
  ['JSON TRACE', { format: 'json', mode: 'trajectory', scope: 'session' }],
  ['all', { format: 'md', mode: 'dialog', scope: 'all' }],
  ['all html 轨迹', { format: 'html', mode: 'trajectory', scope: 'all' }],
]) {
  const result = commands[0].handler({ rawInput: args })
  const parsed = JSON.parse(result.text)
  console.log(`  /export-doc ${args.padEnd(16)} -> ${result.kind} ${result.text}`)
  check(
    result.kind === 'success' &&
      parsed.format === expected.format &&
      parsed.mode === expected.mode &&
      parsed.scope === expected.scope,
    `/export-doc ${args} 解析错误：${result.text}`,
  )
}
const bad = commands[0].handler({ rawInput: 'powdercoat' })
console.log(`  /export-doc powdercoat    -> ${bad.kind} ${bad.text}`)
check(bad.kind === 'error', '未知参数应返回 error')

// 文件名
const alpha = filenameFor({ title: '对话与轨迹导出功能确认' }, { format: 'md', mode: 'trajectory' })
const omega = filenameFor({ title: 'a/b:c*d?e"f<g>h|i' }, { format: 'html', mode: 'dialog' })
console.log('--- 文件名 ---')
console.log(`  中文标题 -> ${alpha}`)
console.log(`  非法字符 -> ${omega}`)
check(/\.md$/.test(alpha), 'md 文件名应以 .md 结尾')
check(alpha.includes('_含轨迹_'), '轨迹档文件名应含档位标记')
check(!/[\\/:*?"<>|]/.test(omega), '文件名不应残留非法字符')
check(/\.html$/.test(omega), 'html 文件名应以 .html 结尾')

console.log('--- effect 标签 ---')
for (const label of effects) console.log(`  ${label}`)

if (problems.length > 0) {
  console.error('\n失败项：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log('\n全部断言通过。')
}
