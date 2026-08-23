import { evaluateRuntimeHealth } from '@/lib/runtime-health'
import { ok } from '@/lib/http'

export async function GET() {
  return ok(evaluateRuntimeHealth())
}
