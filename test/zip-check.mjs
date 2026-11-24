/**
 * ZIP 单元自检：造一个带中文文件名、可压缩大文本、不可压缩短文本的包，
 * 交给系统解压器验证 —— 结构对不对，不能只靠"看起来像 PK"。
 *
 *   node test\zip-check.mjs
 *   然后 PowerShell：Expand-Archive test\out\bundle.zip -DestinationPath test\out\bundle
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { buildZip } from '../lib/zip.js'

const outDir = new URL('./out/', import.meta.url)
mkdirSync(outDir, { recursive: true })

const prose = '测试内容：这条会话里有中文、标点、以及重复段落 abc 123。\n'.repeat(1500)
const entries = [
  { name: '001_对话与轨迹导出功能确认_含轨迹.md', data: Buffer.from(prose, 'utf8') },
  { name: '002_短标题.md', data: Buffer.from('短内容 ~ 中文文件名', 'utf8') },
  { name: '003_empty.json', data: Buffer.from('{}', 'utf8') },
]

const zip = buildZip(entries)
writeFileSync(new URL('./bundle.zip', outDir), zip)

const raw = entries.reduce((sum, entry) => sum + entry.data.length, 0)
console.log(`条目 ${entries.length} 个，原始 ${raw} 字节，ZIP ${zip.length} 字节`)
console.log(`本地头签名 ${zip.subarray(0, 4).toString('hex')}（应为 504b0304）`)
console.log(`中央目录签名 ${zip.subarray(zip.length - 22, zip.length - 18).toString('hex')}（应为 504b0506）`)
