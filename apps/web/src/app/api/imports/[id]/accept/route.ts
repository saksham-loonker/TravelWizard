import { acceptImport } from '@/lib/server-store'
import { fail, guardMutationRequest, ok } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    return ok(acceptImport(id))
  } catch (error) {
    return fail(error, error instanceof Error && error.message === 'Import not found' ? 404 : 400)
  }
}
