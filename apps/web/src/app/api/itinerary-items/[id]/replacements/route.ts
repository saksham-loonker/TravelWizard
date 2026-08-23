import { listReplacementCandidates } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard
    const body = await readJson<{ tripId?: string }>(request)
    if (!body.tripId) return fail('tripId required')
    return ok(listReplacementCandidates(body.tripId, id))
  } catch (error) {
    return fail(error)
  }
}
