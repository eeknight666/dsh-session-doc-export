/**
 * Client 半自检：模拟浏览器模块加载器与 Cordis 上下文，验证
 * - 模块以 `window.__ModuleLoader__.load({id, factory})` 形式注册，id 与包名一致
 * - factory 返回 { inject, apply }
 * - apply 注册了样式、文案、会话头部按钮，并监听了命令事件
 *
 * 这一步只能验证结构与注册行为；视觉与真实下载必须由浏览器确认。
 *
 *   node _dsh-plugins\session-doc-export\test\client-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const problems = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}

// ---- 极简 React / DOM / 加载器替身 ----
const created = []
const headChildren = []

const fakeDocument = {
  head: {
    appendChild(node) {
      headChildren.push(node)
      return node
    },
  },
  createElement(tag) {
    const node = {
      tagName: tag,
      id: '',
      dataset: {},
      textContent: '',
      removed: false,
      remove() {
        this.removed = true
      },
    }
    created.push(node)
    return node
  },
  getElementById(id) {
    return headChildren.find((node) => node.id === id) ?? null
  },
  addEventListener() {},
  removeEventListener() {},
}

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  Fragment: Symbol('React.Fragment'),
}

const portalCalls = []

const ReactDOMStub = {
  createPortal(node, container) {
    portalCalls.push(container)
    return node
  },
}

const loadedModules = []
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loadedModules.push(definition)
    },
  },
  setTimeout: () => 0,
}
globalThis.document = fakeDocument
globalThis.URL = globalThis.URL ?? URL

/** 模拟宿主提供的 require：react + react-dom（真实宿主两者都提供）。 */
const requireStub = (specifier) => {
  if (specifier === 'react') return ReactStub
  if (specifier === 'react-dom') return ReactDOMStub
  throw new Error(`测试替身未提供模块：${specifier}`)
}

// ---- 执行 client.js ----
await import('../client.js')

check(loadedModules.length === 1, `应注册 1 个浏览器模块，实际 ${loadedModules.length}`)
const definition = loadedModules[0]
check(
  definition?.id === packageJson.name,
  `模块 id 应等于包名 ${packageJson.name}，实际 ${definition?.id}`,
)

const clientHalf = definition.factory(requireStub)
check(typeof clientHalf.apply === 'function', 'factory 应返回 apply 函数')
check(Array.isArray(clientHalf.inject), 'factory 应返回 inject 数组')
check(clientHalf.inject.includes('slots'), 'inject 应包含 slots')
check(clientHalf.inject.includes('locale'), 'inject 应包含 locale')

// ---- 模拟 Cordis 上下文 ----
const effects = []
const localeRegistrations = []
const slotInjections = []
const slotRegistrations = []
const listeners = []

const ctx = {
  effect(factory, label) {
    effects.push(label)
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: {
    register(namespace, dictionaries) {
      localeRegistrations.push({ namespace, dictionaries })
      return () => {}
    },
  },
  slots: {
    inject(slotName, register) {
      slotInjections.push(slotName)
      return register()
    },
    register(options, Component) {
      slotRegistrations.push({ options, Component })
      return () => {}
    },
  },
  on(event, listener) {
    listeners.push({ event, listener })
    return () => {}
  },
  get() {
    return undefined
  },
}

clientHalf.apply(ctx)

console.log('--- 注册结果 ---')
console.log(`  effect: ${effects.join(' | ')}`)
console.log(`  locale: ${localeRegistrations.map((r) => r.namespace).join(', ')}`)
console.log(`  slot 注入: ${slotInjections.join(', ')}`)
for (const { options } of slotRegistrations) {
  console.log(`  slot 注册: ${options.name} / id=${options.id} / order=${options.order} / locale=${options.locale}`)
}
console.log(`  事件监听: ${listeners.map((l) => l.event).join(', ')}`)

check(headChildren.length === 1, `应插入 1 个样式节点，实际 ${headChildren.length}`)
check(headChildren[0]?.id === 'session-doc-export-style', '样式节点 id 应为 session-doc-export-style')
check(headChildren[0]?.textContent.includes('--dsw-alias-bg-overlay'), '样式应使用主题变量')
check(localeRegistrations.length === 1, '应注册 1 份文案')
check(localeRegistrations[0]?.namespace === 'session-doc-export', '文案命名空间应为 session-doc-export')
check(
  localeRegistrations[0]?.dictionaries?.zh !== undefined &&
    localeRegistrations[0]?.dictionaries?.en !== undefined,
  '文案应同时提供 zh 与 en',
)
check(
  slotInjections[0] === 'conversation.session.header.utilities',
  `应注入会话头部操作区，实际 ${slotInjections[0]}`,
)
check(slotRegistrations.length === 1, `应注册 1 个 slot 组件，实际 ${slotRegistrations.length}`)
const registration = slotRegistrations[0]
check(registration?.options?.id === 'session-doc-export', 'slot 注册 id 应为 session-doc-export')
check(typeof registration?.Component === 'function', 'slot 注册应提供组件函数')
check(
  listeners.some((item) => item.event === 'command/executed'),
  '应监听 command/executed 以支持 /export-doc',
)

// ---- 组件可用性：以替身渲染一次，确认不抛错 ----
try {
  const tree = registration.Component({
    sessionId: 'session-test',
    t: (key) => {
      const dictionary = localeRegistrations[0].dictionaries.zh
      return dictionary[key] ?? key
    },
  })
  check(tree !== null && typeof tree === 'object', '组件应返回一棵元素树')
  console.log('  组件试渲染: 通过')
} catch (error) {
  problems.push(`组件试渲染抛错：${error.message}`)
}

// ---- 重复 apply 不应重复插入样式 ----
clientHalf.apply(ctx)
check(headChildren.length === 1, `重复 apply 后样式仍应只有 1 个，实际 ${headChildren.length}`)
console.log('  重复 apply 幂等性: 通过')

// ---- 纯函数 ----
console.log('--- 纯函数 ---')
const internals = clientHalf.__test
check(internals !== undefined && internals !== null, 'factory 应暴露 __test 供离线自检')
if (internals !== undefined && internals !== null) {
  const t = (key) => localeRegistrations[0].dictionaries.zh[key] ?? key

  for (const [input, expected] of [
    [new Date(2026, 10, 24, 9, 5).getTime(), '2026-11-24 09:05'],
    [0, ''],
    [null, ''],
    [Number.NaN, ''],
  ]) {
    const got = internals.formatTime(input)
    console.log(`  formatTime(${String(input).padEnd(20)}) -> ${JSON.stringify(got)}`)
    check(got === expected, `formatTime(${String(input)}) 应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(got)}`)
  }

  for (const [input, expected] of [
    ['D:\\work\\alpha', 'alpha'],
    ['/home/u/proj', 'proj'],
    ['', ''],
  ]) {
    const got = internals.shortCwd(input)
    console.log(`  shortCwd(${JSON.stringify(input).padEnd(16)}) -> ${JSON.stringify(got)}`)
    check(got === expected, `shortCwd(${JSON.stringify(input)}) 应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(got)}`)
  }

  for (const [path, count, expected] of [
    ['D:\\work\\alpha', 2, 'work/alpha'],
    ['/home/u/proj', 2, 'u/proj'],
    ['/single', 2, 'single'],
    ['', 2, ''],
  ]) {
    const got = internals.tailPath(path, count)
    console.log(`  tailPath(${JSON.stringify(path).padEnd(16)}, ${count}) -> ${JSON.stringify(got)}`)
    check(got === expected, `tailPath(${JSON.stringify(path)}, ${count}) 应为 ${JSON.stringify(expected)}，实际 ${JSON.stringify(got)}`)
  }

  // 分组：两个同末段名的目录必须区分开，且按组内最新会话倒序。
  const grouped = internals.groupSessions([
    { id: 'a1', cwd: 'D:\\proj\\one\\src', createdAt: 100 },
    { id: 'b1', cwd: 'D:\\proj\\two\\src', createdAt: 300 },
    { id: 'a2', cwd: 'D:\\proj\\one\\src', createdAt: 200 },
    { id: 'c1', cwd: '', createdAt: 50 },
  ])
  console.log(`  groupSessions -> ${grouped.map((g) => `${g.label}(${g.items.length})`).join(', ')}`)
  check(grouped.length === 3, `应分成 3 组，实际 ${grouped.length}`)
  check(grouped[0].key === 'D:\\proj\\two\\src', '组应按组内最新会话倒序，two 在前')
  check(grouped[0].label === 'two/src', '末段同名的目录应退到末两段区分')
  check(grouped[1].items.length === 2, 'one/src 组应包含 2 个会话')
  check(grouped[2].key === '', '空 cwd 应单独成组且 key 为空串')
}

// ---- 选择器浮层结构 ----
console.log('--- 选择器浮层 ---')

/** 递归遍历元素树。 */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  if (node.children !== undefined) walk(node.children, visit)
}

/** 统计树里的复选框与选中态。 */
function countCheckboxes(tree) {
  let total = 0
  let checked = 0
  walk(tree, (node) => {
    if (node?.type === 'input' && node.props?.type === 'checkbox') {
      total += 1
      if (node.props.checked === true) checked += 1
    }
  })
  return { total, checked }
}

/** 收集树里的可见文本。 */
function collectText(tree) {
  const parts = []
  walk(tree, (node) => {
    if (node?.children === undefined) return
    for (const child of node.children) {
      if (typeof child === 'string' || typeof child === 'number') parts.push(String(child))
    }
  })
  return parts.join('|')
}

if (internals?.SessionPicker !== undefined) {
  const Picker = internals.SessionPicker
  const zhDictionary = localeRegistrations[0].dictionaries.zh
  const t = (key) => zhDictionary[key] ?? key

  const sessions = [
    {
      id: 's-alpha',
      createdAt: new Date(2026, 10, 24, 1, 30).getTime(),
      cwd: 'D:\\work\\alpha',
      origin: '',
      live: true,
      delegationDepth: 0,
    },
    {
      id: 's-beta',
      createdAt: new Date(2026, 10, 20, 3, 0).getTime(),
      cwd: 'D:\\work\\beta',
      origin: 'subagent',
      live: false,
      delegationDepth: 1,
    },
  ]

  const baseProps = {
    open: true,
    t,
    sessions,
    titles: { 's-alpha': '对话与轨迹导出功能确认' },
    loadingSessions: false,
    loadingTitles: false,
    listError: '',
    selected: [],
    currentSessionId: 's-alpha',
    query: '',
    collapsed: {},
    setQuery() {},
    onToggle() {},
    onSelectAll() {},
    onClear() {},
    onToggleGroup() {},
    onSelectGroup() {},
    onUnselectGroup() {},
    onConfirm() {},
    onClose() {},
  }

  check(Picker({ ...baseProps, open: false }) === null, '浮层未打开时应返回 null')

  const full = Picker(baseProps)
  const fullBoxes = countCheckboxes(full)
  console.log(`  全部会话: 复选框 ${fullBoxes.total} 个`)
  check(fullBoxes.total === 2, `应渲染 2 个复选框，实际 ${fullBoxes.total}`)

  const text = collectText(full)
  check(text.includes('对话与轨迹导出功能确认'), '应显示已折叠的标题')
  check(text.includes(t('picker.untitled')), '没有标题的会话应显示未命名占位')
  check(text.includes(t('picker.subagent')), '子 Agent 会话应带标记')

  const filtered = Picker({ ...baseProps, query: 'beta' })
  const filteredBoxes = countCheckboxes(filtered)
  console.log(`  搜索 beta: 复选框 ${filteredBoxes.total} 个`)
  check(filteredBoxes.total === 1, `搜索应过滤到 1 个，实际 ${filteredBoxes.total}`)

  const picked = Picker({ ...baseProps, selected: ['s-alpha'] })
  const pickedBoxes = countCheckboxes(picked)
  console.log(`  已选 s-alpha: 复选框 ${pickedBoxes.total} 个 / 勾选 ${pickedBoxes.checked} 个`)
  check(pickedBoxes.checked === 1, `应恰好勾选 1 个，实际 ${pickedBoxes.checked}`)

  const loading = Picker({ ...baseProps, loadingSessions: true, sessions: [] })
  check(collectText(loading).includes(t('picker.loading')), '加载中应显示提示')

  const failed = Picker({ ...baseProps, listError: 'HTTP 500', sessions: [] })
  check(collectText(failed).includes('HTTP 500'), '列表失败应把原因显示出来')

  const empty = Picker({ ...baseProps, sessions: [], query: 'zzz' })
  check(collectText(empty).includes(t('picker.empty')), '无匹配时应显示空态')

  // 按工作区分组：组头显示目录名，可折叠，搜索命中时强制展开。
  const groupedText = collectText(full)
  check(groupedText.includes('alpha'), '组头应显示工作区名 alpha')
  check(groupedText.includes('beta'), '组头应显示工作区名 beta')
  check(groupedText.includes(t('picker.group.all')), '每个组头应有组内全选按钮')

  const folded = Picker({ ...baseProps, collapsed: { 'D:\\work\\beta': true } })
  const foldedBoxes = countCheckboxes(folded)
  console.log(`  折叠 beta 组: 复选框 ${foldedBoxes.total} 个`)
  check(foldedBoxes.total === 1, `折叠一组后应只剩 1 个复选框，实际 ${foldedBoxes.total}`)
  check(collectText(folded).includes('beta'), '折叠后组头仍应显示')

  const searchFolded = Picker({ ...baseProps, collapsed: { 'D:\\work\\beta': true }, query: 'beta' })
  const searchFoldedBoxes = countCheckboxes(searchFolded)
  console.log(`  折叠 + 搜索 beta: 复选框 ${searchFoldedBoxes.total} 个`)
  check(searchFoldedBoxes.total === 1, '搜索命中时即使折叠也要展开，否则等于没搜到')

  const groupPicked = Picker({ ...baseProps, selected: ['s-alpha'] })
  check(
    collectText(groupPicked).includes(t('picker.group.clear')),
    '组内全部勾选后按钮应变为取消全选',
  )

  // 真把每个按钮的 onClick 跑一遍：纯渲染通过不代表闭包里的变量还在。
  const clickables = []
  walk(full, (node) => {
    if (node?.type === 'button' && typeof node.props?.onClick === 'function') clickables.push(node)
  })
  console.log(`  可点击按钮 ${clickables.length} 个`)
  check(clickables.length >= 3, `应至少 3 个可点按钮（全选/清空/导出），实际 ${clickables.length}`)
  let clickError = ''
  for (const node of clickables) {
    try {
      node.props.onClick({ stopPropagation() {} })
    } catch (failure) {
      clickError = `${node.props.className}: ${failure instanceof Error ? failure.message : failure}`
      break
    }
  }
  check(clickError === '', `按钮点击不应抛错，实际 ${clickError}`)
}

if (problems.length > 0) {
  console.error('\n失败项：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log('\n全部断言通过。')
}
