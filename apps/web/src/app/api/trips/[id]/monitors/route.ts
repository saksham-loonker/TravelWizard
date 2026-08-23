import { createMonitor, listMonitors } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    const { id } = await params
    const body = await readJson<{ candidateId?: string; cadence?: string; stopDate?: string; notifyOn?: 'price_drop' | 'price_change' | 'manual_review' }>(request)
    if (!body.candidateId) return fail('candidateId required')
    return ok(createMonitor(id, body.candidateId, { cadence: body.cadence ?? 'daily', ...(body.stopDate ? { stopDate: body.stopDate } : {}), notifyOn: body.notifyOn ?? 'price_change' }))
  } catch (error) {
    return fail(error)
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return ok(listMonitors(id))
  } catch (error) {
    return fail(error)
  }
}
