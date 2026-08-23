import { describe, expect, it, beforeEach } from 'vitest'
import { guardMutationRequest, resetHttpGuardsForTests } from './http'

describe('API mutation guards', () => {
  beforeEach(() => {
    resetHttpGuardsForTests()
  })

  it('allows same-origin JSON mutations', () => {
    const request = new Request('http://127.0.0.1:3210/api/trips', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:3210',
        'content-type': 'application/json',
        'content-length': '2'
      },
      body: '{}'
    })

    expect(guardMutationRequest(request)).toBeNull()
  })

  it('blocks cross-origin mutating requests before route handlers run', async () => {
    const request = new Request('http://127.0.0.1:3210/api/trips', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
        'content-length': '2'
      },
      body: '{}'
    })

    const response = guardMutationRequest(request)
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({ success: false, error: 'Cross-origin mutating request blocked.' })
  })

  it('rejects non-JSON mutating requests with a body', async () => {
    const request = new Request('http://127.0.0.1:3210/api/trips', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:3210',
        'content-type': 'text/plain',
        'content-length': '5'
      },
      body: 'hello'
    })

    const response = guardMutationRequest(request)
    expect(response?.status).toBe(415)
    await expect(response?.json()).resolves.toMatchObject({ success: false, error: 'Mutating API requests must use application/json.' })
  })

  it('rate-limits repeated local write bursts by client key', async () => {
    const headers = {
      origin: 'http://127.0.0.1:3210',
      'content-type': 'application/json',
      'content-length': '2',
      'x-forwarded-for': '203.0.113.10'
    }
    const first = new Request('http://127.0.0.1:3210/api/trips', { method: 'POST', headers, body: '{}' })
    const second = new Request('http://127.0.0.1:3210/api/trips', { method: 'POST', headers, body: '{}' })
    const third = new Request('http://127.0.0.1:3210/api/trips', { method: 'POST', headers, body: '{}' })

    expect(guardMutationRequest(first, { key: 'test', max: 2, windowMs: 60_000, now: 1000 })).toBeNull()
    expect(guardMutationRequest(second, { key: 'test', max: 2, windowMs: 60_000, now: 1001 })).toBeNull()
    const response = guardMutationRequest(third, { key: 'test', max: 2, windowMs: 60_000, now: 1002 })

    expect(response?.status).toBe(429)
    await expect(response?.json()).resolves.toMatchObject({ success: false })
  })
})
