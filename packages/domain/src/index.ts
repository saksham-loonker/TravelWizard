import { z } from 'zod'

export type ProviderId =
  | 'tripadvisor'
  | 'klook'
  | 'getyourguide'
  | 'expedia'
  | 'agoda'
  | 'kiwi'
  | 'openstreetmap'
  | 'openmeteo'
  | string

export type CandidateType = 'activity' | 'hotel' | 'flight' | 'train' | 'restaurant' | 'poi' | 'transfer'
export type Freshness = 'live' | 'cached' | 'estimated' | 'stale' | 'manual_verify'
export type ProviderMode = 'official_api' | 'local_user_browser' | 'source_link'
export type TripPriority = 'budget' | 'value' | 'rating' | 'comfort' | 'speed' | 'low_risk'

export interface PolicyOperation {
  kind:
    | 'local_browser_research'
    | 'create_handoff'
    | 'official_api'
    | 'source_link'
    | 'form_fill'
    | 'cookie_export'
    | 'credential_storage'
    | 'booking_click'
    | 'payment_click'
    | 'confirmation_click'
    | 'cancellation_click'
  isIrreversible: boolean
}

export interface PolicyInput {
  providerId: ProviderId
  providerAllowedOperations: string[]
  operation: PolicyOperation
  dataFields: string[]
  forbiddenFields: string[]
  localCompanionPaired: boolean
  userApproved: boolean
  rateLimitRemaining: number
  environment: 'local' | 'test' | 'production'
  termsReviewed?: boolean
}

export type PolicyDecision =
  | { type: 'allow'; policyDecisionId: string }
  | { type: 'allow_with_redaction'; policyDecisionId: string; redactedFields: string[]; reason: string }
  | { type: 'allow_user_open_only'; policyDecisionId: string; reason: string }
  | { type: 'allow_local_browser_research'; policyDecisionId: string }
  | { type: 'require_user_approval'; policyDecisionId: string; reason: string }
  | { type: 'deny'; policyDecisionId: string; reason: string }

export interface ProviderUrlScope {
  providerId: ProviderId
  allowedDomains: string[]
}

export interface ExactPriceSnapshotInput {
  amount?: number
  currency?: string
  observedAt?: string
  sourceUrl?: string
  feesIncluded?: boolean
}

export interface MoneySnapshot {
  amount: number
  currency: string
  observedAt: string
  sourceUrl: string
  exact: boolean
  freshness: Freshness
  feesIncluded?: boolean
}

export interface SourceAttribution {
  providerId: ProviderId
  url: string
  observedAt: string
  extractionMethod: 'fixture' | 'official_api' | 'local_browser' | 'ocr' | 'manual'
  confidence: number
  policyDecisionId: string
}

export interface RawCandidate {
  providerId: ProviderId
  providerOfferId: string
  type: CandidateType
  title: string
  priceAmount?: number
  currency?: string
  rating?: number
  ratingScale?: number
  reviewCount?: number
  sourceUrl: string
  observedAt: string
  extractionMethod: SourceAttribution['extractionMethod']
  geo?: { lat: number; lng: number }
  durationMinutes?: number
  freshness?: Freshness
}

export interface ProviderCandidate {
  providerId: ProviderId
  providerOfferId: string
  type: CandidateType
  title: string
  price?: MoneySnapshot
  reviewSignal?: {
    normalizedRating: number
    reviewCount: number
    confidence: number
    ratingScore: number
  }
  sourceAttributions: SourceAttribution[]
  bookingUrl: string
  freshness: Freshness
  policyMode: ProviderMode
  observedAt: string
  geo?: { lat: number; lng: number }
  durationMinutes?: number
}

export interface ScoreContext {
  priorities: TripPriority[]
  interests: string[]
  budgetPerDay: number
  categoryMeanRating: number
}

export interface CandidateScores {
  userFit: number
  rating: number
  price: number
  logistics: number
  risk: number
  provider: number
  diversity: number
  total: number
}

export interface ScoredCandidate extends ProviderCandidate {
  scores: CandidateScores
  warnings: string[]
  explanation: string
}

export interface ItineraryVariant {
  id: string
  strategy: 'best_value' | 'lowest_cost' | 'highest_rated' | 'low_risk' | 'relaxed' | 'packed'
  days: Array<{
    date: string
    items: Array<{
      candidateId: string
      title: string
      startTime?: string
      endTime?: string
      locked: boolean
      travelBufferMinutes: number
      weatherRisk: WeatherRisk
      sourceAttributions: SourceAttribution[]
    }>
  }>
  totalCost: { min: number; max: number; currency: string; unknownCount: number }
  totalScore: number
  tradeoffs: string[]
  warnings: string[]
  sourceAttributions: SourceAttribution[]
  winnerExplanation: string
  loserExplanations: string[]
}

export interface WeatherRisk {
  level: 'low' | 'moderate' | 'high'
  summary: string
  precipitationProbability: number
  temperatureC: number
  sourceAttribution: SourceAttribution
}

export interface RouteBuffer {
  minutes: number
  mode: 'walk' | 'transit' | 'drive' | 'manual'
  summary: string
  sourceAttribution: SourceAttribution
}

export interface NormalizedTripRequest {
  status: 'ready' | 'needs_user_input'
  request: {
    destination: { label: string; aliases: string[] }
    startDate: string
    endDate: string
    travelerCount: number
    currency: string
    budgetTotal: number
    priorities: TripPriority[]
    pace: 'relaxed' | 'balanced' | 'packed'
    interests: string[]
    assumptions: string[]
  }
  missingFields: string[]
  seededDemoData: false
}

export const MAX_SOURCE_SUMMARY_CHARS = 1_500
export const MAX_IMPORT_TEXT_CHARS = 20_000
const ALGORITHM_FIXTURE_OBSERVED_AT = '2026-05-23T07:00:00.000Z'

export const TripRequestSchema = z
  .object({
    destination: z.string().trim().min(1).max(160),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    travelerCount: z.number().int().min(1).max(20),
    currency: z
      .string()
      .trim()
      .length(3)
      .default('USD')
      .transform((value) => value.toUpperCase()),
    budgetTotal: z.number().positive().max(1_000_000),
    priorities: z.array(z.enum(['budget', 'value', 'rating', 'comfort', 'speed', 'low_risk'])).default(['value']),
    pace: z.enum(['relaxed', 'balanced', 'packed']).default('balanced'),
    interests: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    mustInclude: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    avoid: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    accessibilityNeeds: z.array(z.string().trim().min(1).max(120)).max(20).default([])
  })
  .superRefine((value, context) => {
    if (Date.parse(value.endDate) < Date.parse(value.startDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be on or after startDate'
      })
    }
  })

const unsafeClickTerms = [
  'book',
  'reserve',
  'pay',
  'purchase',
  'confirm',
  'cancel',
  'refund',
  'login',
  'log in',
  'sign in',
  'account',
  'submit',
  'traveler',
  'passport',
  'card'
]

const blockedCommands = new Set([
  'type',
  'fill',
  'select',
  'upload',
  'drag',
  'save-state',
  'cookie-export',
  'cookies',
  'eval',
  'network-log',
  'console-log'
])

const allowedCommands = new Set([
  'browse',
  'goto',
  'snapshot',
  'text',
  'links',
  'table',
  'extract',
  'scroll',
  'back',
  'forward',
  'tabs',
  'switchTab',
  'screenshot',
  'click'
])

export function createPolicyDecisionId(prefix: string): string {
  return `${prefix}_${Math.abs(hashString(`${prefix}:${new Date(0).toISOString()}`))}`
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const policyDecisionId = createPolicyDecisionId(`${input.providerId}_${input.operation.kind}`)

  if (input.environment === 'production' && !input.termsReviewed) {
    return { type: 'deny', policyDecisionId, reason: 'provider_terms_not_reviewed' }
  }

  if (input.operation.kind === 'form_fill') {
    return { type: 'deny', policyDecisionId, reason: 'form_fill_blocked_in_v1' }
  }

  if (input.operation.isIrreversible) {
    return { type: 'deny', policyDecisionId, reason: 'irreversible_external_action_blocked_in_v1' }
  }

  if (input.operation.kind === 'cookie_export' || input.operation.kind === 'credential_storage') {
    return { type: 'deny', policyDecisionId, reason: 'credential_or_cookie_storage_blocked' }
  }

  if (!input.providerAllowedOperations.includes(input.operation.kind)) {
    return { type: 'allow_user_open_only', policyDecisionId, reason: 'operation_not_allowed' }
  }

  if (input.operation.kind === 'local_browser_research') {
    if (!input.localCompanionPaired) {
      return { type: 'deny', policyDecisionId, reason: 'local_companion_not_paired' }
    }
    if (!input.userApproved) {
      return { type: 'require_user_approval', policyDecisionId, reason: 'user_approval_required' }
    }
    if (input.rateLimitRemaining <= 0) {
      return { type: 'deny', policyDecisionId, reason: 'provider_rate_limited' }
    }
    const redactedFields = input.dataFields.filter((field) => input.forbiddenFields.includes(field))
    if (redactedFields.length > 0) {
      return { type: 'allow_with_redaction', policyDecisionId, redactedFields, reason: 'forbidden_fields_removed' }
    }
    return { type: 'allow_local_browser_research', policyDecisionId }
  }

  return { type: 'allow', policyDecisionId }
}

export function classifyBrowserAction(input: { command: string; label?: string; href?: string }): PolicyDecision {
  const policyDecisionId = createPolicyDecisionId(`browser_${input.command}`)
  const command = input.command.trim()
  const targetText = `${input.label ?? ''} ${input.href ?? ''}`.toLowerCase()

  if (blockedCommands.has(command)) {
    return { type: 'deny', policyDecisionId, reason: 'browser_command_blocked_in_v1' }
  }

  if (!allowedCommands.has(command)) {
    return { type: 'deny', policyDecisionId, reason: 'browser_command_not_allowlisted' }
  }

  if (command === 'click' && unsafeClickTerms.some((term) => targetText.includes(term))) {
    return { type: 'deny', policyDecisionId, reason: 'unsafe_click_blocked_in_v1' }
  }

  return { type: 'allow', policyDecisionId }
}

export function validateProviderUrl(url: string, scope: ProviderUrlScope): { allowed: boolean; reason?: string; normalizedUrl?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, reason: 'invalid_url' }
  }

  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'disallowed_scheme' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (isPrivateHost(hostname)) {
    return { allowed: false, reason: 'private_network_blocked' }
  }

  const domainAllowed = scope.allowedDomains.some((domain) => {
    const normalizedDomain = domain.toLowerCase()
    return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
  })

  if (!domainAllowed) {
    return { allowed: false, reason: 'domain_not_allowlisted' }
  }

  return { allowed: true, normalizedUrl: parsed.toString() }
}

export function validateExactPriceSnapshot(input: ExactPriceSnapshotInput): { valid: boolean; reason?: string } {
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0) {
    return { valid: false, reason: 'amount_required' }
  }
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency)) {
    return { valid: false, reason: 'currency_required' }
  }
  if (!input.observedAt || Number.isNaN(Date.parse(input.observedAt))) {
    return { valid: false, reason: 'observed_timestamp_required' }
  }
  if (!input.sourceUrl || !/^https?:\/\//.test(input.sourceUrl)) {
    return { valid: false, reason: 'source_url_required' }
  }
  return { valid: true }
}

export function normalizeTripRequest(input: unknown): NormalizedTripRequest {
  const result = TripRequestSchema.safeParse(input)
  if (!result.success) {
    return {
      status: 'needs_user_input',
      request: {
        destination: { label: '', aliases: [] },
        startDate: '',
        endDate: '',
        travelerCount: 1,
        currency: 'USD',
        budgetTotal: 0,
        priorities: ['value'],
        pace: 'balanced',
        interests: [],
        assumptions: []
      },
      missingFields: result.error.issues.map((issue) => issue.path.join('.') || issue.message),
      seededDemoData: false
    }
  }

  const parsed = result.data
  return {
    status: 'ready',
    request: {
      destination: {
        label: parsed.destination,
        aliases: [parsed.destination.toLowerCase()]
      },
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      travelerCount: parsed.travelerCount,
      currency: parsed.currency,
      budgetTotal: parsed.budgetTotal,
      priorities: parsed.priorities,
      pace: parsed.pace,
      interests: parsed.interests,
      assumptions: parsed.interests.length === 0 ? ['Balanced default interests until user adds specifics.'] : []
    },
    missingFields: [],
    seededDemoData: false
  }
}

export function normalizeCandidate(raw: RawCandidate): ProviderCandidate {
  const policyDecisionId = createPolicyDecisionId(`${raw.providerId}_candidate`)
  const exact = validateExactPriceSnapshot({
    ...(raw.priceAmount !== undefined ? { amount: raw.priceAmount } : {}),
    ...(raw.currency ? { currency: raw.currency } : {}),
    observedAt: raw.observedAt,
    sourceUrl: raw.sourceUrl
  })

  const normalizedRating = raw.rating && raw.ratingScale ? clamp((raw.rating / raw.ratingScale) * 100, 0, 100) : undefined
  const reviewCount = raw.reviewCount ?? 0
  const confidence = reviewConfidence(reviewCount)
  const ratingScore = normalizedRating === undefined ? 50 : bayesianRating(normalizedRating, reviewCount, 50, 78) * confidence + 78 * (1 - confidence)

  const candidate: ProviderCandidate = {
    providerId: raw.providerId,
    providerOfferId: raw.providerOfferId,
    type: raw.type,
    title: raw.title.trim(),
    reviewSignal: {
      normalizedRating: normalizedRating ?? 0,
      reviewCount,
      confidence,
      ratingScore
    },
    sourceAttributions: [
      {
        providerId: raw.providerId,
        url: raw.sourceUrl,
        observedAt: raw.observedAt,
        extractionMethod: raw.extractionMethod,
        confidence: raw.extractionMethod === 'fixture' ? 0.95 : 0.82,
        policyDecisionId
      }
    ],
    bookingUrl: raw.sourceUrl,
    freshness: raw.freshness ?? 'live',
    policyMode: raw.extractionMethod === 'official_api' ? 'official_api' : raw.extractionMethod === 'local_browser' ? 'local_user_browser' : 'source_link',
    observedAt: raw.observedAt
  }

  return {
    ...candidate,
    ...(exact.valid && raw.priceAmount !== undefined && raw.currency
      ? {
          price: {
            amount: raw.priceAmount,
            currency: raw.currency,
            observedAt: raw.observedAt,
            sourceUrl: raw.sourceUrl,
            exact: true,
            freshness: raw.freshness ?? 'live'
          }
        }
      : {}),
    ...(raw.geo ? { geo: raw.geo } : {}),
    ...(raw.durationMinutes !== undefined ? { durationMinutes: raw.durationMinutes } : {})
  }
}

export function scoreCandidate(candidate: ProviderCandidate, context: ScoreContext): ScoredCandidate {
  const userFit = scoreUserFit(candidate, context)
  const rating = candidate.reviewSignal?.ratingScore ?? context.categoryMeanRating
  const price = scorePrice(candidate.price, context.budgetPerDay)
  const logistics = candidate.geo ? 84 : 68
  const risk = candidate.freshness === 'live' ? 88 : candidate.freshness === 'manual_verify' ? 45 : 70
  const provider = candidate.policyMode === 'official_api' ? 88 : candidate.policyMode === 'local_user_browser' ? 76 : 65
  const diversity = candidate.type === 'restaurant' ? 72 : 78
  const weights = weightsForPriorities(context.priorities)
  const total =
    weights.userFit * userFit +
    weights.rating * rating +
    weights.price * price +
    weights.logistics * logistics +
    weights.risk * risk +
    weights.provider * provider +
    weights.diversity * diversity

  const warnings = [
    ...(candidate.price ? [] : ['Price unavailable; manual verification required.']),
    ...(candidate.reviewSignal && candidate.reviewSignal.confidence < 0.4 ? ['Low review confidence.'] : [])
  ]

  return {
    ...candidate,
    scores: {
      userFit,
      rating,
      price,
      logistics,
      risk,
      provider,
      diversity,
      total: Math.round(total)
    },
    warnings,
    explanation: `${candidate.title} is source-backed by ${candidate.providerId}; score drivers are rating ${Math.round(rating)}, price ${Math.round(price)}, logistics ${Math.round(logistics)}, and freshness ${candidate.freshness}. Verify dynamic price and availability before booking.`
  }
}

export function generateItineraryVariants(input: {
  tripId: string
  startDate: string
  endDate: string
  currency: string
  budgetTotal: number
  pace: 'relaxed' | 'balanced' | 'packed'
  candidates: ScoredCandidate[]
  lockedCandidateIds?: string[]
  excludedCandidateIds?: string[]
  weatherByDate?: Record<string, WeatherRisk>
  routeBuffersByCandidateId?: Record<string, RouteBuffer>
}): ItineraryVariant[] {
  const strategies: ItineraryVariant['strategy'][] = ['best_value', 'lowest_cost', 'highest_rated', 'low_risk', 'relaxed', 'packed']
  const dates = enumerateDates(input.startDate, input.endDate)
  const weatherByDate = input.weatherByDate ?? createDefaultWeatherByDate(dates)
  const routeBuffersByCandidateId = input.routeBuffersByCandidateId ?? createDefaultRouteBuffers(input.candidates)
  const lockedCandidateIds = new Set(input.lockedCandidateIds ?? [])
  const excludedCandidateIds = new Set((input.excludedCandidateIds ?? []).filter((candidateId) => !lockedCandidateIds.has(candidateId)))
  const availableCandidates = input.candidates.filter((candidate) => !excludedCandidateIds.has(candidate.providerOfferId))

  return strategies.map((strategy) => {
    const ranked = rankForStrategy(availableCandidates, strategy)
    const baseSelectedCount = strategy === 'packed' ? Math.min(4, ranked.length) : strategy === 'relaxed' ? Math.min(1, ranked.length) : Math.min(3, ranked.length)
    const locked = availableCandidates.filter((candidate) => lockedCandidateIds.has(candidate.providerOfferId))
    const selectedCount = Math.min(ranked.length, Math.max(baseSelectedCount, locked.length))
    const selected = [...locked, ...ranked.filter((candidate) => !lockedCandidateIds.has(candidate.providerOfferId))].slice(0, selectedCount)
    const selectedIds = new Set(selected.map((candidate) => candidate.providerOfferId))
    const losers = ranked.filter((candidate) => !selectedIds.has(candidate.providerOfferId)).slice(0, 3)
    const explanationLosers = losers.length > 0 ? losers : ranked.slice(1, 2)
    const days = dates.map((date, index) => ({
      date,
      items: selected
        .filter((_, selectedIndex) => selectedIndex % Math.max(1, dates.length) === index % Math.max(1, dates.length))
        .map((candidate, itemIndex) => {
          const routeBuffer = routeBuffersByCandidateId[candidate.providerOfferId] ?? defaultRouteBuffer(candidate.providerOfferId)
          const weatherRisk = weatherByDate[date] ?? defaultWeatherRisk(date)
          return {
            candidateId: candidate.providerOfferId,
            title: candidate.title,
            startTime: `${String(9 + itemIndex * 3).padStart(2, '0')}:00`,
            endTime: `${String(11 + itemIndex * 3).padStart(2, '0')}:00`,
            locked: lockedCandidateIds.has(candidate.providerOfferId),
            travelBufferMinutes: routeBuffer.minutes,
            weatherRisk,
            sourceAttributions: [...candidate.sourceAttributions, routeBuffer.sourceAttribution, weatherRisk.sourceAttribution]
          }
        })
    }))
    const total = selected.reduce((sum, candidate) => sum + (candidate.price?.amount ?? 0), 0)
    const unknownCount = selected.filter((candidate) => !candidate.price).length
    const routePenalty = selected.reduce((sum, candidate) => sum + Math.max(0, ((routeBuffersByCandidateId[candidate.providerOfferId]?.minutes ?? 25) - 45) / 5), 0)
    const weatherPenalty = days
      .flatMap((day) => day.items)
      .reduce((sum, item) => sum + (item.weatherRisk.level === 'high' ? 8 : item.weatherRisk.level === 'moderate' ? 3 : 0), 0)
    const averageScore = selected.length === 0 ? 0 : selected.reduce((sum, candidate) => sum + candidate.scores.total, 0) / selected.length
    const budgetFit = input.budgetTotal > 0 ? clamp(100 - Math.max(0, (total - input.budgetTotal) / input.budgetTotal) * 100, 0, 100) : 50
    const totalScore = Math.round(
      clamp(0.22 * averageScore + 0.18 * budgetFit + 0.16 * 78 + 0.14 * 76 + 0.12 * 80 + 0.08 * 82 + 0.05 * 75 + 0.05 * 78 - routePenalty - weatherPenalty, 0, 100)
    )
    const winner = selected[0]
    const sourceAttributions = days.flatMap((day) => day.items.flatMap((item) => item.sourceAttributions))
    const weatherWarnings = days
      .flatMap((day) => day.items)
      .filter((item) => item.weatherRisk.level !== 'low')
      .map((item) => `${item.weatherRisk.level} weather risk for ${item.title}: ${item.weatherRisk.summary}`)
    const routeWarnings = selected
      .map((candidate) => routeBuffersByCandidateId[candidate.providerOfferId] ?? defaultRouteBuffer(candidate.providerOfferId))
      .filter((route) => route.minutes > 45)
      .map((route) => `Long ${route.mode} buffer: ${route.summary}`)

    return {
      id: `${input.tripId}_${strategy}`,
      strategy,
      days,
      totalCost: { min: total, max: total, currency: input.currency, unknownCount },
      totalScore,
      tradeoffs: [`${strategy} prioritizes ${strategy.replace('_', ' ')} while preserving source-backed handoffs.`],
      warnings: [...(unknownCount > 0 ? ['Some prices require manual verification.'] : []), ...weatherWarnings, ...routeWarnings],
      sourceAttributions,
      winnerExplanation: winner
        ? `${winner.title} wins for ${strategy} because it combines score ${winner.scores.total}, source confidence, route buffer, weather risk, and feasible timing.`
        : `${strategy} has no selected items yet.`,
      loserExplanations: explanationLosers.map((candidate) => `${candidate.title} lost because score ${candidate.scores.total} or budget/logistics tradeoff was weaker than selected alternatives.`)
    }
  })
}

export function createHandoffLink(input: {
  providerId: ProviderId
  url: string
  observedAt: string
  freshness: Freshness
  currency: string
}): {
  id: string
  providerId: ProviderId
  url: string
  disclosure: string
  freshness: Freshness
  checklist: string[]
  allowedActions: string[]
  expiresAt: string
} {
  if (!/^https?:\/\//.test(input.url)) {
    throw new Error('Provider handoff URL must be http or https.')
  }
  return {
    id: `handoff_${Math.abs(hashString(input.providerId + input.url))}`,
    providerId: input.providerId,
    url: input.url,
    disclosure: 'Book and support stay with the provider. TravelWizard only opens the source for manual verification.',
    freshness: input.freshness,
    checklist: [
      `Verify ${input.currency} price on provider page.`,
      `Confirm availability; observed ${input.observedAt}.`,
      'Review cancellation/refund terms directly with provider.',
      'Do not enter payment or traveler details in TravelWizard.'
    ],
    allowedActions: ['open_provider_url', 'manual_verify'],
    expiresAt: new Date(Date.parse(input.observedAt) + 1000 * 60 * 60 * 24).toISOString()
  }
}

export function redactSensitiveFields(text: string): string {
  return text
    .replace(/\b(?:passport|pass)\s*[A-Z]?\d{6,9}\b/gi, '[REDACTED_PASSPORT]')
    .replace(/\b[A-Z]\d{7}\b/g, '[REDACTED_PASSPORT]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_PAYMENT_CARD]')
    .replace(/\b(?:DOB|date of birth)[:\s]*\d{4}-\d{2}-\d{2}\b/gi, '[REDACTED_DOB]')
    .replace(/\bloyalty\s+[A-Z0-9-]{5,}\b/gi, '[REDACTED_LOYALTY_ID]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:phone|tel|mobile)[:\s]*(?:\+?\d[\d(). -]{7,}\d)\b/gi, '[REDACTED_PHONE]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(?:api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_.-]{8,}\b/gi, '[REDACTED_SECRET]')
}

export function sanitizeSourceSummary(text: string, maxChars = MAX_SOURCE_SUMMARY_CHARS): { summary: string; redacted: boolean; truncated: boolean } {
  const redacted = redactSensitiveFields(text).replace(/\s+/g, ' ').trim()
  const truncated = redacted.length > maxChars
  return {
    summary: truncated ? redacted.slice(0, maxChars) : redacted,
    redacted: redacted !== text.replace(/\s+/g, ' ').trim(),
    truncated
  }
}

export function parseBookingText(
  text: string,
  options: { documentId: string; sourceType: 'pdf' | 'image' | 'email' | 'calendar' | 'manual'; ocrConfidence: number }
): {
  documentId: string
  sourceType: string
  extractedBookings: Array<{
    title: string
    date?: string
    price?: number
    currency?: string
    confidence: number
    lockedConstraint: boolean
  }>
  confidence: number
  needsUserCorrection: boolean
} {
  if (text.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`Import text exceeds ${MAX_IMPORT_TEXT_CHARS} characters.`)
  }
  const redacted = redactSensitiveFields(text)
  const date = redacted.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
  const amountMatch = redacted.match(/\b(?:USD|EUR|GBP|INR)\s*(\d+(?:\.\d{1,2})?)\b/i)
  const currency = redacted.match(/\b(USD|EUR|GBP|INR)\b/i)?.[1]?.toUpperCase()
  const title = redacted.match(/\b(?:Hotel|Flight|Train|Activity)\s+[A-Z][A-Za-z0-9 ]{2,40}/)?.[0] ?? 'Imported booking'
  const confidence = clamp(options.ocrConfidence, 0, 1)
  const needsUserCorrection = confidence < 0.85

  return {
    documentId: options.documentId,
    sourceType: options.sourceType,
    extractedBookings: [
      {
        title,
        ...(date ? { date } : {}),
        ...(amountMatch ? { price: Number(amountMatch[1]) } : {}),
        ...(currency ? { currency } : {}),
        confidence,
        lockedConstraint: !needsUserCorrection
      }
    ],
    confidence,
    needsUserCorrection
  }
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed'
export interface JobRecord {
  id: string
  tripId: string
  kind: 'research' | 'ocr' | 'solve' | 'monitor'
  phase: string
  status: JobStatus
  progress: number
  costUsd: number
  events: Array<{ type: string; at: string }>
}

export function createJobStore(options: { initialJobs?: JobRecord[]; onChange?: (jobs: JobRecord[]) => void } = {}) {
  const jobs = new Map<string, JobRecord>((options.initialJobs ?? []).map((job) => [job.id, cloneJob(job)]))
  let nextJobNumber = Math.max(
    0,
    ...(options.initialJobs ?? []).map((job) => {
      const match = /^job_(\d+)$/.exec(job.id)
      return match ? Number(match[1]) : 0
    })
  )
  const now = () => '2026-05-23T07:00:00.000Z'
  const notify = () => options.onChange?.(Array.from(jobs.values()).map(cloneJob))

  return {
    create(input: { tripId: string; kind: JobRecord['kind']; phase: string }): JobRecord {
      const job: JobRecord = {
        id: `job_${++nextJobNumber}`,
        tripId: input.tripId,
        kind: input.kind,
        phase: input.phase,
        status: 'running',
        progress: 0,
        costUsd: 0,
        events: [{ type: 'created', at: now() }]
      }
      jobs.set(job.id, job)
      notify()
      return cloneJob(job)
    },
    get(id: string): JobRecord | undefined {
      const job = jobs.get(id)
      return job ? cloneJob(job) : undefined
    },
    list(): JobRecord[] {
      return Array.from(jobs.values()).map(cloneJob)
    },
    pause(id: string): JobRecord {
      return transition(jobs, id, 'paused', 'paused', now(), notify)
    },
    resume(id: string): JobRecord {
      return transition(jobs, id, 'running', 'resumed', now(), notify)
    },
    cancel(id: string): JobRecord {
      return transition(jobs, id, 'cancelled', 'cancelled', now(), notify)
    },
    complete(id: string): JobRecord {
      const job = mustGet(jobs, id)
      if (job.status === 'completed') return cloneJob(job)
      if (job.status === 'cancelled' || job.status === 'failed') {
        throw new Error(`Cannot complete ${job.status} job: ${id}`)
      }
      const updated = {
        ...job,
        status: 'completed' as const,
        progress: 100,
        events: [...job.events, { type: 'completed', at: now() }]
      }
      jobs.set(id, updated)
      notify()
      return cloneJob(updated)
    },
    progress(id: string, progress: number, phase: string, costUsd = 0): JobRecord {
      const job = mustGet(jobs, id)
      if (isTerminalStatus(job.status)) {
        throw new Error(`Cannot progress ${job.status} job: ${id}`)
      }
      const updated = {
        ...job,
        progress: clamp(progress, 0, 100),
        phase,
        costUsd: job.costUsd + costUsd,
        events: [...job.events, { type: 'progress', at: now() }]
      }
      jobs.set(id, updated)
      notify()
      return cloneJob(updated)
    }
  }
}

export function buildResearchPlan(input: {
  destination: string
  verticals: string[]
  providers: Array<{ id: ProviderId; modes: ProviderMode[]; allowLocalBrowserResearch: boolean; credentialsConfigured?: boolean }>
  localCompanionPaired: boolean
}): {
  destination: string
  jobs: Array<{ providerId: ProviderId; vertical: string; mode: ProviderMode; policyDecisionId: string; fallback: ProviderMode | null }>
} {
  const jobs = input.verticals.flatMap((vertical) =>
    input.providers.flatMap((provider) => {
      const planned: Array<{ providerId: ProviderId; vertical: string; mode: ProviderMode; policyDecisionId: string; fallback: ProviderMode | null }> = []
      if (provider.modes.includes('official_api') && provider.credentialsConfigured) {
        planned.push({
          providerId: provider.id,
          vertical,
          mode: 'official_api',
          policyDecisionId: createPolicyDecisionId(`${provider.id}_${vertical}_api`),
          fallback: provider.allowLocalBrowserResearch ? 'local_user_browser' : 'source_link'
        })
      }
      if (provider.modes.includes('local_user_browser') && provider.allowLocalBrowserResearch && input.localCompanionPaired) {
        planned.push({
          providerId: provider.id,
          vertical,
          mode: 'local_user_browser',
          policyDecisionId: createPolicyDecisionId(`${provider.id}_${vertical}_browser`),
          fallback: 'source_link'
        })
      }
      if (planned.length === 0 && provider.modes.includes('source_link')) {
        planned.push({
          providerId: provider.id,
          vertical,
          mode: 'source_link',
          policyDecisionId: createPolicyDecisionId(`${provider.id}_${vertical}_link`),
          fallback: null
        })
      }
      return planned
    })
  )

  return { destination: input.destination, jobs }
}

export function createDefaultWeatherByDate(dates: string[]): Record<string, WeatherRisk> {
  return Object.fromEntries(dates.map((date) => [date, defaultWeatherRisk(date)]))
}

export function createDefaultRouteBuffers(candidates: ScoredCandidate[]): Record<string, RouteBuffer> {
  return Object.fromEntries(candidates.map((candidate) => [candidate.providerOfferId, defaultRouteBuffer(candidate.providerOfferId, candidate.durationMinutes)]))
}

function defaultWeatherRisk(date: string): WeatherRisk {
  return {
    level: 'low',
    summary: 'Low weather risk from cached Open-Meteo planning context.',
    precipitationProbability: 10,
    temperatureC: 22,
    sourceAttribution: {
      providerId: 'openmeteo',
      url: `https://api.open-meteo.com/v1/forecast?date=${date}`,
      observedAt: ALGORITHM_FIXTURE_OBSERVED_AT,
      extractionMethod: 'fixture',
      confidence: 0.78,
      policyDecisionId: createPolicyDecisionId(`openmeteo_weather_${date}`)
    }
  }
}

function defaultRouteBuffer(candidateId: string, durationMinutes?: number): RouteBuffer {
  const minutes = clamp(Math.ceil((durationMinutes ?? 90) * 0.2) + 15, 20, 75)
  return {
    minutes,
    mode: 'walk',
    summary: `${minutes} minute OSM-derived fallback buffer for ${candidateId}.`,
    sourceAttribution: {
      providerId: 'openstreetmap',
      url: 'https://www.openstreetmap.org/',
      observedAt: ALGORITHM_FIXTURE_OBSERVED_AT,
      extractionMethod: 'fixture',
      confidence: 0.72,
      policyDecisionId: createPolicyDecisionId(`openstreetmap_route_${candidateId}`)
    }
  }
}

function transition(jobs: Map<string, JobRecord>, id: string, status: JobStatus, event: string, at: string, notify?: () => void): JobRecord {
  const job = mustGet(jobs, id)
  if (job.status === status) return cloneJob(job)
  if (isTerminalStatus(job.status)) {
    throw new Error(`Cannot transition ${job.status} job: ${id}`)
  }
  const updated = { ...job, status, events: [...job.events, { type: event, at }] }
  jobs.set(id, updated)
  notify?.()
  return cloneJob(updated)
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed'
}

function mustGet(jobs: Map<string, JobRecord>, id: string): JobRecord {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job not found: ${id}`)
  return job
}

function cloneJob(job: JobRecord): JobRecord {
  return { ...job, events: job.events.map((event) => ({ ...event })) }
}

function scoreUserFit(candidate: ProviderCandidate, context: ScoreContext): number {
  const title = candidate.title.toLowerCase()
  const interestHits = context.interests.filter((interest) => title.includes(interest.toLowerCase())).length
  const base = context.interests.length === 0 ? 76 : 68 + interestHits * 12
  return clamp(base + (context.priorities.includes('comfort') && candidate.type === 'hotel' ? 8 : 0), 0, 100)
}

function scorePrice(price: MoneySnapshot | undefined, budgetPerDay: number): number {
  if (!price) return 35
  const ratio = price.amount / Math.max(1, budgetPerDay)
  return clamp(100 - ratio * 35, 0, 100)
}

function weightsForPriorities(priorities: TripPriority[]): Record<keyof Omit<CandidateScores, 'total'>, number> {
  const weights = {
    userFit: 0.22,
    rating: 0.18,
    price: 0.18,
    logistics: 0.17,
    risk: 0.15,
    provider: 0.05,
    diversity: 0.05
  }
  if (priorities.includes('budget')) {
    return { ...weights, price: 0.27, rating: 0.14, logistics: 0.15, risk: 0.12 }
  }
  if (priorities.includes('rating')) {
    return { ...weights, rating: 0.28, price: 0.12, diversity: 0.03 }
  }
  if (priorities.includes('low_risk')) {
    return { ...weights, risk: 0.25, price: 0.14, diversity: 0.03 }
  }
  if (priorities.includes('speed')) {
    return { ...weights, logistics: 0.27, price: 0.13, diversity: 0.03 }
  }
  return weights
}

function rankForStrategy(candidates: ScoredCandidate[], strategy: ItineraryVariant['strategy']): ScoredCandidate[] {
  const copy = [...candidates]
  if (strategy === 'lowest_cost') {
    return copy.sort((a, b) => (a.price?.amount ?? Number.POSITIVE_INFINITY) - (b.price?.amount ?? Number.POSITIVE_INFINITY))
  }
  if (strategy === 'highest_rated') {
    return copy.sort((a, b) => (b.reviewSignal?.ratingScore ?? 0) - (a.reviewSignal?.ratingScore ?? 0))
  }
  if (strategy === 'low_risk') {
    return copy.sort((a, b) => b.scores.risk - a.scores.risk)
  }
  return copy.sort((a, b) => b.scores.total - a.scores.total)
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  const dates: string[] = []
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10))
  }
  return dates.length > 0 ? dates : [startDate]
}

function bayesianRating(rating: number, reviewCount: number, minimumReviews: number, categoryMean: number): number {
  return (reviewCount / (reviewCount + minimumReviews)) * rating + (minimumReviews / (reviewCount + minimumReviews)) * categoryMean
}

function reviewConfidence(reviewCount: number): number {
  return clamp(Math.log10(reviewCount + 1) / Math.log10(1000 + 1), 0, 1)
}

function isPrivateHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}
