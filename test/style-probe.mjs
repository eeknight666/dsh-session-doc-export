/**
 * 样式探针：把两种真实出现的正文结构渲染成 HTML，供人眼/截图核对。
 *
 *   结构一：围栏代码块（```）
 *   结构二：段落里的行内代码（`docker rm -f xxx`）
 *
 * 目的只有一个：验证 pre 内的 code 是否被行内样式污染成「白底浅字」。
 */

import { writeFileSync } from 'node:fs'
import { renderHtml } from '../lib/render-html.js'

const fence = '```'

const assistantText = [
  '#### （1）清理旧容器',
  '',
  fence,
  "docker ps -a --no-trunc | grep -E 'ilov-latch|9078|987'",
  'docker rm -f 263c2a16cf7',
  fence,
  '',
  '围栏代码块结束，下面是行内代码：',
  '',
  '执行 `docker rm -f 263c2a16cf7` 清理，然后 `docker compose up -d` 重启。',
  '',
  '普通段落文字，用来对照颜色。',
  '',
  '| 步骤 | 命令 |',
  '| --- | --- |',
  '| 1 | `docker rm -f abc` |',
].join('\n')

const doc = {
  meta: {
    id: 'style-probe',
    title: '样式探针',
    createdAt: Date.now(),
    cwd: 'D:\\probe',
    model: 'probe',
    config: null,
  },
  items: [
    { kind: 'user', time: Date.now(), text: '请按顺序执行' },
    {
      kind: 'assistant',
      time: Date.now(),
      text: assistantText,
      reasoning: '',
      usage: null,
      interrupted: false,
    },
  ],
  systemPrompts: [],
  skippedInjected: 0,
  counts: { user: 1, assistant: 1, tool: 0 },
  eventCount: 2,
}

const target = new URL('./out/style-probe.html', import.meta.url)
writeFileSync(target, renderHtml(doc, { mode: 'trajectory' }), 'utf8')
console.log('written', target.pathname)
