import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { evaluateRuntimeHealth } from './runtime-health'

describe('runtime health checks', () => {
  it('passes core local prerequisites when configured', () => {
    const result = evaluateRuntimeHealth({
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_COMPANION_SECRET: 'local-companion-secret-0000000001',
        LOCAL_COMPANION_URL: 'http://127.0.0.1:4317',
        TRAVELWIZARD_STATE_FILE: join(tmpdir(), `tw-health-${randomUUID()}.json`),
        DATABASE_URL: 'postgres://travelwizard:travelwizard@localhost:5438/travelwizard',
        REDIS_URL: 'redis://localhost:6381',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_MODEL_PLANNER: 'gpt-4o'
      }
    })

    expect(result.status).toBe('pass')
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('fails unsafe companion secrets and warns on optional model credentials', () => {
    const result = evaluateRuntimeHealth({
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_COMPANION_SECRET: 'replace-with-a-random-local-secret-at-least-24-chars',
        TRAVELWIZARD_STATE_FILE: join(tmpdir(), `tw-health-${randomUUID()}.json`),
        DATABASE_URL: 'postgres://travelwizard:travelwizard@localhost:5438/travelwizard',
        REDIS_URL: 'redis://localhost:6381',
        OPENAI_BASE_URL: 'https://api.openai.com/v1'
      }
    })

    expect(result.status).toBe('fail')
    expect(result.checks.find((check) => check.id === 'local_companion_secret')?.status).toBe('fail')
    expect(result.checks.find((check) => check.id === 'model_api_key')?.status).toBe('warn')
  })
})
