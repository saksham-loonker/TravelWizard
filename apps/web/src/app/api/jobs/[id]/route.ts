import { getStore } from '@/lib/server-store'
import { fail, ok } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = getStore().jobStore.get(id)
  return job ? ok(job) : fail('Job not found', 404)
}
