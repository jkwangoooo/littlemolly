import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

const root = path.resolve('output/ember-monkey-v1')
const input = path.join(root, '原图切帧', '原始精灵图.png')
const rawDir = path.join(root, '原图切帧')
const frameDir = path.join(root, '透明帧')
const previewDir = path.join(root, '预览')
for (const dir of [rawDir, frameDir, previewDir]) fs.mkdirSync(dir, { recursive: true })

function readPng(file) {
  const bytes = fs.readFileSync(file); let pos = 8; let width = 0; let height = 0; let type = 0; const idat = []
  while (pos < bytes.length) { const size = bytes.readUInt32BE(pos); const name = bytes.toString('ascii', pos + 4, pos + 8); const data = bytes.subarray(pos + 8, pos + 8 + size); if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9] } if (name === 'IDAT') idat.push(data); pos += size + 12; if (name === 'IEND') break }
  if (type !== 6) throw new Error(`只支持 RGBA PNG，收到 ${type}`)
  const decoded = zlib.inflateSync(Buffer.concat(idat)); const channels = 4; const stride = width * channels; const pixels = Buffer.alloc(width * height * channels); let at = 0; let previous = Buffer.alloc(stride)
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < height; y += 1) { const filter = decoded[at++]; const row = Buffer.alloc(stride); for (let x = 0; x < stride; x += 1) { const left = x >= channels ? row[x - channels] : 0; const up = previous[x]; const ul = x >= channels ? previous[x - channels] : 0; let v = decoded[at++]; if (filter === 1) v = (v + left) & 255; else if (filter === 2) v = (v + up) & 255; else if (filter === 3) v = (v + Math.floor((left + up) / 2)) & 255; else if (filter === 4) v = (v + paeth(left, up, ul)) & 255; row[x] = v } row.copy(pixels, y * stride); previous = row }
  return { width, height, pixels }
}
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
function chunk(name, data) { const t = Buffer.from(name, 'ascii'); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8); return out }
function writePng(file, width, height, pixels) { const rows = []; for (let y = 0; y < height; y += 1) { rows.push(Buffer.from([0])); rows.push(pixels.subarray(y * width * 4, (y + 1) * width * 4)) } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))])) }
function composite(frame, color) { const out = Buffer.alloc(frame.length); for (let i = 0; i < frame.length; i += 4) { const a = frame[i + 3] / 255; out[i] = Math.round(frame[i] * a + color[0] * (1 - a)); out[i + 1] = Math.round(frame[i + 1] * a + color[1] * (1 - a)); out[i + 2] = Math.round(frame[i + 2] * a + color[2] * (1 - a)); out[i + 3] = 255 } return out }

const image = readPng(input); if (image.width !== 2048 || image.height !== 2048) throw new Error('预期 2048x2048 输入图')
const cell = 512; const names = ['待机睁眼-01', '待机火焰-02', '待机火焰-03', '眨眼半闭', '眨眼闭眼', '左走-01', '左走-02', '左走-03', '左走-04', '左走-05', '左走-06', '释放缓冲-01', '释放恢复-02']; const rawFrames = []; const frames = []
for (let index = 0; index < 16; index += 1) {
  const col = index % 4; const row = Math.floor(index / 4); const pixels = Buffer.alloc(cell * cell * 4); let visible = 0; let partial = 0
  for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) { const s = ((row * cell + y) * image.width + col * cell + x) * 4; const t = (y * cell + x) * 4; image.pixels.copy(pixels, t, s, s + 4); const a = pixels[t + 3]; if (a > 0) visible += 1; if (a > 0 && a < 255) partial += 1 }
  rawFrames.push(pixels); const name = names[index]; writePng(path.join(rawDir, `${String(index + 1).padStart(2, '0')}-${name || '空白格'}.png`), cell, cell, pixels); if (!name) continue
  let minX = cell; let minY = cell; let maxX = -1; let maxY = -1
  for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) if (pixels[(y * cell + x) * 4 + 3] > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  const pad = 18; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(cell - 1, maxX + pad); maxY = Math.min(cell - 1, maxY + pad); const cw = maxX - minX + 1; const ch = maxY - minY + 1; const scale = Math.min(256 / cw, 256 / ch); const dw = Math.max(1, Math.round(cw * scale)); const dh = Math.max(1, Math.round(ch * scale)); const normalized = Buffer.alloc(256 * 256 * 4); const dx = Math.floor((256 - dw) / 2); const dy = Math.floor((256 - dh) / 2)
  for (let y = 0; y < dh; y += 1) for (let x = 0; x < dw; x += 1) { const sx = minX + Math.min(cw - 1, Math.floor(x / scale)); const sy = minY + Math.min(ch - 1, Math.floor(y / scale)); const s = (sy * cell + sx) * 4; const t = ((dy + y) * 256 + dx + x) * 4; pixels.copy(normalized, t, s, s + 4) }
  const file = path.join(frameDir, `${String(index + 1).padStart(2, '0')}-${name}.png`); writePng(file, 256, 256, normalized); frames.push({ index: index + 1, name, sourceCell: { row: row + 1, column: col + 1 }, file: path.relative(root, file).replaceAll('\\', '/'), canvas: { width: 256, height: 256 }, sourceBounds: { x: minX, y: minY, width: cw, height: ch }, visiblePixels: visible, partialAlphaPixels: partial })
}
const preview = Buffer.alloc(1024 * 1024 * 4)
for (let index = 0; index < 16; index += 1) { const col = index % 4; const row = Math.floor(index / 4); const frame = index < frames.length ? readPng(path.join(root, frames[index].file)).pixels : rawFrames[index]; const view = composite(frame, index % 2 === 0 ? [250, 244, 236] : [50, 43, 44]); for (let y = 0; y < 256; y += 1) view.copy(preview, ((row * 256 + y) * 1024 + col * 256) * 4, y * 1024, y * 1024 + 256 * 4) }
writePng(path.join(previewDir, '统一尺寸帧预览-明暗背景.png'), 1024, 1024, preview)
const manifest = { version: 1, source: '原图切帧/原始精灵图.png', sourceSize: { width: image.width, height: image.height }, grid: { columns: 4, rows: 4, cell: 512 }, runtimeFrameSize: { width: 256, height: 256 }, frames, preview: '预览/统一尺寸帧预览-明暗背景.png', note: '来自用户精灵图的 RGBA 网格切片；按透明外接框等比居中缩放，未做模型重绘或污边修复；第 16 格为空白。' }
fs.writeFileSync(path.join(root, '透明帧清单.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ source: `${image.width}x${image.height}`, frames: frames.length, runtimeFrame: '256x256', preview: manifest.preview }, null, 2))
