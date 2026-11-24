/**
 * 极简 ZIP 打包器（无第三方依赖）。
 *
 * 只覆盖批量导出需要的那部分：文件条目、UTF-8 文件名、每个条目按大小自己决定
 * store（不压缩）还是 deflate。刻意不实现 Zip64 —— 单次导出的会话数远小于
 * 65535，总大小也远小于 4GB。
 *
 * 自己写而不是引依赖的原因：插件要能离线装进 profile，DSH 侧不装 npm 包。
 */

import { deflateRawSync } from 'node:zlib'

/** CRC-32 查表（IEEE 802.3 多项式，与 ZIP 规范一致）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * 计算 CRC-32。
 * @param {Buffer} buffer 字节内容。
 * @returns {number} 无符号 32 位校验值。
 */
function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 把 Date 编码成 DOS 时间/日期（ZIP 本地头与中央目录都用它）。
 * @param {Date} date 时间。
 * @returns {{time: number, date: number}} 两个 16 位字段。
 */
function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** UTF-8 文件名标志位（通用位标记 bit 11）。 */
const FLAG_UTF8 = 0x0800
/** 本地文件头签名。 */
const LOCAL_SIGNATURE = 0x04034b50
/** 中央目录项签名。 */
const CENTRAL_SIGNATURE = 0x02014b50
/** 中央目录结束记录签名。 */
const END_SIGNATURE = 0x06054b50

/**
 * 把若干文件打成 ZIP。
 * @param {{name: string, data: Buffer|Uint8Array}[]} entries 条目（顺序即写入顺序）。
 * @param {Date} [now] 条目时间戳，默认当前时间。
 * @returns {Buffer} 完整 ZIP 字节。
 */
export function buildZip(entries, now = new Date()) {
  const stamp = dosDateTime(now)
  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(raw)

    const deflated = deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const payload = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(20, 4) // 解压所需版本 2.0
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // 扩展字段长度

    localChunks.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(20, 4) // 创建者版本
    central.writeUInt16LE(20, 6) // 解压所需版本
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // 扩展字段
    central.writeUInt16LE(0, 32) // 注释
    central.writeUInt16LE(0, 34) // 起始磁盘号
    central.writeUInt16LE(0, 36) // 内部属性
    central.writeUInt32LE(0, 38) // 外部属性
    central.writeUInt32LE(offset, 42) // 本地头偏移

    centralChunks.push(central, name)
    offset += local.length + name.length + payload.length
  }

  const centralBuffer = Buffer.concat(centralChunks)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(0, 4) // 当前磁盘号
  end.writeUInt16LE(0, 6) // 中央目录起始磁盘号
  end.writeUInt16LE(entries.length, 8) // 本盘条目数
  end.writeUInt16LE(entries.length, 10) // 总条目数
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // 注释长度

  return Buffer.concat([...localChunks, centralBuffer, end])
}
