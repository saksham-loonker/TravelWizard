import { providerHealth } from '@/lib/server-store'
import { ok } from '@/lib/http'

export async function GET() {
  return ok(providerHealth())
}
