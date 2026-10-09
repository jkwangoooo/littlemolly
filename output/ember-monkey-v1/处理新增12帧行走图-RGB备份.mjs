import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

const root = path.resolve('output/ember-monkey-v1')
const sourcePath = path.join(root, '新行走图集', '原始12帧图集.png')
const frameDir = path.join(root, '新行走帧')
const previewDir = path.join(root, '新行走帧预览')
fs.mkdirSync(frameDir, { recursive: true }); fs.mkdirSync(previewDir, { recursive: true })

function decodePng(file) {
  const bytes = fs.readFileSync(file); let pos = 8; let width = 0; let height = 0; let colorType = 0; const data = []
  while (pos < bytes.length) { const size = bytes.readUInt32BE(pos); const name = bytes.toString('ascii', pos + 4, pos + 8); const chunk = bytes.subarray(pos + 8, pos + 8 + size); if (name === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); colorType = chunk[9] } if (name === 'IDAT') data.push(chunk); pos += size + 12; if (name === 'IEND') break }
  if (colorType !== 2 && colorType !== 6) throw new Error(`只支持 RGB/RGBA PNG，实际 type ${colorType}`)
  const raw = zlib.inflateSync(Buffer.concat(data)); const channels = colorType === 6 ? 4 : 3; const stride = width * channels; const pixels = Buffer.alloc(width * height * channels); let cursor = 0; let prior = Buffer.alloc(stride)
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < height; y += 1) { const filter = raw[cursor++]; const row = Buffer.alloc(stride); for (let x = 0; x < stride; x += 1) { const left = x >= channels ? row[x - channels] : 0; const up = prior[x]; const upperLeft = x >= channels ? prior[x - channels] : 0; let v = raw[cursor++]; if (filter === 1) v = (v + left) & 255; else if (filter === 2) v = (v + up) & 255; else if (filter === 3) v = (v + Math.floor((left + up) / 2)) & 255; else if (filter === 4) v = (v + paeth(left, up, upperLeft)) & 255; row[x] = v } row.copy(pixels, y * stride); prior = row }
  return { width, height, channels, pixels }
}
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
function chunk(name, data) { const type = Buffer.from(name, 'ascii'); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8); return out }
function encodePng(file, width, height, pixels) { const rows = []; for (let y = 0; y < height; y += 1) { rows.push(Buffer.from([0])); rows.push(pixels.subarray(y * width * 4, (y + 1) * width * 4)) } const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; fs.writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))])) }
function composite(pixels, color) { const out = Buffer.alloc(pixels.length); for (let i = 0; i < pixels.length; i += 4) { const a = pixels[i + 3] / 255; out[i] = Math.round(pixels[i] * a + color[0] * (1 - a)); out[i + 1] = Math.round(pixels[i + 1] * a + color[1] * (1 - a)); out[i + 2] = Math.round(pixels[i + 2] * a + color[2] * (1 - a)); out[i + 3] = 255 } return out }

const image = decodePng(sourcePath); if (image.width !== 2048 || image.height !== 2048 || image.channels !== 3) throw new Error('源图必须是 2048x2048 RGB PNG'); const cell = 512; const outputSize = 256; const frames = []; const sourceBg = [248, 248, 248]
for (let index = 0; index < 12; index += 1) {
  const col = index % 4; const row = Math.floor(index / 4); const sampled = Buffer.alloc(cell * cell * 4)
  for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) { const source = ((row * cell + y) * image.width + col * cell + x) * image.channels; const target = (y * cell + x) * 4; sampled[target] = image.pixels[source]; sampled[target + 1] = image.pixels[source + 1]; sampled[target + 2] = image.pixels[source + 2] }
  // Remove the baked near-white checkerboard while keeping dark outlines and warm character colors.
  for (let i = 0; i < sampled.length; i += 4) { const dr = sampled[i] - sourceBg[0]; const dg = sampled[i + 1] - sourceBg[1]; const db = sampled[i + 2] - sourceBg[2]; const distance = Math.sqrt(dr * dr + dg * dg + db * db); sampled[i + 3] = Math.round(Math.max(0, Math.min(1, (distance - 10) / 30)) * 255) }
  let minX = cell; let minY = cell; let maxX = -1; let maxY = -1; let transparentPixels = 0; let opaquePixels = 0
  for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) { const p = (y * cell + x) * 4; if (sampled[p + 3] === 0) transparentPixels += 1; if (sampled[p + 3] === 255) opaquePixels += 1; if (sampled[p + 3] > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) } }
  const pad = 12; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(cell - 1, maxX + pad); maxY = Math.min(cell - 1, maxY + pad); const cropWidth = maxX - minX + 1; const cropHeight = maxY - minY + 1; const scale = Math.min(outputSize / cropWidth, outputSize / cropHeight); const drawWidth = Math.round(cropWidth * scale); const drawHeight = Math.round(cropHeight * scale); const normalized = Buffer.alloc(outputSize * outputSize * 4); const dx = Math.floor((outputSize - drawWidth) / 2); const dy = Math.floor((outputSize - drawHeight) / 2)
  for (let y = 0; y < drawHeight; y += 1) for (let x = 0; x < drawWidth; x += 1) { const sx = minX + Math.min(cropWidth - 1, Math.floor(x / scale)); const sy = minY + Math.min(cropHeight - 1, Math.floor(y / scale)); const s = (sy * cell + sx) * 4; const t = ((dy + y) * outputSize + dx + x) * 4; sampled.copy(normalized, t, s, s + 4) }
  const name = `行走-${String(index + 1).padStart(2, '0')}.png`; encodePng(path.join(frameDir, name), outputSize, outputSize, normalized); frames.push({ name, sourceCell: { row: row + 1, column: col + 1 }, width: outputSize, height: outputSize, transparentPixels, opaquePixels })
}
const preview = Buffer.alloc(1024 * 768 * 4)
for (let index = 0; index < frames.length; index += 1) { const imageFrame = decodePng(path.join(frameDir, frames[index].name)); const bg = index % 2 ? [50, 43, 44] : [250, 244, 236]; const shown = composite(imageFrame.pixels, bg); const col = index % 4; const row = Math.floor(index / 4); for (let y = 0; y < 256; y += 1) shown.copy(preview, ((row * 256 + y) * 1024 + col * 256) * 4, y * 1024, y * 1024 + 1024) }
encodePng(path.join(previewDir, '新增12帧-明暗背景.png'), 1024, 768, preview)
const manifest = { version: 1, source: '新行走图集/原始12帧图集.png', sourceSize: { width: image.width, height: image.height }, sourceColorType: 'RGB; checkerboard baked into pixels', grid: { columns: 4, rows: 3, cell: 512 }, outputFrameSize: { width: 256, height: 256 }, backgroundRemoval: { method: 'near-white color distance matte', referenceRgb: sourceBg, caveat: 'generated checkerboard is not an alpha channel; inspect for pale edge halos before production' }, frames, preview: '新行走帧预览/新增12帧-明暗背景.png' }
fs.writeFileSync(path.join(root, '新增行走帧清单.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ source: `${image.width}x${image.height}`, frames: frames.length, outputFrame: '256x256', preview: manifest.preview }, null, 2))
