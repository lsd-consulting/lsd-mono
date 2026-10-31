import { describe, expect, it } from 'vitest'
import { ALL_INTERFACES, DEFAULT_PORT, LOCALHOST, parseConfig } from './config.ts'

describe('parseConfig', () => {
  it('binds to localhost on the default port unless told otherwise', () => {
    const config = parseConfig([])
    expect(config.host).toBe(LOCALHOST)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.reportsDir).toMatch(/\.lsd[/\\]server[/\\]reports$/)
  })

  it('binds to every interface only with the explicit opt-in', () => {
    expect(parseConfig(['--expose']).host).toBe(ALL_INTERFACES)
    expect(parseConfig([], { LSD_SERVER_EXPOSE: '1' }).host).toBe(ALL_INTERFACES)
    expect(parseConfig([], { LSD_SERVER_EXPOSE: 'true' }).host).toBe(LOCALHOST)
  })

  it('reads the port from the flag or the environment', () => {
    expect(parseConfig(['--port', '8080']).port).toBe(8080)
    expect(parseConfig(['--port=9090']).port).toBe(9090)
    expect(parseConfig([], { LSD_SERVER_PORT: '7000' }).port).toBe(7000)
  })

  it('reads a viewer override from the flag or the environment', () => {
    expect(parseConfig([]).viewer).toBeUndefined()
    expect(parseConfig(['--viewer', 'a.html']).viewer).toBe('a.html')
    expect(parseConfig(['--viewer=b.html']).viewer).toBe('b.html')
    expect(parseConfig([], { LSD_SERVER_VIEWER: 'c.html' }).viewer).toBe('c.html')
    expect(parseConfig([], { LSD_SERVER_VIEWER: '' }).viewer).toBeUndefined()
    expect(() => parseConfig(['--viewer'])).toThrow(/--viewer/)
    expect(() => parseConfig(['--viewer='])).toThrow(/--viewer/)
  })

  it('rejects a bad port or an unknown option', () => {
    expect(() => parseConfig(['--port', 'x'])).toThrow(/--port/)
    expect(() => parseConfig(['--port'])).toThrow(/--port/)
    expect(() => parseConfig(['--port=70000'])).toThrow(/--port/)
    expect(() => parseConfig(['--open'])).toThrow(/Unknown option/)
  })
})
