import { describe, expect, it } from 'vitest'
import { domainsForProvider, isAllowedOrigin, requireCompanionSecret } from './security'

describe('local companion security guards', () => {
  it('rejects missing, default, and short local companion secrets', () => {
    expect(() => requireCompanionSecret({})).toThrow(/LOCAL_COMPANION_SECRET/)
    expect(() => requireCompanionSecret({ LOCAL_COMPANION_SECRET: 'dev-local-secret-change-me' })).toThrow(/LOCAL_COMPANION_SECRET/)
    expect(() => requireCompanionSecret({ LOCAL_COMPANION_SECRET: 'short' })).toThrow(/LOCAL_COMPANION_SECRET/)
    expect(requireCompanionSecret({ LOCAL_COMPANION_SECRET: 'test-local-companion-secret-0001' })).toBe('test-local-companion-secret-0001')
  })

  it('allows only the configured app origin while still permitting server-to-server calls without Origin', () => {
    expect(isAllowedOrigin(undefined, 'http://127.0.0.1:3210')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:3210', 'http://127.0.0.1:3210')).toBe(true)
    expect(isAllowedOrigin('https://evil.example', 'http://127.0.0.1:3210')).toBe(false)
  })

  it('uses registry-owned provider domains instead of caller-supplied allowlists', () => {
    expect(domainsForProvider('klook')).toContain('klook.com')
    expect(() => domainsForProvider('evil-provider')).toThrow(/Provider is not enabled/)
  })
})
