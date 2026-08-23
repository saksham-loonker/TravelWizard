import { getStore, solveItinerary } from '@/lib/server-store'
import { fail, guardMutationRequest, ok } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    const current = getStore().variants.get(id)
    return ok(current && current.length > 0 ? current : solveItinerary(id))
  } catch (error) {
    return fail(error)
  }
}
