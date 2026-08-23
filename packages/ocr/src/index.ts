import { createHash } from 'node:crypto'
import { MAX_IMPORT_TEXT_CHARS, parseBookingText, redactSensitiveFields } from '@travelwizard/domain'

export { parseBookingText, redactSensitiveFields }

export const MAX_IMPORT_FILE_BYTES = 5_000_000

export type BookingImportSourceType = 'pdf' | 'image' | 'email' | 'calendar' | 'manual'

export interface BookingImportFileInput {
  fileName: string
  mimeType: string
  sizeBytes: number
  contentBase64?: string
  extractedText?: string
  ocrConfidence?: number
}

export interface StructuredBookingImportFile {
  file: {
    fileName: string
    mimeType: string
    sizeBytes: number
    sourceType: BookingImportSourceType
    contentHash: string
    warnings: string[]
  }
  result: ReturnType<typeof parseBookingText>
}

const allowedImportTypes: Record<string, { sourceType: BookingImportSourceType; textBacked: boolean }> = {
  'application/pdf': { sourceType: 'pdf', textBacked: false },
  'image/png': { sourceType: 'image', textBacked: false },
  'image/jpeg': { sourceType: 'image', textBacked: false },
  'image/jpg': { sourceType: 'image', textBacked: false },
  'text/plain': { sourceType: 'manual', textBacked: true },
  'message/rfc822': { sourceType: 'email', textBacked: true },
  'text/calendar': { sourceType: 'calendar', textBacked: true }
}

export function structureBookingImportFile(input: BookingImportFileInput): StructuredBookingImportFile {
  const fileName = input.fileName.trim()
  const mimeType = input.mimeType.trim().toLowerCase()
  const type = allowedImportTypes[mimeType]
  if (!type || !extensionMatches(fileName, mimeType)) {
    throw new Error('Unsupported booking import file type.')
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`Import file exceeds ${MAX_IMPORT_FILE_BYTES} bytes.`)
  }

  const decoded = decodeBase64(input.contentBase64 ?? '')
  if (decoded.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`Import file exceeds ${MAX_IMPORT_FILE_BYTES} bytes.`)
  }

  const suppliedText = input.extractedText?.trim()
  const decodedText = type.textBacked ? decoded.toString('utf8') : extractEmbeddedText(decoded)
  const text = suppliedText || decodedText
  const warnings = warningsForImport(type.sourceType, Boolean(suppliedText), Boolean(decodedText))
  if (!text.trim()) {
    throw new Error('OCR text is required for scanned booking imports.')
  }
  if (text.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`Import text exceeds ${MAX_IMPORT_TEXT_CHARS} characters.`)
  }

  const confidence = confidenceForFile(type.sourceType, input.ocrConfidence, Boolean(suppliedText), type.textBacked)
  return {
    file: {
      fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      sourceType: type.sourceType,
      contentHash: createHash('sha256').update(decoded).digest('hex'),
      warnings
    },
    result: parseBookingText(redactSensitiveFields(text), {
      documentId: `file_${createHash('sha256').update(`${fileName}:${mimeType}:${input.sizeBytes}`).digest('hex').slice(0, 16)}`,
      sourceType: type.sourceType,
      ocrConfidence: confidence
    })
  }
}

function decodeBase64(contentBase64: string): Buffer {
  try {
    return Buffer.from(contentBase64, 'base64')
  } catch {
    throw new Error('Import file content must be base64 encoded.')
  }
}

function extensionMatches(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase()
  if (mimeType === 'application/pdf') return lower.endsWith('.pdf')
  if (mimeType === 'image/png') return lower.endsWith('.png')
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return lower.endsWith('.jpg') || lower.endsWith('.jpeg')
  if (mimeType === 'message/rfc822') return lower.endsWith('.eml')
  if (mimeType === 'text/calendar') return lower.endsWith('.ics')
  if (mimeType === 'text/plain') return lower.endsWith('.txt') || lower.endsWith('.text')
  return false
}

function extractEmbeddedText(buffer: Buffer): string {
  const printable = buffer
    .toString('utf8')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /\b(?:Hotel|Flight|Train|Activity)\b/i.test(printable) ? printable : ''
}

function confidenceForFile(sourceType: BookingImportSourceType, providedConfidence: number | undefined, suppliedText: boolean, textBacked: boolean): number {
  if (typeof providedConfidence === 'number') return clamp(providedConfidence, 0, 1)
  if (textBacked) return 0.92
  if (suppliedText) return sourceType === 'image' ? 0.78 : 0.82
  return 0.7
}

function warningsForImport(sourceType: BookingImportSourceType, suppliedText: boolean, decodedText: boolean): string[] {
  if (sourceType === 'image' && suppliedText) return ['image_ocr_text_supplied']
  if (sourceType === 'pdf' && suppliedText) return ['pdf_ocr_text_supplied']
  if ((sourceType === 'image' || sourceType === 'pdf') && decodedText) return ['embedded_text_extracted']
  return []
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
