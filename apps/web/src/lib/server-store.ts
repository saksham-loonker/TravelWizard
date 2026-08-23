import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  composeGeocoderClients,
  createDestinationResolver,
  createFixtureGeocoderClient,
  createNominatimGeocoderClient,
  type DestinationGeocoderClient,
  type DestinationResolution
} from '@travelwizard/maps'
import {
  createJobStore,
  createHandoffLink,
  generateItineraryVariants,
  normalizeTripRequest,
  parseBookingText,
  sanitizeSourceSummary,
  scoreCandidate,
  validateProviderUrl,
  type ProviderId,
  type ItineraryVariant,
  type JobRecord,
  type ScoredCandidate
} from '@travelwizard/domain'
import { structureBookingImportFile, type BookingImportFileInput, type StructuredBookingImportFile } from '@travelwizard/ocr'
import { createDefaultResearchPlan, normalizedFixtureCandidates, providerRegistry } from '@travelwizard/providers'

export interface TripRecord {
  id: string
  destination: string
  startDate: string
  endDate: string
  travelerCount: number
  currency: string
  budgetTotal: number
  priorities: string[]
  pace: 'relaxed' | 'balanced' | 'packed'
  interests: string[]
  status: 'draft' | 'researching' | 'ready'
  createdAt: string
  destinationResolution: DestinationResolution
}

export interface ImportRecord {
  id: string
  tripId: string
  result: ReturnType<typeof parseBookingText>
  accepted: boolean
  fileMetadata?: StructuredBookingImportFile['file']
}

export interface MonitorRecord {
  id: string
  tripId: string
  candidateId: string
  providerId: ProviderId
  title: string
  cadence: string
  stopDate?: string
  notifyOn: 'price_drop' | 'price_change' | 'manual_review'
  active: boolean
  createdAt: string
  stoppedAt?: string
  lastResult: {
    status: 'ready' | 'manual_verify'
    checkedAt: string
    amount?: number
    currency?: string
    observedAt?: string
    sourceUrl: string
    freshness: string
    message: string
  }
  allowedActions: string[]
}

export interface BrowserSourceObservation {
  id: string
  tripId: string
  jobId: string
  providerId: ProviderId
  url: string
  title: string
  status: 'observed' | 'failed'
  observedAt: string
  extractionMethod: 'local_browser'
  policyDecisionId: string
  sourceLinks: string[]
  sourceSummary: string
  redacted: boolean
  truncated: boolean
  retention: 'metadata_only'
  reason?: string
}

export interface BrowserObservationTarget {
  providerId: ProviderId
  url: string
  title: string
  command: 'extract'
  runLive: boolean
}

export interface BrowserObservationClient {
  read(target: BrowserObservationTarget): Promise<{
    providerId: ProviderId
    url: string
    observedAt: string
    extractionMethod: 'local_browser'
    policyDecisionId: string
    sourceLinks: string[]
    sourceSummary: string
    redacted: boolean
    truncated: boolean
    retention: 'metadata_only'
  }>
}

export type CandidateDetail = ScoredCandidate & {
  handoff: ReturnType<typeof createHandoffLink>
}

interface StoreState {
  trips: Map<string, TripRecord>
  candidates: Map<string, ScoredCandidate[]>
  variants: Map<string, ItineraryVariant[]>
  lockedItems: Map<string, Set<string>>
  excludedItems: Map<string, Set<string>>
  imports: Map<string, ImportRecord>
  monitors: Map<string, MonitorRecord>
  browserObservations: Map<string, BrowserSourceObservation[]>
  destinationCache: Map<string, DestinationResolution>
  destinationResolver: ReturnType<typeof createDestinationResolver>
  paired: boolean
  jobStore: ReturnType<typeof createJobStore>
  stateFile: string
}

interface StoreSnapshot {
  version: 1
  savedAt: string
  trips: TripRecord[]
  candidates: Array<[string, ScoredCandidate[]]>
  variants: Array<[string, ItineraryVariant[]]>
  lockedItems: Array<[string, string[]]>
  excludedItems: Array<[string, string[]]>
  imports: ImportRecord[]
  monitors: MonitorRecord[]
  browserObservations: Array<[string, BrowserSourceObservation[]]>
  destinationCache: Array<[string, DestinationResolution]>
  jobs: JobRecord[]
}

const globalStore = globalThis as typeof globalThis & { __travelWizardStore?: StoreState }

export function getStore(): StoreState {
  if (!globalStore.__travelWizardStore) {
    const snapshot = readSnapshot()
    const stateFile = resolveStateFile()
    const destinationCache = new Map(snapshot.destinationCache)
    globalStore.__travelWizardStore = {
      trips: new Map(snapshot.trips.map((trip) => [trip.id, trip])),
      candidates: new Map(snapshot.candidates),
      variants: new Map(snapshot.variants),
      lockedItems: new Map(snapshot.lockedItems.map(([tripId, candidateIds]) => [tripId, new Set(candidateIds)])),
      excludedItems: new Map(snapshot.excludedItems.map(([tripId, candidateIds]) => [tripId, new Set(candidateIds)])),
      imports: new Map(snapshot.imports.map((record) => [record.id, record])),
      monitors: new Map(snapshot.monitors.map((record) => [record.id, record])),
      browserObservations: new Map(snapshot.browserObservations),
      destinationCache,
      destinationResolver: createDestinationResolver({
        client: createDestinationGeocoderClient(),
        cache: destinationCache
      }),
      paired: false,
      stateFile,
      jobStore: createJobStore({
        initialJobs: snapshot.jobs,
        onChange: () => persistCurrentStore()
      })
    }
  }
  return globalStore.__travelWizardStore
}

function createDestinationGeocoderClient(): DestinationGeocoderClient {
  const clients = [createFixtureGeocoderClient()]
  const baseUrl = process.env.GEOCODER_BASE_URL?.trim()
  if (baseUrl) {
    clients.push(
      createNominatimGeocoderClient({
        baseUrl,
        userAgent: process.env.GEOCODER_USER_AGENT?.trim() || 'TravelWizard local dev; contact=local-user'
      })
    )
  }
  return composeGeocoderClients(clients)
}

export function resetStoreForTests() {
  delete globalStore.__travelWizardStore
}

export async function createTrip(input: unknown): Promise<TripRecord> {
  const normalized = normalizeTripRequest(input)
  if (normalized.status !== 'ready') {
    throw new Error(`Trip is missing required fields: ${normalized.missingFields.join(', ')}`)
  }
  const store = getStore()
  const destinationResolution = await store.destinationResolver.resolve(normalized.request.destination.label)
  const trip: TripRecord = {
    id: randomUUID(),
    destination: normalized.request.destination.label,
    startDate: normalized.request.startDate,
    endDate: normalized.request.endDate,
    travelerCount: normalized.request.travelerCount,
    currency: normalized.request.currency,
    budgetTotal: normalized.request.budgetTotal,
    priorities: normalized.request.priorities,
    pace: normalized.request.pace,
    interests: normalized.request.interests,
    status: 'draft',
    createdAt: new Date().toISOString(),
    destinationResolution
  }
  store.trips.set(trip.id, trip)
  persistCurrentStore()
  return trip
}

export function updateTrip(id: string, input: Partial<TripRecord>): TripRecord {
  const store = getStore()
  const current = store.trips.get(id)
  if (!current) throw new Error('Trip not found')
  const updated = { ...current, ...input, id: current.id }
  store.trips.set(id, updated)
  persistCurrentStore()
  return updated
}

export async function startResearchRun(
  tripId: string,
  options: { browserClient?: BrowserObservationClient; maxBrowserJobs?: number; runLive?: boolean } = {}
): Promise<{
  job: JobRecord
  plan: ReturnType<typeof createDefaultResearchPlan>
  candidates: ScoredCandidate[]
  variants: ItineraryVariant[]
  browserObservations: BrowserSourceObservation[]
}> {
  const store = getStore()
  const trip = store.trips.get(tripId)
  if (!trip) throw new Error('Trip not found')
  if (!store.paired) throw new Error('Local companion must be paired before browser-source research.')
  const job = store.jobStore.create({ tripId, kind: 'research', phase: 'source_plan' })
  store.trips.set(tripId, { ...trip, status: 'researching' })
  persistCurrentStore()
  const plan = createDefaultResearchPlan(trip.destination, store.paired)
  const scoredCandidates = normalizedFixtureCandidates(trip.destination).map((candidate) =>
    scoreCandidate(candidate, {
      priorities: trip.priorities as Array<'budget' | 'value' | 'rating' | 'comfort' | 'speed' | 'low_risk'>,
      interests: trip.interests,
      budgetPerDay: Math.max(1, trip.budgetTotal / 3),
      categoryMeanRating: 78
    })
  )
  store.jobStore.progress(job.id, 35, 'browser_sources', 0.003)
  const browserObservations = await collectBrowserObservations({
    tripId,
    jobId: job.id,
    candidates: scoredCandidates,
    client: options.browserClient ?? createLocalCompanionBrowserClient(),
    maxBrowserJobs: options.maxBrowserJobs ?? 3,
    runLive: options.runLive ?? process.env.TRAVELWIZARD_BROWSER_RUN_LIVE === 'true'
  })
  const variants = generateItineraryVariants({
    tripId,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currency: trip.currency,
    budgetTotal: trip.budgetTotal,
    pace: trip.pace,
    candidates: scoredCandidates,
    lockedCandidateIds: Array.from(store.lockedItems.get(tripId) ?? []),
    excludedCandidateIds: Array.from(store.excludedItems.get(tripId) ?? [])
  })
  store.candidates.set(tripId, scoredCandidates)
  store.variants.set(tripId, variants)
  store.browserObservations.set(tripId, browserObservations)
  store.trips.set(tripId, { ...trip, status: 'ready' })
  store.jobStore.progress(job.id, 100, 'complete', 0.01)
  store.jobStore.complete(job.id)
  persistCurrentStore()
  return { job: store.jobStore.get(job.id) ?? job, plan, candidates: scoredCandidates, variants, browserObservations }
}

export function solveItinerary(tripId: string): ItineraryVariant[] {
  const store = getStore()
  const trip = store.trips.get(tripId)
  if (!trip) throw new Error('Trip not found')
  const candidates = store.candidates.get(tripId) ?? []
  const variants = generateItineraryVariants({
    tripId,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currency: trip.currency,
    budgetTotal: trip.budgetTotal,
    pace: trip.pace,
    candidates,
    lockedCandidateIds: Array.from(store.lockedItems.get(tripId) ?? []),
    excludedCandidateIds: Array.from(store.excludedItems.get(tripId) ?? [])
  })
  store.variants.set(tripId, variants)
  persistCurrentStore()
  return variants
}

export function lockItineraryItem(tripId: string, candidateId: string, locked: boolean): { tripId: string; candidateId: string; locked: boolean; variants: ItineraryVariant[] } {
  const store = getStore()
  if (!store.trips.has(tripId)) throw new Error('Trip not found')
  const candidateExists = (store.candidates.get(tripId) ?? []).some((candidate) => candidate.providerOfferId === candidateId)
  if (!candidateExists) throw new Error('Candidate not found for itinerary lock')
  const current = new Set(store.lockedItems.get(tripId) ?? [])
  if (locked) {
    current.add(candidateId)
    const excluded = new Set(store.excludedItems.get(tripId) ?? [])
    excluded.delete(candidateId)
    store.excludedItems.set(tripId, excluded)
  } else {
    current.delete(candidateId)
  }
  store.lockedItems.set(tripId, current)
  const variants = solveItinerary(tripId)
  persistCurrentStore()
  return { tripId, candidateId, locked, variants }
}

export interface ReplacementSuggestion {
  candidateId: string
  title: string
  providerId: ProviderId
  type: string
  score: number
  sourceUrl: string
  reason: string
}

export function excludeItineraryItem(tripId: string, candidateId: string): { tripId: string; candidateId: string; excluded: boolean; variants: ItineraryVariant[]; replacements: ReplacementSuggestion[] } {
  const store = getStore()
  if (!store.trips.has(tripId)) throw new Error('Trip not found')
  const candidateExists = (store.candidates.get(tripId) ?? []).some((candidate) => candidate.providerOfferId === candidateId)
  if (!candidateExists) throw new Error('Candidate not found for itinerary exclusion')
  const excluded = new Set(store.excludedItems.get(tripId) ?? [])
  excluded.add(candidateId)
  store.excludedItems.set(tripId, excluded)
  const locked = new Set(store.lockedItems.get(tripId) ?? [])
  locked.delete(candidateId)
  store.lockedItems.set(tripId, locked)
  const variants = solveItinerary(tripId)
  const replacements = listReplacementCandidates(tripId, candidateId)
  persistCurrentStore()
  return { tripId, candidateId, excluded: true, variants, replacements }
}

export function listReplacementCandidates(tripId: string, candidateId: string): ReplacementSuggestion[] {
  const store = getStore()
  const tripCandidates = store.candidates.get(tripId) ?? []
  const original = tripCandidates.find((candidate) => candidate.providerOfferId === candidateId)
  if (!original) throw new Error('Candidate not found for replacements')
  const excluded = store.excludedItems.get(tripId) ?? new Set<string>()
  const locked = store.lockedItems.get(tripId) ?? new Set<string>()
  const scheduled = scheduledCandidateIds(store.variants.get(tripId)?.[0])
  return tripCandidates
    .filter((candidate) => candidate.providerOfferId !== candidateId)
    .filter((candidate) => !excluded.has(candidate.providerOfferId))
    .filter((candidate) => !locked.has(candidate.providerOfferId))
    .filter((candidate) => !scheduled.has(candidate.providerOfferId))
    .map((candidate) => ({ candidate, sourceUrl: validatedReplacementSourceUrl(candidate) }))
    .filter((entry): entry is { candidate: ScoredCandidate; sourceUrl: string } => Boolean(entry.sourceUrl))
    .sort((a, b) => Number(b.candidate.type === original.type) - Number(a.candidate.type === original.type) || b.candidate.scores.total - a.candidate.scores.total)
    .slice(0, 3)
    .map(({ candidate, sourceUrl }) => ({
      candidateId: candidate.providerOfferId,
      title: candidate.title,
      providerId: candidate.providerId,
      type: candidate.type,
      score: candidate.scores.total,
      sourceUrl,
      reason: `${candidate.title} is a source-backed ${candidate.type} replacement with score ${candidate.scores.total}.`
    }))
}

export function importBooking(tripId: string, text: string, sourceType: 'pdf' | 'image' | 'email' | 'calendar' | 'manual', confidence: number): ImportRecord {
  const store = getStore()
  if (!store.trips.has(tripId)) throw new Error('Trip not found')
  const record: ImportRecord = {
    id: randomUUID(),
    tripId,
    result: parseBookingText(text, {
      documentId: randomUUID(),
      sourceType,
      ocrConfidence: confidence
    }),
    accepted: false
  }
  store.imports.set(record.id, record)
  persistCurrentStore()
  return record
}

export function importBookingFile(tripId: string, file: BookingImportFileInput): ImportRecord {
  const store = getStore()
  if (!store.trips.has(tripId)) throw new Error('Trip not found')
  const structured = structureBookingImportFile(file)
  const record: ImportRecord = {
    id: randomUUID(),
    tripId,
    result: structured.result,
    fileMetadata: structured.file,
    accepted: false
  }
  store.imports.set(record.id, record)
  persistCurrentStore()
  return record
}

export function acceptImport(id: string): ImportRecord {
  const store = getStore()
  const record = store.imports.get(id)
  if (!record) throw new Error('Import not found')
  if (record.result.needsUserCorrection) throw new Error('Manual correction required before accepting import')
  const accepted = { ...record, accepted: true }
  store.imports.set(id, accepted)
  persistCurrentStore()
  return accepted
}

export function createMonitor(
  tripId: string,
  candidateId: string,
  options: { cadence?: string; stopDate?: string; notifyOn?: MonitorRecord['notifyOn'] } = {}
): MonitorRecord {
  const store = getStore()
  if (!store.trips.has(tripId)) throw new Error('Trip not found')
  const candidate = (store.candidates.get(tripId) ?? []).find((item) => item.providerOfferId === candidateId)
  if (!candidate) throw new Error('Candidate not found for trip monitor')
  const cadence = options.cadence ?? 'daily'
  if (!['daily', 'weekly', 'manual'].includes(cadence)) throw new Error('Unsupported monitor cadence')
  const source = candidate.sourceAttributions[0]
  if (!source) throw new Error('Monitor candidate must have source attribution')
  const now = new Date().toISOString()
  const monitor: MonitorRecord = {
    id: randomUUID(),
    tripId,
    candidateId,
    providerId: candidate.providerId,
    title: candidate.title,
    cadence,
    ...(options.stopDate ? { stopDate: options.stopDate } : {}),
    notifyOn: options.notifyOn ?? 'price_change',
    active: true,
    createdAt: now,
    lastResult: {
      status: candidate.price ? 'ready' : 'manual_verify',
      checkedAt: now,
      ...(candidate.price ? { amount: candidate.price.amount, currency: candidate.price.currency, observedAt: candidate.price.observedAt } : {}),
      sourceUrl: candidate.price?.sourceUrl ?? source.url,
      freshness: candidate.freshness,
      message: candidate.price
        ? `${candidate.price.currency} ${candidate.price.amount} observed at source.`
        : 'Price unavailable; manual source verification required.'
    },
    allowedActions: ['read_source_price', 'open_provider_url', 'manual_verify']
  }
  store.monitors.set(monitor.id, monitor)
  persistCurrentStore()
  return monitor
}

export function stopMonitor(id: string): MonitorRecord {
  const store = getStore()
  const monitor = store.monitors.get(id)
  if (!monitor) throw new Error('Monitor not found')
  const stopped = { ...monitor, active: false, stoppedAt: new Date().toISOString() }
  store.monitors.set(id, stopped)
  persistCurrentStore()
  return stopped
}

export function listMonitors(tripId: string): MonitorRecord[] {
  return Array.from(getStore().monitors.values())
    .filter((monitor) => monitor.tripId === tripId)
    .map((monitor) => ({ ...monitor, allowedActions: [...monitor.allowedActions], lastResult: { ...monitor.lastResult } }))
}

export function listBrowserObservations(tripId: string): BrowserSourceObservation[] {
  return (getStore().browserObservations.get(tripId) ?? []).map((observation) => ({ ...observation, sourceLinks: [...observation.sourceLinks] }))
}

export function getCandidateDetail(candidateId: string): CandidateDetail {
  const store = getStore()
  for (const [tripId, candidates] of store.candidates.entries()) {
    const candidate = candidates.find((item) => item.providerOfferId === candidateId)
    if (!candidate) continue
    const trip = store.trips.get(tripId)
    const source = candidate.sourceAttributions[0]
    if (!source) throw new Error('Candidate source attribution missing')
    return {
      ...candidate,
      sourceAttributions: candidate.sourceAttributions.map((attribution) => ({ ...attribution })),
      warnings: [...candidate.warnings],
      scores: { ...candidate.scores },
      handoff: createHandoffLink({
        providerId: candidate.providerId,
        url: candidate.bookingUrl,
        observedAt: candidate.price?.observedAt ?? source.observedAt,
        freshness: candidate.freshness,
        currency: candidate.price?.currency ?? trip?.currency ?? 'USD'
      })
    }
  }
  throw new Error('Candidate not found')
}

export function clearLocalState(): {
  clearedAt: string
  trips: number
  candidates: number
  variants: number
  imports: number
  monitors: number
  browserObservations: number
  jobs: number
} {
  const store = getStore()
  const clearedAt = new Date().toISOString()
  store.trips.clear()
  store.candidates.clear()
  store.variants.clear()
  store.lockedItems.clear()
  store.excludedItems.clear()
  store.imports.clear()
  store.monitors.clear()
  store.browserObservations.clear()
  store.destinationCache.clear()
  store.paired = false
  store.jobStore = createJobStore({
    onChange: () => persistCurrentStore()
  })
  persistCurrentStore()
  return {
    clearedAt,
    trips: 0,
    candidates: 0,
    variants: 0,
    imports: 0,
    monitors: 0,
    browserObservations: 0,
    jobs: 0
  }
}

export function providerHealth() {
  const store = getStore()
  return providerRegistry.map((provider) => ({
    providerId: provider.id,
    label: provider.label,
    healthScore: provider.allowLocalBrowserResearch ? 0.86 : 0.62,
    policyBlockRate: store.paired ? 0.08 : 0.34,
    staleDataRate: 0.12,
    latencyMs: 540,
    demotionReason: store.paired ? null : 'Local companion not paired'
  }))
}

export function costMetrics() {
  const store = getStore()
  const jobs = store.jobStore.list()
  const total = jobs.reduce((sum, job) => sum + job.costUsd, 0)
  return {
    totalUsd: Number(total.toFixed(4)),
    modelUsd: Number((total * 0.7).toFixed(4)),
    ocrUsd: 0,
    browserRuntimeUsd: Number((total * 0.3).toFixed(4)),
    routeGeocodeUsd: 0,
    jobs: jobs.length
  }
}

export function persistCurrentStore() {
  const store = globalStore.__travelWizardStore
  if (!store) return
  const snapshot: StoreSnapshot = {
    version: 1,
    savedAt: new Date().toISOString(),
    trips: Array.from(store.trips.values()),
    candidates: Array.from(store.candidates.entries()),
    variants: Array.from(store.variants.entries()),
    lockedItems: Array.from(store.lockedItems.entries()).map(([tripId, candidateIds]) => [tripId, Array.from(candidateIds)]),
    excludedItems: Array.from(store.excludedItems.entries()).map(([tripId, candidateIds]) => [tripId, Array.from(candidateIds)]),
    imports: Array.from(store.imports.values()),
    monitors: Array.from(store.monitors.values()),
    browserObservations: Array.from(store.browserObservations.entries()),
    destinationCache: Array.from(store.destinationCache.entries()),
    jobs: store.jobStore.list()
  }
  writeSnapshot(store.stateFile, snapshot)
}

function readSnapshot(): StoreSnapshot {
  const stateFile = resolveStateFile()
  if (!existsSync(stateFile)) return emptySnapshot()
  const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<StoreSnapshot>
  return {
    ...emptySnapshot(),
    ...parsed,
    version: 1,
    trips: parsed.trips ?? [],
    candidates: parsed.candidates ?? [],
    variants: parsed.variants ?? [],
    lockedItems: parsed.lockedItems ?? [],
    excludedItems: parsed.excludedItems ?? [],
    imports: parsed.imports ?? [],
    monitors: parsed.monitors ?? [],
    browserObservations: parsed.browserObservations ?? [],
    destinationCache: parsed.destinationCache ?? [],
    jobs: parsed.jobs ?? []
  }
}

function writeSnapshot(stateFile: string, snapshot: StoreSnapshot) {
  mkdirSync(dirname(stateFile), { recursive: true })
  const tempFile = `${stateFile}.${process.pid}.tmp`
  writeFileSync(tempFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  renameSync(tempFile, stateFile)
}

function emptySnapshot(): StoreSnapshot {
  return {
    version: 1,
    savedAt: new Date(0).toISOString(),
    trips: [],
    candidates: [],
    variants: [],
    lockedItems: [],
    excludedItems: [],
    imports: [],
    monitors: [],
    browserObservations: [],
    destinationCache: [],
    jobs: []
  }
}

function resolveStateFile(): string {
  return resolve(process.env.TRAVELWIZARD_STATE_FILE ?? 'storage/travelwizard-state.json')
}

async function collectBrowserObservations(input: {
  tripId: string
  jobId: string
  candidates: ScoredCandidate[]
  client: BrowserObservationClient
  maxBrowserJobs: number
  runLive: boolean
}): Promise<BrowserSourceObservation[]> {
  const targets = input.candidates
    .filter((candidate) => candidate.sourceAttributions.some((source) => source.url === candidate.bookingUrl))
    .slice(0, Math.max(0, input.maxBrowserJobs))
    .map((candidate) => ({
      providerId: candidate.providerId,
      url: candidate.bookingUrl,
      title: candidate.title,
      command: 'extract' as const,
      runLive: input.runLive
    }))

  const observations: BrowserSourceObservation[] = []
  for (const target of targets) {
    try {
      const result = await input.client.read(target)
      const summary = sanitizeSourceSummary(result.sourceSummary, 500)
      observations.push({
        id: randomUUID(),
        tripId: input.tripId,
        jobId: input.jobId,
        providerId: result.providerId,
        url: result.url,
        title: target.title,
        status: 'observed',
        observedAt: result.observedAt,
        extractionMethod: 'local_browser',
        policyDecisionId: result.policyDecisionId,
        sourceLinks: [...result.sourceLinks],
        sourceSummary: summary.summary,
        redacted: result.redacted || summary.redacted,
        truncated: result.truncated || summary.truncated,
        retention: 'metadata_only'
      })
    } catch (error) {
      observations.push({
        id: randomUUID(),
        tripId: input.tripId,
        jobId: input.jobId,
        providerId: target.providerId,
        url: target.url,
        title: target.title,
        status: 'failed',
        observedAt: new Date().toISOString(),
        extractionMethod: 'local_browser',
        policyDecisionId: 'companion_request_failed',
        sourceLinks: [target.url],
        sourceSummary: '',
        redacted: false,
        truncated: false,
        retention: 'metadata_only',
        reason: sanitizeSourceSummary(error instanceof Error ? error.message : String(error), 240).summary
      })
    }
  }
  return observations
}

function createLocalCompanionBrowserClient(): BrowserObservationClient {
  return {
    async read(target) {
      const secret = requiredCompanionSecret()
      const companionUrl = process.env.LOCAL_COMPANION_URL ?? 'http://127.0.0.1:4317'
      const response = await fetch(`${companionUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          providerId: target.providerId,
          url: target.url,
          title: target.title,
          command: target.command,
          runLive: target.runLive
        })
      })
      const payload = (await response.json()) as { success: boolean; data?: unknown; error?: string }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `Companion returned ${response.status}`)
      }
      return payload.data as Awaited<ReturnType<BrowserObservationClient['read']>>
    }
  }
}

function requiredCompanionSecret(): string {
  const secret = process.env.LOCAL_COMPANION_SECRET?.trim()
  if (!secret || secret === 'dev-local-secret-change-me' || secret === 'replace-with-a-random-local-secret-at-least-24-chars' || secret.length < 24) {
    throw new Error('LOCAL_COMPANION_SECRET must be configured on the server before browser-source research.')
  }
  return secret
}
