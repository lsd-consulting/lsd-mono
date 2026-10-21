/**
 * Wide-participant mono reports. Payloads stay in a sibling script.
 *
 * Usage: node --experimental-strip-types generate-wide.mjs <shell.html> <out-dir>
 *
 * Cases: 20 / 50 / 100 participants at 400 messages, plus 100 participants at 2000.
 * The participants and arrows come from the report UI's checks/wide-sample.ts, which the check:ux tests
 * also open (without payloads).
 */
import { wideReport } from '../../modules/lsd-mono-report-html/ui/checks/wide-sample.ts'
import { arrowPayload, generatorArgs, writeSample } from './sample-kit.mjs'

const { shell, outDir } = generatorArgs('node --experimental-strip-types generate-wide.mjs <shell.html> <out-dir>')

const CASES = [
  { participants: 20, messages: 400 },
  { participants: 50, messages: 400 },
  { participants: 100, messages: 400 },
  { participants: 100, messages: 2000 },
]

function payload(step, n) {
  return arrowPayload(step.label, n)
}

console.log('payload bytes', Buffer.byteLength(JSON.stringify(payload({ label: 'hop' }, 1))))

for (const spec of CASES) {
  const report = wideReport(spec.participants, spec.messages, payload)
  const stem = `mono-p${spec.participants}-m${spec.messages}`
  const { file, htmlBytes, payloadBytes } = writeSample(shell, outDir, stem, report)
  const types = new Set(report.scenarios[0].participants.map((p) => p.type))
  console.log(
    `wrote ${file} participants=${spec.participants} messages=${spec.messages} types=${[...types].join(',')} htmlBytes=${htmlBytes} payloadBytes=${payloadBytes}`,
  )
}
