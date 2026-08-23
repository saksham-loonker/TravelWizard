import { getStore } from '@/lib/server-store'
import { fail, guardMutationRequest, ok } from '@/lib/http'

const allowedCommands = ['browse', 'goto', 'snapshot', 'text', 'links', 'table', 'extract', 'scroll', 'back', 'forward', 'tabs', 'switchTab', 'screenshot']

export async function POST(request: Request) {
  const guard = guardMutationRequest(request)
  if (guard) return guard

  const companionUrl = process.env.LOCAL_COMPANION_URL ?? 'http://127.0.0.1:4317'
  const secret = process.env.LOCAL_COMPANION_SECRET?.trim()
  if (!secret || secret === 'dev-local-secret-change-me' || secret === 'replace-with-a-random-local-secret-at-least-24-chars' || secret.length < 24) {
    return fail('LOCAL_COMPANION_SECRET must be configured on the server before pairing.', 503)
  }

  try {
    const response = await fetch(`${companionUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret })
    })
    if (!response.ok) throw new Error(`Companion returned ${response.status}`)
    getStore().paired = true
    return ok({
      paired: true,
      mode: 'live_companion',
      retentionMode: 'metadata_only',
      allowedCommands
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Local companion pairing failed', 503)
  }
}
