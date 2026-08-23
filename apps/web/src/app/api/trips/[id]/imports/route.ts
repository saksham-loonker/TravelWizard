import { getStore, importBooking, importBookingFile } from '@/lib/server-store'
import { fail, guardMutationRequest, ok, readJson } from '@/lib/http'
import type { BookingImportFileInput } from '@travelwizard/ocr'

const MAX_IMPORT_JSON_BYTES = 7_000_000

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ok(Array.from(getStore().imports.values()).filter((record) => record.tripId === id))
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const guard = guardMutationRequest(request)
    if (guard) return guard

    const body = await readJson<{ text?: string; sourceType?: 'pdf' | 'image' | 'email' | 'calendar' | 'manual'; confidence?: number; file?: BookingImportFileInput }>(
      request,
      MAX_IMPORT_JSON_BYTES
    )
    if (body.file) return ok(importBookingFile(id, body.file))
    if (!body.text) throw new Error('Import text is required')
    return ok(importBooking(id, body.text, body.sourceType ?? 'manual', body.confidence ?? 0.8))
  } catch (error) {
    return fail(error)
  }
}
