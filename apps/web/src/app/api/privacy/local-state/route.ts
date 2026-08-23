import { clearLocalState } from '@/lib/server-store'
import { guardMutationRequest, ok } from '@/lib/http'

export async function DELETE(request: Request) {
  const guard = guardMutationRequest(request)
  if (guard) return guard

  return ok(clearLocalState())
}
