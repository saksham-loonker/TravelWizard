import { getStore } from '@/lib/server-store'
import { ok } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ok(getStore().candidates.get(id) ?? [])
}
