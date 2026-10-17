/**
 * The feature tour's GIF, encoded in-process (Playwright's ffmpeg build cannot write GIF) from
 * PNG screenshots.
 */
import { writeFileSync } from 'node:fs'
import gifenc from 'gifenc'
import pngjs from 'pngjs'

const { GIFEncoder, quantize, applyPalette } = gifenc
const { PNG } = pngjs

function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

/**
 * One palette for the whole tour, sampled from every frame, so a colour never changes
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
