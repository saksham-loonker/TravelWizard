import { getStore } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

interface BrowserJobBody {
  providerId?: string
  url?: string
  title?: string
  command?: string
  runLive?: boolean
}

export async function POST(request: Request) {
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    if (!getStore().paired) return fail('Local companion must be paired before browser-source jobs.', 403)

    const secret = process.env.LOCAL_COMPANION_SECRET?.trim()
    if (!secret || secret === 'dev-local-secret-change-me' || secret === 'replace-with-a-random-local-secret-at-least-24-chars' || secret.length < 24) {
      return fail('LOCAL_COMPANION_SECRET must be configured on the server before browser jobs.', 503)
    }

    const body = await readJson<BrowserJobBody>(request)
    if (!body.providerId || !body.url || !body.title) return fail('providerId, url, and title are required')

    const companionUrl = process.env.LOCAL_COMPANION_URL ?? 'http://127.0.0.1:4317'
    const response = await fetch(`${companionUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        providerId: body.providerId,
        url: body.url,
        title: body.title,
        command: body.command ?? 'extract',
        runLive: body.runLive ?? false
      })
    })
    const payload = (await response.json()) as { success: boolean; data?: unknown; error?: string }
    if (!response.ok || !payload.success) {
      return fail(payload.error ?? `Companion returned ${response.status}`, response.status || 502)
    }
    return ok(payload.data)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Local companion job failed', 400)
  }
}
