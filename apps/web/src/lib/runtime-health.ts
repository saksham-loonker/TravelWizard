import { constants, accessSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type RuntimeStatus = 'pass' | 'warn' | 'fail'

export interface RuntimeCheck {
  id: string
  label: string
  status: RuntimeStatus
  detail: string
  remediation?: string
}

export interface RuntimeHealth {
  status: RuntimeStatus
  checkedAt: string
  checks: RuntimeCheck[]
}

export function evaluateRuntimeHealth(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): RuntimeHealth {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const checks: RuntimeCheck[] = [
    checkCompanionSecret(env.LOCAL_COMPANION_SECRET),
    checkLocalCompanionUrl(env.LOCAL_COMPANION_URL),
    checkStateStorage(resolve(cwd, env.TRAVELWIZARD_STATE_FILE ?? 'storage/travelwizard-state.json')),
    checkVendorPackage(resolve(cwd, 'vendor', 'swiftbrowse', 'package.json')),
    checkRequiredUrl('database_url', 'Postgres/PostGIS URL', env.DATABASE_URL, 'Set DATABASE_URL before running DB-backed workers or migrations.'),
    checkRequiredUrl('redis_url', 'Redis URL', env.REDIS_URL, 'Set REDIS_URL before running the BullMQ worker or monitors.'),
    checkModelConfig(env)
  ]

  return {
    status: checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass',
    checkedAt: new Date().toISOString(),
    checks
  }
}

function checkCompanionSecret(secret: string | undefined): RuntimeCheck {
  const trimmed = secret?.trim()
  const unsafe = !trimmed || trimmed.length < 24 || trimmed === 'dev-local-secret-change-me' || trimmed === 'replace-with-a-random-local-secret-at-least-24-chars'
  return {
    id: 'local_companion_secret',
    label: 'Local companion secret',
    status: unsafe ? 'fail' : 'pass',
    detail: unsafe ? 'Pairing secret is missing, default, or too short.' : 'Pairing secret is configured server-side.',
    ...(unsafe ? { remediation: 'Set LOCAL_COMPANION_SECRET to a random local-only value with at least 24 characters.' } : {})
  }
}

function checkLocalCompanionUrl(url: string | undefined): RuntimeCheck {
  const value = url?.trim() || 'http://127.0.0.1:4317'
  let local = false
  try {
    const parsed = new URL(value)
    local = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  } catch {}

  return {
    id: 'local_companion_url',
    label: 'Local companion URL',
    status: local ? 'pass' : 'fail',
    detail: local ? `Companion URL is local: ${value}.` : 'Companion URL must be a local HTTP endpoint.',
    ...(local ? {} : { remediation: 'Set LOCAL_COMPANION_URL to http://127.0.0.1:4317 or another localhost port.' })
  }
}

function checkStateStorage(stateFile: string): RuntimeCheck {
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    accessSync(dirname(stateFile), constants.W_OK)
    return {
      id: 'state_storage',
      label: 'Local state storage',
      status: 'pass',
      detail: `State directory is writable for ${stateFile}.`
    }
  } catch {
    return {
      id: 'state_storage',
      label: 'Local state storage',
      status: 'fail',
      detail: `State directory is not writable for ${stateFile}.`,
      remediation: 'Choose a writable TRAVELWIZARD_STATE_FILE path under the workspace.'
    }
  }
}

function checkVendorPackage(packageFile: string): RuntimeCheck {
  return {
    id: 'vendor_swiftbrowse',
    label: 'Repo-copied swiftbrowse',
    status: existsSync(packageFile) ? 'pass' : 'fail',
    detail: existsSync(packageFile) ? 'vendor/swiftbrowse is present.' : 'vendor/swiftbrowse/package.json was not found.',
    ...(existsSync(packageFile) ? {} : { remediation: 'Copy swiftbrowse into vendor/swiftbrowse before running browser-source research.' })
  }
}

function checkRequiredUrl(id: string, label: string, value: string | undefined, remediation: string): RuntimeCheck {
  return {
    id,
    label,
    status: value?.trim() ? 'pass' : 'warn',
    detail: value?.trim() ? `${label} is configured.` : `${label} is not configured.`,
    ...(value?.trim() ? {} : { remediation })
  }
}

function checkModelConfig(env: NodeJS.ProcessEnv): RuntimeCheck {
  const configured = Boolean(env.OPENAI_BASE_URL?.trim() && env.OPENAI_MODEL_PLANNER?.trim())
  return {
    id: 'model_api_key',
    label: 'OpenAI-compatible model config',
    status: configured ? 'pass' : 'warn',
    detail: configured ? 'Model base URL and planner model are configured.' : 'Model base URL or planner model is missing; model-backed planning is disabled.',
    ...(configured ? {} : { remediation: 'Set OPENAI_BASE_URL and OPENAI_MODEL_PLANNER. Set OPENAI_API_KEY when using a hosted model provider.' })
  }
}
