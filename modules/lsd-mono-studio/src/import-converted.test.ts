// importBody's last check: an OTLP export converts, but the report it converts to fails the
// report schema. That is a bug in the converter, so it answers 500 and stores nothing.
import { describe, expect, it, vi } from 'vitest'
import type { ReportStore } from './store.ts'

vi.mock('./otlp.ts', async (original) => ({
  ...(await original<typeof import('./otlp.ts')>()),
  otlpToReport: () => ({ report: { schemaVersion: '1.0.0', title: 42 } }),
}))

const { importBody } = await import('./import.ts')

describe('importBody', () => {
  it('answers 500 and stores nothing when a converted report is not valid', async () => {
    const save = vi.fn()
    const result = await importBody('{"resourceSpans":[]}', { save } as unknown as ReportStore)
    expect(result.status).toBe(500)
    expect(result.error).toBe('The converted report is not valid')
    expect(result.errors?.length).toBeGreaterThan(0)
    expect(save).not.toHaveBeenCalled()
  })
})
