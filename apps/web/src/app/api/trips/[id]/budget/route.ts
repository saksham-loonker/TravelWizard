import { getStore } from '@/lib/server-store'
import { ok } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const candidates = getStore().candidates.get(id) ?? []
  const exact = candidates.filter((candidate) => candidate.price)
  const total = exact.reduce((sum, candidate) => sum + (candidate.price?.amount ?? 0), 0)
  return ok({
    exactObservedTotal: total,
    unknownCount: candidates.length - exact.length,
    prices: candidates.map((candidate) => ({
      candidateId: candidate.providerOfferId,
      title: candidate.title,
      exactObservedPrice: candidate.price ?? null,
      sourceLinks: candidate.sourceAttributions.map((source) => source.url)
    }))
  })
}
