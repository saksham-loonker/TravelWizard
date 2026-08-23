import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { config as loadEnv } from 'dotenv'
import { browse } from 'swiftbrowse'
import { classifyBrowserAction, evaluatePolicy, sanitizeSourceSummary, validateProviderUrl } from '@travelwizard/browser-policy'
import { domainsForProvider, isAllowedOrigin, requireCompanionSecret } from './security'

interface BrowserJobRequest {
  secret?: string
  providerId?: string
  url?: string
  command?: string
  title?: string
  runLive?: boolean
}

const host = '127.0.0.1'
loadEnv({ path: new URL('../../../.env', import.meta.url) })
const port = Number(process.env.LOCAL_COMPANION_PORT ?? 4317)
const expectedSecret = requireCompanionSecret()
const maxJsonBytes = Number(process.env.LOCAL_COMPANION_MAX_JSON_BYTES ?? 64_000)
const expectedOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3210'

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', expectedOrigin)
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

  if (!isAllowedOrigin(request.headers.origin, expectedOrigin)) {
    writeJson(response, 403, { success: false, error: 'Origin not allowed' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { success: true, data: { status: 'ok', host, port, retention: 'metadata_only' } })
      return
    }

    if (request.method === 'POST' && request.url === '/pair') {
      const body = await readJson<BrowserJobRequest>(request, maxJsonBytes)
      if (body.secret !== expectedSecret) throw new HttpError(403, 'Invalid pairing secret')
      writeJson(response, 200, {
        success: true,
        data: {
          paired: true,
          allowedCommands: ['browse', 'goto', 'snapshot', 'text', 'links', 'table', 'extract', 'scroll', 'back', 'forward', 'tabs', 'switchTab', 'screenshot'],
          blockedCommands: ['type', 'fill', 'select', 'upload', 'drag', 'save-state', 'cookie-export', 'eval', 'network-log', 'console-log'],
          cookies: false,
          replayTraces: false
        }
      })
      return
    }

    if (request.method === 'POST' && request.url === '/jobs') {
      const body = await readJson<BrowserJobRequest>(request, maxJsonBytes)
      const result = await runBrowserJob(body)
      writeJson(response, 200, { success: true, data: result })
      return
    }

    throw new HttpError(404, 'Route not found')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    writeJson(response, status, { success: false, error: error instanceof Error ? error.message : String(error) })
  }
})

async function runBrowserJob(input: BrowserJobRequest) {
  if (input.secret !== expectedSecret) throw new HttpError(403, 'Invalid local companion secret')
  if (!input.providerId || !input.url) throw new HttpError(400, 'providerId and url are required')

  const providerDomains = domainsForProvider(input.providerId)
  const urlDecision = validateProviderUrl(input.url, { providerId: input.providerId, allowedDomains: providerDomains })
  if (!urlDecision.allowed || !urlDecision.normalizedUrl) throw new HttpError(403, `URL blocked: ${urlDecision.reason}`)

  const actionDecision = classifyBrowserAction({ command: input.command ?? 'browse', label: input.title ?? 'Read source', href: input.url })
  if (actionDecision.type !== 'allow') throw new HttpError(403, `Command blocked: ${'reason' in actionDecision ? actionDecision.reason : actionDecision.type}`)

  const policy = evaluatePolicy({
    providerId: input.providerId,
    providerAllowedOperations: ['local_browser_research'],
    operation: { kind: 'local_browser_research', isIrreversible: false },
    dataFields: ['name', 'price', 'source_timestamp'],
    forbiddenFields: ['review_text', 'traveler_pii', 'credentials'],
    localCompanionPaired: true,
    userApproved: true,
    rateLimitRemaining: 3,
    environment: 'local',
    termsReviewed: false
  })
  if (policy.type !== 'allow_local_browser_research') {
    throw new HttpError(403, `Policy blocked: ${'reason' in policy ? policy.reason : policy.type}`)
  }

  const rawSnapshot =
    input.runLive === false
      ? `# ${urlDecision.normalizedUrl}\nDry-run source read; set runLive true to launch swiftbrowse.`
      : await browse(urlDecision.normalizedUrl, {
          mode: 'headless',
          cookies: false,
          consent: true,
          prune: true,
          pruneMode: 'read',
          timeout: 25000
        })
  const sourceSummary = sanitizeSourceSummary(rawSnapshot, 2_000)

  return {
    providerId: input.providerId,
    url: urlDecision.normalizedUrl,
    observedAt: new Date().toISOString(),
    extractionMethod: 'local_browser',
    policyDecisionId: policy.policyDecisionId,
    sourceLinks: [urlDecision.normalizedUrl],
    sourceSummary: sourceSummary.summary,
    redacted: sourceSummary.redacted,
    truncated: sourceSummary.truncated,
    retention: 'metadata_only'
  }
}

function readJson<T>(request: IncomingMessage, maxBytes: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBytes) {
        settled = true
        request.destroy()
        reject(new HttpError(413, `JSON body exceeds ${maxBytes} bytes.`))
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (settled) return
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve(body ? (JSON.parse(body) as T) : ({} as T))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', (error) => {
      if (!settled) reject(error)
    })
  })
}

function writeJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

server.listen(port, host, () => {
  process.stdout.write(`TravelWizard local companion listening on http://${host}:${port}\n`)
})
