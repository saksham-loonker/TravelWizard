import { createTrip, getStore } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

export async function POST(request: Request) {
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    const body = await readJson(request)
    return ok(await createTrip(body))
  } catch (error) {
    return fail(error)
  }
}

export async function GET() {
  return ok(Array.from(getStore().trips.values()))
}
