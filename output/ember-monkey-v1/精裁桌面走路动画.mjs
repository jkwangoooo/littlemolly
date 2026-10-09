import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

const root = path.resolve('output/ember-monkey-v1')
const sourcePath = path.join(root, '新行走图集', '走路动画-RGBA.png')
const frameDir = path.join(root, '新行走帧-精裁')
const previewDir = path.join(root, '新行走帧预览')
fs.mkdirSync(frameDir, { recursive: true })
fs.mkdirSync(previewDir, { recursive: true })

function decodePng(file) {
  const bytes = fs.readFileSync(file)
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (pos < bytes.length) {
    const size = bytes.readUInt32BE(pos)
    const name = bytes.toString('ascii', pos + 4, pos + 8)
    const data = bytes.subarray(pos + 8, pos + 8 + size)
    if (name === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    }
    if (name === 'IDAT') idat.push(data)
    pos += size + 12
    if (name === 'IEND') break
  }
  if (colorType !== 6) throw new Error(`预期 RGBA PNG，收到 type ${colorType}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const channels = 4
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * channels)
  let at = 0
  let previous = Buffer.alloc(stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y += 1) {
    const filter = raw[at++]
    const row = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0
      const up = previous[x]
      const upperLeft = x >= channels ? previous[x - channels] : 0
      let value = raw[at++]
      if (filter === 1) value = (value + left) & 255
      else if (filter === 2) value = (value + up) & 255
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) value = (value + paeth(left, up, upperLeft)) & 255
      row[x] = value
    }
    row.copy(pixels, y * stride)
    previous = row
  }
  return { width, height, pixels }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(name, data) {
  const type = Buffer.from(name, 'ascii')
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  type.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8)
  return out
}

function encodePng(file, width, height, pixels) {
  const rows = []
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]))
    rows.push(pixels.subarray(y * width * 4, (y + 1) * width * 4))
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

function composite(pixels, color) {
  const out = Buffer.alloc(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    out[i] = Math.round(pixels[i] * alpha + color[0] * (1 - alpha))
    out[i + 1] = Math.round(pixels[i + 1] * alpha + color[1] * (1 - alpha))
    out[i + 2] = Math.round(pixels[i + 2] * alpha + color[2] * (1 - alpha))
    out[i + 3] = 255
  }
  return out
}

const image = decodePng(sourcePath)
if (image.width !== 2048 || image.height !== 2048) throw new Error('源图必须是 2048x2048 RGBA PNG')
const columns = 4
const rows = 3
const cellWidth = image.width / columns
const cellHeight = Math.floor(image.height / rows)
const outputSize = 256
const threshold = 8
const cellInsets = Array.from({ length: 12 }, () => ({ left: 38, right: 38, top: 20, bottom: 18 }))
const analyzedFrames = []

for (let index = 0; index < columns * rows; index += 1) {
  const col = index % columns
  const row = Math.floor(index / columns)
  const sampled = Buffer.alloc(cellWidth * cellHeight * 4)
  for (let y = 0; y < cellHeight; y += 1) {
    const sourceStart = ((row * cellHeight + y) * image.width + col * cellWidth) * 4
    sampled.set(image.pixels.subarray(sourceStart, sourceStart + cellWidth * 4), y * cellWidth * 4)
  }

  const visited = new Uint8Array(cellWidth * cellHeight)
  const components = []
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const start = y * cellWidth + x
      if (visited[start] || sampled[start * 4 + 3] <= threshold) continue
      const queue = [start]
      visited[start] = 1
      let size = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      while (queue.length) {
        const current = queue.pop()
        const currentX = current % cellWidth
        const currentY = Math.floor(current / cellWidth)
        size += 1
        minX = Math.min(minX, currentX)
        maxX = Math.max(maxX, currentX)
        minY = Math.min(minY, currentY)
        maxY = Math.max(maxY, currentY)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nextX = currentX + dx
          const nextY = currentY + dy
          if (nextX < 0 || nextX >= cellWidth || nextY < 0 || nextY >= cellHeight) continue
          const next = nextY * cellWidth + nextX
          if (!visited[next] && sampled[next * 4 + 3] > threshold) {
            visited[next] = 1
            queue.push(next)
          }
        }
      }
      components.push({ size, minX, maxX, minY, maxY })
    }
  }

  const largest = components.sort((a, b) => b.size - a.size)[0]
  if (!largest) throw new Error(`第 ${index + 1} 帧没有可见主体`)

  // Retain the primary figure and nearby components large enough to be real detached art, such as a separated flame tip.
  const minArtifactSize = Math.max(120, Math.floor(largest.size * 0.0015))
  const subjectCenterX = (largest.minX + largest.maxX) / 2
  const subjectCenterY = (largest.minY + largest.maxY) / 2
  const keepComponents = components.filter((component) => {
    const nearFigure = component.minX <= largest.maxX + 26 && component.maxX >= largest.minX - 26
      && component.minY <= largest.maxY + 26 && component.maxY >= largest.minY - 26
    const centerDistance = Math.hypot((component.minX + component.maxX) / 2 - subjectCenterX, (component.minY + component.maxY) / 2 - subjectCenterY)
    return component === largest || (component.size >= minArtifactSize && nearFigure && centerDistance < 105)
  })
  const keep = new Uint8Array(cellWidth * cellHeight)
  for (const component of keepComponents) {
    const queue = []
    for (let y = component.minY; y <= component.maxY; y += 1) {
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const indexInCell = y * cellWidth + x
        if (sampled[indexInCell * 4 + 3] > threshold && !keep[indexInCell]) {
          keep[indexInCell] = 1
          queue.push(indexInCell)
        }
      }
    }
    while (queue.length) {
      const current = queue.pop()
      const currentX = current % cellWidth
      const currentY = Math.floor(current / cellWidth)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = currentX + dx
        const nextY = currentY + dy
        if (nextX < 0 || nextX >= cellWidth || nextY < 0 || nextY >= cellHeight) continue
        const next = nextY * cellWidth + nextX
        if (!keep[next] && sampled[next * 4 + 3] > threshold) {
          keep[next] = 1
          queue.push(next)
        }
      }
    }
  }
  for (let pixel = 0; pixel < keep.length; pixel += 1) {
    if (!keep[pixel]) sampled[pixel * 4 + 3] = 0
  }

  let minX = cellWidth
  let minY = cellHeight
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      if (sampled[(y * cellWidth + x) * 4 + 3] > threshold) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  const margin = 3
  minX = Math.max(0, minX - margin)
  minY = Math.max(0, minY - margin)
  maxX = Math.min(cellWidth - 1, maxX + margin)
  maxY = Math.min(cellHeight - 1, maxY + margin)
  analyzedFrames.push({ index, col, row, sampled, bounds: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 } })
}

const scale = Math.min(...analyzedFrames.map(({ bounds }) => Math.min((outputSize - 12) / bounds.width, (outputSize - 16) / bounds.height)))
const frames = []
for (const { index, col, row, sampled, bounds } of analyzedFrames) {
  const drawWidth = Math.round(bounds.width * scale)
  const drawHeight = Math.round(bounds.height * scale)
  const dx = Math.floor((outputSize - drawWidth) / 2)
  const baseline = outputSize - 4
  const dy = baseline - drawHeight
  const output = Buffer.alloc(outputSize * outputSize * 4)
  for (let y = 0; y < drawHeight; y += 1) {
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = bounds.minX + Math.min(bounds.width - 1, Math.floor(x / scale))
      const sourceY = bounds.minY + Math.min(bounds.height - 1, Math.floor(y / scale))
      const source = (sourceY * cellWidth + sourceX) * 4
      const target = ((dy + y) * outputSize + dx + x) * 4
      sampled.copy(output, target, source, source + 4)
    }
  }
  const name = `行走-${String(index + 1).padStart(2, '0')}.png`
  encodePng(path.join(frameDir, name), outputSize, outputSize, output)
  frames.push({ name, sourceCell: { row: row + 1, column: col + 1 }, crop: bounds, scale, draw: { x: dx, y: dy, width: drawWidth, height: drawHeight } })
}

const preview = Buffer.alloc(1024 * 768 * 4)
for (let index = 0; index < frames.length; index += 1) {
  const imageFrame = decodePng(path.join(frameDir, frames[index].name))
  const view = composite(imageFrame.pixels, index % 2 ? [50, 43, 44] : [250, 244, 236])
  const col = index % 4
  const row = Math.floor(index / 4)
  for (let y = 0; y < 256; y += 1) {
    view.copy(preview, ((row * 256 + y) * 1024 + col * 256) * 4, y * 1024, y * 1024 + 1024)
  }
}
encodePng(path.join(previewDir, '新增12帧-精裁明暗背景.png'), 1024, 768, preview)
const manifest = {
  version: 3,
  source: '新行走图集/走路动画-RGBA.png',
  sourceSize: { width: image.width, height: image.height },
  sourceColorType: 'RGBA; original alpha preserved',
  grid: { columns, rows, referenceCell: { width: cellWidth, height: cellHeight } },
  cropMethod: 'per-cell connected alpha components, tight alpha bounds, shared scale and aligned foot baseline',
  outputFrameSize: { width: outputSize, height: outputSize },
  frames,
  preview: '新行走帧预览/新增12帧-精裁明暗背景.png',
}
fs.writeFileSync(path.join(root, '新增行走帧精裁清单.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ source: `${image.width}x${image.height}`, frames: frames.length, outputFrame: `${outputSize}x${outputSize}`, scale, preview: manifest.preview }, null, 2))
