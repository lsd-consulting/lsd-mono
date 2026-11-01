#!/usr/bin/env node
// Replays a live capture stream (one JSON message per line) to a running studio, for demos and for
// trying a sender's output by hand:
//   npm run replay -- protocol/fixtures/streams/checkout.jsonl [--url ws://127.0.0.1:7357/ws/captures] [--delay 800]
// Prints each message the server answers. Stops when the server closes the socket.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { WebSocket } from 'ws'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:7357/ws/captures' },
    delay: { type: 'string', default: '500' },
  },
})
if (positionals.length !== 1) {
  console.error('Usage: replay-capture.mjs <stream.jsonl> [--url ws://host:port/ws/captures] [--delay ms]')
  process.exit(2)
}
const lines = readFileSync(positionals[0], 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
const delay = Number(values.delay)
const socket = new WebSocket(values.url)
let closed = false

socket.on('message', (data) => console.log(`< ${data.toString()}`))
socket.on('close', (code) => {
  closed = true
  console.log(`closed ${code}`)
})
socket.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
socket.on('open', async () => {
  for (const line of lines) {
    if (closed) break
    console.log(`> ${line}`)
    socket.send(line)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  if (!closed) socket.close()
})
