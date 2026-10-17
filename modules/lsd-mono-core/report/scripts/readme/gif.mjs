/**
 * GIF encoding for the README samples, in-process (Playwright's ffmpeg build cannot write GIF).
 * Frames are PNG screenshots.
 */
import { writeFileSync } from 'node:fs'
import gifenc from 'gifenc'
import pngjs from 'pngjs'

const { GIFEncoder, quantize, applyPalette } = gifenc
const { PNG } = pngjs

export function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

function scaleRgba(rgba, width, height, targetWidth) {
  if (width <= targetWidth) return { data: rgba, width, height }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width))
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / targetHeight))
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / targetWidth))
      const si = (sy * width + sx) * 4
      const di = (y * targetWidth + x) * 4
      out[di] = rgba[si]
      out[di + 1] = rgba[si + 1]
      out[di + 2] = rgba[si + 2]
      out[di + 3] = 255
    }
  }
  return { data: out, width: targetWidth, height: targetHeight }
}

/** Area-average downscale. Keeps thin diagonal edges solid where nearest-pixel sampling breaks them up. */
function scaleRgbaSmooth(rgba, width, height, targetWidth) {
  if (width <= targetWidth) return { data: rgba, width, height }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width))
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  const fx = width / targetWidth
  const fy = height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * fy)))
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * fx)))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * width + sx) * 4
          r += rgba[si]
          g += rgba[si + 1]
          b += rgba[si + 2]
          n++
        }
      }
      const di = (y * targetWidth + x) * 4
      out[di] = Math.round(r / n)
      out[di + 1] = Math.round(g / n)
      out[di + 2] = Math.round(b / n)
      out[di + 3] = 255
    }
  }
  return { data: out, width: targetWidth, height: targetHeight }
}

function sampleForPalette(frames) {
  const picks = [0, Math.floor(frames.length / 2), frames.length - 1]
  const chunks = []
  for (const index of picks) {
    const { data } = frames[index]
    for (let i = 0; i < data.length; i += 16) chunks.push(data[i], data[i + 1], data[i + 2], 255)
  }
  return new Uint8Array(chunks)
}

export function writeGif(frames, file, { smooth = false, colours = 80 } = {}) {
  const scale = smooth ? scaleRgbaSmooth : scaleRgba
  const scaled = frames.map((frame) => scale(frame.data, frame.width, frame.height, 760))
  const palette = quantize(sampleForPalette(scaled), colours)
  const gif = GIFEncoder()
  let index = 0
  while (index < scaled.length) {
    let count = 1
    while (index + count < scaled.length && frames[index + count] === frames[index]) count++
    const frame = scaled[index]
    const indexed = applyPalette(frame.data, palette)
    gif.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: 125 * count,
      repeat: 0,
    })
    index += count
  }
  gif.finish()
  writeFileSync(file, Buffer.from(gif.bytes()))
}

/**
 * The feature tour's encoding. One palette for the whole tour, sampled from every frame, so a colour never changes
 * between frames. Each frame then only stores the pixels that changed; the rest is the
 * transparent index, drawn over the previous frame. That keeps a 30 s tour to a few MB.
 */
function tourPalette(frames) {
  const stride = 31
  const parts = frames.map((frame) => {
    const { data } = decodePng(frame.png)
    const out = new Uint8Array(Math.ceil(data.length / 4 / stride) * 4)
    for (let p = 0, o = 0; p * 4 < data.length; p += stride, o += 4) {
      out[o] = data[p * 4]
      out[o + 1] = data[p * 4 + 1]
      out[o + 2] = data[p * 4 + 2]
      out[o + 3] = 255
    }
    return out
  })
  const sample = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    sample.set(part, offset)
    offset += part.length
  }
  return quantize(sample, 255)
}

/** Write the tour [frames] (PNG + delay, each [width]×[height]) to [file]. */
export function encodeTour(frames, file, width, height) {
  const palette = tourPalette(frames)
  const transparentIndex = 255
  const padded = [...palette]
  while (padded.length < 256) padded.push([255, 0, 255])
  const gif = GIFEncoder()
  let previous = null
  for (const frame of frames) {
    const { data } = decodePng(frame.png)
    const indexed = applyPalette(data, palette)
    if (previous) {
      for (let p = 0, i = 0; p < indexed.length; p++, i += 4) {
        if (previous[i] === data[i] && previous[i + 1] === data[i + 1] && previous[i + 2] === data[i + 2]) {
          indexed[p] = transparentIndex
        }
      }
    }
    gif.writeFrame(indexed, width, height, {
      palette: padded,
      delay: frame.delay,
      repeat: 0,
      dispose: 1,
      ...(previous ? { transparent: true, transparentIndex } : {}),
    })
    previous = data
  }
  gif.finish()
  writeFileSync(file, Buffer.from(gif.bytes()))
}
