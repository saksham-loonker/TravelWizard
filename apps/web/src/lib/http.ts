import { NextResponse } from 'next/server'

const DEFAULT_MAX_JSON_BYTES = 64_000
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
const DEFAULT_RATE_LIMIT_MAX = 120

const httpGuardState = globalThis as typeof globalThis & {
  __travelWizardRateLimits?: Map<string, { count: number; resetAt: number }>
}

function rateLimitBuckets() {
  if (!httpGuardState.__travelWizardRateLimits) {
    httpGuardState.__travelWizardRateLimits = new Map()
  }
  return httpGuardState.__travelWizardRateLimits
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init)
}

export function fail(error: unknown, status = 400) {
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    },
    { status }
  )
}

export function guardMutationRequest(
  request: Request,
  options: { key?: string; max?: number; windowMs?: number; now?: number } = {}
): NextResponse | null {
  const method = request.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null

  const originFailure = validateSameOrigin(request)
  if (originFailure) return originFailure

  const contentType = request.headers.get('content-type')
  const hasBody = Number(request.headers.get('content-length') ?? 0) > 0 || Boolean(contentType)
  if (hasBody && contentType && !contentType.toLowerCase().includes('application/json')) {
    return fail('Mutating API requests must use application/json.', 415)
  }

  const rateLimit = consumeRateLimit(request, options)
  if (!rateLimit.allowed) {
    return fail(`Rate limit exceeded. Retry after ${Math.ceil(rateLimit.retryAfterMs / 1000)} seconds.`, 429)
  }

  return null
}

export function resetHttpGuardsForTests() {
  rateLimitBuckets().clear()
}

export async function readJson<T = unknown>(request: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`JSON body exceeds ${maxBytes} bytes.`)
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`JSON body exceeds ${maxBytes} bytes.`)
  }
  if (!text.trim()) return {} as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Invalid JSON body.')
  }
}

function validateSameOrigin(request: Request): NextResponse | null {
  const allowedOrigins = originsForRequest(request)
  const origin = request.headers.get('origin')
  if (origin && !allowedOrigins.has(normalizeOrigin(origin))) {
    return fail('Cross-origin mutating request blocked.', 403)
  }

  const referer = request.headers.get('referer')
  if (!origin && referer) {
    try {
      if (!allowedOrigins.has(new URL(referer).origin)) {
        return fail('Cross-origin mutating request blocked.', 403)
      }
    } catch {
      return fail('Invalid referer for mutating request.', 403)
    }
  }

  return null
}

function originsForRequest(request: Request): Set<string> {
  const requestUrl = new URL(request.url)
  const origins = new Set<string>([requestUrl.origin])
  const configuredOrigin = process.env.APP_ORIGIN?.trim()
  if (configuredOrigin) origins.add(normalizeOrigin(configuredOrigin))

  if (requestUrl.hostname === '127.0.0.1') origins.add(`${requestUrl.protocol}//localhost:${requestUrl.port}`)
  if (requestUrl.hostname === 'localhost') origins.add(`${requestUrl.protocol}//127.0.0.1:${requestUrl.port}`)

  return origins
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin
}

function consumeRateLimit(
  request: Request,
  options: { key?: string; max?: number; windowMs?: number; now?: number }
): { allowed: boolean; retryAfterMs: number } {
  const now = options.now ?? Date.now()
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
  const max = options.max ?? DEFAULT_RATE_LIMIT_MAX
  const bucketKey = `${options.key ?? 'api-write'}:${clientKey(request)}`
  const buckets = rateLimitBuckets()
  const current = buckets.get(bucketKey)

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }

  if (current.count >= max) {
    return { allowed: false, retryAfterMs: current.resetAt - now }
  }

  buckets.set(bucketKey, { ...current, count: current.count + 1 })
  return { allowed: true, retryAfterMs: current.resetAt - now }
}

function clientKey(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || new URL(request.url).host
}
