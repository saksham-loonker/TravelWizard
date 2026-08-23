import { lockItineraryItem } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard
    const body = await readJson<{ tripId?: string; locked?: boolean }>(request)
    if (!body.tripId) return fail('tripId required')
    return ok(lockItineraryItem(body.tripId, id, body.locked ?? true))
  } catch (error) {
    return fail(error)
  }
}
