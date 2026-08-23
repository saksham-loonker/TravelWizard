import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  acceptImport,
  clearLocalState,
  createMonitor,
  getCandidateDetail,
  createTrip,
  getStore,
  importBooking,
  importBookingFile,
  excludeItineraryItem,
  lockItineraryItem,
  listReplacementCandidates,
  listBrowserObservations,
  listMonitors,
  resetStoreForTests,
  startResearchRun,
  stopMonitor
} from './server-store'

let stateFile: string

describe('web server store safety gates', () => {
  beforeEach(() => {
    stateFile = join(tmpdir(), `travelwizard-state-${randomUUID()}.json`)
    process.env.TRAVELWIZARD_STATE_FILE = stateFile
    rmSync(stateFile, { force: true })
    resetStoreForTests()
  })

  it('blocks browser-source research until local companion pairing has been recorded', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })

    await expect(startResearchRun(trip.id)).rejects.toThrow(/Local companion must be paired/)

    getStore().paired = true
    const result = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-test',
          sourceLinks: [target.url],
          sourceSummary: 'Observed public source summary with email alex@example.com and current availability.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.variants.length).toBeGreaterThan(0)
    expect(trip.destinationResolution.status).toBe('resolved')
    expect(trip.destinationResolution.source).toBe('fixture')
    expect(result.browserObservations.length).toBeGreaterThan(0)
    expect(result.browserObservations[0]?.status).toBe('observed')
    expect(result.browserObservations[0]?.sourceSummary).not.toContain('alex@example.com')
    expect(listBrowserObservations(trip.id)).toHaveLength(result.browserObservations.length)
  })

  it('records companion failures without losing fixture-backed fallback candidates', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })

    getStore().paired = true
    const result = await startResearchRun(trip.id, {
      browserClient: {
        read: async () => {
          throw new Error('companion offline with token=abc123456789')
        }
      }
    })

    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.browserObservations.length).toBeGreaterThan(0)
    expect(result.browserObservations.every((observation) => observation.status === 'failed')).toBe(true)
    expect(result.browserObservations[0]?.reason).not.toContain('abc123456789')
    expect(getStore().jobStore.get(result.job.id)?.status).toBe('completed')
  })

  it('persists user work across server restarts without keeping raw import text or companion pairing state', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-persist',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    const pausedJob = getStore().jobStore.create({ tripId: trip.id, kind: 'monitor', phase: 'watch_price' })
    getStore().jobStore.pause(pausedJob.id)
    const imported = importBooking(trip.id, 'Hotel Azul 2026-07-02 USD 140 email alex@example.com token=abc123456789', 'manual', 0.96)
    acceptImport(imported.id)
    const monitor = createMonitor(trip.id, research.candidates[0]?.providerOfferId ?? 'missing-candidate', { cadence: 'daily' })

    expect(existsSync(stateFile)).toBe(true)
    const serialized = readFileSync(stateFile, 'utf8')
    expect(serialized).not.toContain('alex@example.com')
    expect(serialized).not.toContain('abc123456789')

    resetStoreForTests()
    const restored = getStore()

    expect(restored.paired).toBe(false)
    expect(restored.trips.get(trip.id)?.destination).toBe('Lisbon, Portugal')
    expect(restored.trips.get(trip.id)?.destinationResolution.center).toEqual({ lat: 38.7223, lng: -9.1393 })
    expect(restored.candidates.get(trip.id)?.length).toBeGreaterThan(0)
    expect(restored.variants.get(trip.id)?.length).toBeGreaterThan(0)
    expect(restored.browserObservations.get(trip.id)?.length).toBeGreaterThan(0)
    expect(restored.imports.get(imported.id)?.accepted).toBe(true)
    expect(restored.monitors.get(monitor.id)?.active).toBe(true)
    expect(restored.jobStore.get(research.job.id)?.status).toBe('completed')
    expect(restored.jobStore.get(pausedJob.id)?.status).toBe('paused')
  })

  it('creates explicit user price monitors only for source-backed candidates and preserves stop controls', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-monitor',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    const candidate = research.candidates[0]
    if (!candidate) throw new Error('Expected fixture candidate')

    const monitor = createMonitor(trip.id, candidate.providerOfferId, {
      cadence: 'daily',
      stopDate: '2026-07-01',
      notifyOn: 'price_drop'
    })

    expect(monitor.active).toBe(true)
    expect(monitor.providerId).toBe(candidate.providerId)
    expect(monitor.title).toBe(candidate.title)
    expect(monitor.lastResult.status).toBe('ready')
    expect(monitor.lastResult.sourceUrl).toBe(candidate.bookingUrl)
    expect(monitor.allowedActions).toEqual(['read_source_price', 'open_provider_url', 'manual_verify'])
    expect(JSON.stringify(monitor)).not.toMatch(/book|payment|traveler details/i)
    expect(listMonitors(trip.id)).toHaveLength(1)

    const stopped = stopMonitor(monitor.id)
    expect(stopped.active).toBe(false)
    expect(stopped.stoppedAt).toBeTruthy()
    expect(listMonitors(trip.id)[0]?.active).toBe(false)
    expect(() => createMonitor(trip.id, 'not-a-candidate', { cadence: 'daily' })).toThrow(/Candidate not found/)
    expect(() => createMonitor(trip.id, candidate.providerOfferId, { cadence: 'hourly' })).toThrow(/Unsupported monitor cadence/)
  })

  it('returns candidate inspector detail with score breakdown and safe manual handoff', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-inspector',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })

    const candidate = research.candidates[0]
    if (!candidate) throw new Error('Expected fixture candidate')
    const detail = getCandidateDetail(candidate.providerOfferId)

    expect(detail.title).toBe(candidate.title)
    expect(detail.scores.total).toBeGreaterThan(0)
    expect(detail.sourceAttributions.length).toBeGreaterThan(0)
    expect(detail.handoff.checklist).toEqual(expect.arrayContaining([expect.stringContaining('Verify USD price')]))
    expect(detail.handoff.allowedActions).toEqual(['open_provider_url', 'manual_verify'])
    expect(JSON.stringify(detail.handoff)).not.toMatch(/payment_click|booking_click|form_fill/i)
  })

  it('imports booking files with metadata only and low-confidence OCR review gates', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })

    const imported = importBookingFile(trip.id, {
      fileName: 'hotel-scan.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      contentBase64: Buffer.from('binary image fixture').toString('base64'),
      extractedText: 'Hotel Azul Lisbon 2026-07-02 USD 140 email alex@example.com',
      ocrConfidence: 0.7
    })

    expect(imported.fileMetadata).toMatchObject({
      fileName: 'hotel-scan.png',
      mimeType: 'image/png',
      sourceType: 'image',
      sizeBytes: 2048
    })
    expect(imported.result.needsUserCorrection).toBe(true)
    expect(imported.result.extractedBookings[0]?.lockedConstraint).toBe(false)
    expect(JSON.stringify(imported)).not.toContain('binary image fixture')
    expect(JSON.stringify(imported)).not.toContain('alex@example.com')
    expect(() => acceptImport(imported.id)).toThrow(/Manual correction required/)
  })

  it('persists itinerary locks and reoptimizes variants around the locked item', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-lock',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    const candidateId = research.candidates[1]?.providerOfferId
    if (!candidateId) throw new Error('Expected second candidate')

    const locked = lockItineraryItem(trip.id, candidateId, true)
    expect(locked.locked).toBe(true)
    expect(locked.variants.every((variant) => variant.days.flatMap((day) => day.items).some((item) => item.candidateId === candidateId && item.locked))).toBe(true)

    resetStoreForTests()
    const restored = getStore()
    expect(restored.lockedItems.get(trip.id)?.has(candidateId)).toBe(true)
  })

  it('persists removed itinerary items and returns trip-scoped source-backed replacements', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-remove',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    const removedCandidateId = research.candidates[0]?.providerOfferId
    if (!removedCandidateId) throw new Error('Expected candidate to remove')
    const locked = lockItineraryItem(trip.id, removedCandidateId, true)
    expect(locked.locked).toBe(true)

    const otherTrip = await createTrip({
      destination: 'Paris, France',
      startDate: '2026-08-02',
      endDate: '2026-08-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 1200,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const otherResearch = await startResearchRun(otherTrip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-other-remove',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })

    const removed = excludeItineraryItem(trip.id, removedCandidateId)
    expect(removed.excluded).toBe(true)
    expect(removed.variants.every((variant) => variant.days.flatMap((day) => day.items).every((item) => item.candidateId !== removedCandidateId))).toBe(true)
    expect(getStore().lockedItems.get(trip.id)?.has(removedCandidateId)).toBe(false)

    const replacements = listReplacementCandidates(trip.id, removedCandidateId)
    const scheduledIds = new Set(removed.variants[0]?.days.flatMap((day) => day.items.map((item) => item.candidateId)) ?? [])
    const otherTripIds = new Set(otherResearch.candidates.map((candidate) => candidate.providerOfferId))
    expect(replacements.length).toBeGreaterThan(0)
    expect(replacements.every((replacement) => replacement.candidateId !== removedCandidateId)).toBe(true)
    expect(replacements.every((replacement) => !scheduledIds.has(replacement.candidateId))).toBe(true)
    expect(replacements.every((replacement) => !otherTripIds.has(replacement.candidateId))).toBe(true)
    expect(replacements.every((replacement) => replacement.sourceUrl.startsWith('https://'))).toBe(true)

    resetStoreForTests()
    expect(getStore().excludedItems.get(trip.id)?.has(removedCandidateId)).toBe(true)
    expect(getStore().lockedItems.get(trip.id)?.has(removedCandidateId)).toBe(false)
  })

  it('filters unsafe replacement handoff URLs before returning suggestions', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    const research = await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-unsafe-replacement',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    const removedCandidateId = research.candidates[0]?.providerOfferId
    const template = research.candidates[1]
    if (!removedCandidateId || !template) throw new Error('Expected candidates for unsafe URL test')
    getStore().candidates.set(trip.id, [
      ...research.candidates,
      {
        ...template,
        providerOfferId: 'unsafe-replacement',
        title: 'Unsafe replacement candidate',
        bookingUrl: 'javascript:alert(1)',
        scores: { ...template.scores, total: 100 },
        sourceAttributions: [
          {
            ...template.sourceAttributions[0],
            url: 'javascript:alert(1)'
          }
        ]
      }
    ])

    const replacements = listReplacementCandidates(trip.id, removedCandidateId)
    expect(replacements.every((replacement) => replacement.candidateId !== 'unsafe-replacement')).toBe(true)
    expect(replacements.every((replacement) => replacement.sourceUrl.startsWith('https://'))).toBe(true)
  })

  it('clears retained local state and writes an empty snapshot for privacy controls', async () => {
    const trip = await createTrip({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 900,
      priorities: ['value'],
      pace: 'balanced'
    })
    getStore().paired = true
    await startResearchRun(trip.id, {
      browserClient: {
        read: async (target) => ({
          providerId: target.providerId,
          url: target.url,
          observedAt: '2026-05-24T12:00:00.000Z',
          extractionMethod: 'local_browser',
          policyDecisionId: 'policy-clear',
          sourceLinks: [target.url],
          sourceSummary: 'Metadata-only public source observation.',
          redacted: false,
          truncated: false,
          retention: 'metadata_only'
        })
      }
    })
    importBooking(trip.id, 'Hotel Azul 2026-07-02 USD 140', 'manual', 0.96)

    const result = clearLocalState()
    expect(result).toMatchObject({
      trips: 0,
      candidates: 0,
      variants: 0,
      imports: 0,
      monitors: 0,
      browserObservations: 0,
      jobs: 0
    })
    expect(getStore().paired).toBe(false)
    expect(getStore().trips.size).toBe(0)
    expect(getStore().browserObservations.size).toBe(0)

    const serialized = JSON.parse(readFileSync(stateFile, 'utf8')) as { trips: unknown[]; jobs: unknown[]; browserObservations: unknown[] }
    expect(serialized.trips).toEqual([])
    expect(serialized.jobs).toEqual([])
    expect(serialized.browserObservations).toEqual([])
  })
})
