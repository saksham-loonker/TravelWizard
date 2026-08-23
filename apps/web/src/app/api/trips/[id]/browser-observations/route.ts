import { listBrowserObservations } from '@/lib/server-store'
import { fail, ok } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return ok(listBrowserObservations(id))
  } catch (error) {
    return fail(error)
  }
}
