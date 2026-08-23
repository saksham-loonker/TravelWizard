import { getStore } from '@/lib/server-store'
import { fail, ok } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const record = getStore().imports.get(id)
  return record ? ok(record) : fail('Import not found', 404)
}
