import { describe, expect, it } from 'vitest'
import { structureBookingImportFile } from './index'

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

describe('booking import file OCR/text pipeline', () => {
  it('extracts a text-backed booking file without retaining raw content or PII', () => {
    const structured = structureBookingImportFile({
      fileName: 'booking-email.eml',
      mimeType: 'message/rfc822',
      sizeBytes: 120,
      contentBase64: base64('Hotel Azul Lisbon 2026-07-02 USD 140 email alex@example.com token=abc123456789'),
      ocrConfidence: 0.94
    })

    expect(structured.file).toMatchObject({
      fileName: 'booking-email.eml',
      mimeType: 'message/rfc822',
      sourceType: 'email',
      sizeBytes: 120
    })
    expect(structured.result.extractedBookings[0]?.title).toContain('Hotel Azul')
    expect(structured.result.extractedBookings[0]?.lockedConstraint).toBe(true)
    expect(JSON.stringify(structured)).not.toContain('alex@example.com')
    expect(JSON.stringify(structured)).not.toContain('abc123456789')
    expect(JSON.stringify(structured)).not.toContain(base64('Hotel Azul'))
  })

  it('accepts scanned image imports only when OCR text is supplied and keeps manual review confidence', () => {
    const structured = structureBookingImportFile({
      fileName: 'flight-scan.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      contentBase64: base64('not readable image bytes'),
      extractedText: 'Flight Indigo 2026-07-04 INR 5400',
      ocrConfidence: 0.72
    })

    expect(structured.file.sourceType).toBe('image')
    expect(structured.file.warnings).toContain('image_ocr_text_supplied')
    expect(structured.result.needsUserCorrection).toBe(true)
    expect(structured.result.extractedBookings[0]?.lockedConstraint).toBe(false)
  })

  it('rejects unsupported or oversized import files before parsing', () => {
    expect(() =>
      structureBookingImportFile({
        fileName: 'script.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10,
        contentBase64: base64('Hotel Bad')
      })
    ).toThrow(/Unsupported booking import file type/)

    expect(() =>
      structureBookingImportFile({
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5_000_001,
        contentBase64: base64('Hotel Bad')
      })
    ).toThrow(/Import file exceeds/)
  })
})
