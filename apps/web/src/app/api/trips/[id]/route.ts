import { getStore, updateTrip, type TripRecord } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const trip = getStore().trips.get(id)
  return trip ? ok(trip) : fail('Trip not found', 404)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    const body = await readJson<Partial<TripRecord>>(request)
    return ok(updateTrip(id, body))
  } catch (error) {
    return fail(error)
  }
}
