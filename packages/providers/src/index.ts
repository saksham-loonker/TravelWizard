import {
  buildResearchPlan,
  classifyBrowserAction,
  evaluatePolicy,
  normalizeCandidate,
  sanitizeSourceSummary,
  validateProviderUrl,
  type ProviderId,
  type RawCandidate
} from '@travelwizard/domain'

export const providerRegistry = [
  {
    id: 'tripadvisor',
    label: 'Tripadvisor',
    verticals: ['hotels', 'restaurants', 'activities'],
    allowedDomains: ['tripadvisor.com', 'www.tripadvisor.com'],
    modes: ['local_user_browser', 'source_link'] as const,
    allowLocalBrowserResearch: true
  },
  {
    id: 'klook',
    label: 'Klook',
    verticals: ['activities', 'transport', 'restaurants'],
    allowedDomains: ['klook.com', 'www.klook.com'],
    modes: ['local_user_browser', 'source_link'] as const,
    allowLocalBrowserResearch: true
  },
  {
    id: 'getyourguide',
    label: 'GetYourGuide',
    verticals: ['activities'],
    allowedDomains: ['getyourguide.com', 'www.getyourguide.com'],
    modes: ['local_user_browser', 'source_link'] as const,
    allowLocalBrowserResearch: true
  },
  {
    id: 'expedia',
    label: 'Expedia',
    verticals: ['hotels', 'flights'],
    allowedDomains: ['expedia.com', 'www.expedia.com'],
    modes: ['official_api', 'local_user_browser', 'source_link'] as const,
    allowLocalBrowserResearch: true
  },
  {
    id: 'agoda',
    label: 'Agoda',
    verticals: ['hotels'],
    allowedDomains: ['agoda.com', 'www.agoda.com'],
    modes: ['local_user_browser', 'source_link'] as const,
    allowLocalBrowserResearch: true
  }
]

export function createDefaultResearchPlan(destination: string, localCompanionPaired: boolean) {
  return buildResearchPlan({
    destination,
    verticals: ['activities', 'hotels', 'restaurants'],
    providers: providerRegistry.map((provider) => ({
      id: provider.id,
      modes: [...provider.modes],
      allowLocalBrowserResearch: provider.allowLocalBrowserResearch,
      credentialsConfigured: provider.id === 'expedia' && Boolean(process.env.EXPEDIA_RAPID_KEY)
    })),
    localCompanionPaired
  })
}

export function createBrowserObservation(input: {
  providerId: ProviderId
  url: string
  title: string
  text?: string
  observedAt: string
  localCompanionPaired: boolean
}) {
  const provider = providerRegistry.find((item) => item.id === input.providerId)
  if (!provider) throw new Error(`Unknown provider: ${input.providerId}`)

  const urlDecision = validateProviderUrl(input.url, {
    providerId: input.providerId,
    allowedDomains: [...provider.allowedDomains]
  })
  if (!urlDecision.allowed) return { allowed: false, reason: urlDecision.reason }

  const actionDecision = classifyBrowserAction({ command: 'extract', label: 'Read allowed source facts', href: input.url })
  if (actionDecision.type !== 'allow') return { allowed: false, reason: 'reason' in actionDecision ? actionDecision.reason : actionDecision.type }

  const policyDecision = evaluatePolicy({
    providerId: input.providerId,
    providerAllowedOperations: ['local_browser_research'],
    operation: { kind: 'local_browser_research', isIrreversible: false },
    dataFields: ['name', 'price', 'source_timestamp'],
    forbiddenFields: ['review_text'],
    localCompanionPaired: input.localCompanionPaired,
    userApproved: true,
    rateLimitRemaining: 5,
    environment: 'local'
  })
  if (policyDecision.type !== 'allow_local_browser_research') return { allowed: false, reason: 'reason' in policyDecision ? policyDecision.reason : policyDecision.type }

  const sourceSummary = sanitizeSourceSummary(input.text ?? '', 500)

  return {
    allowed: true,
    observation: {
      providerId: input.providerId,
      url: input.url,
      title: input.title,
      observedAt: input.observedAt,
      extractedFields: {
        title: input.title,
        summary: sourceSummary.summary,
        summaryTruncated: sourceSummary.truncated
      },
      sourceLinks: [input.url],
      policyDecisionId: policyDecision.policyDecisionId,
      freshness: 'live' as const
    }
  }
}

export function fixturesForDestination(destination: string): RawCandidate[] {
  const observedAt = '2026-05-23T07:00:00.000Z'
  const prefix = destination.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'destination'
  return [
    {
      providerId: 'tripadvisor',
      providerOfferId: `${prefix}-walk`,
      type: 'activity',
      title: `${destination} source-backed walking route`,
      priceAmount: 28,
      currency: 'USD',
      rating: 4.6,
      ratingScale: 5,
      reviewCount: 900,
      sourceUrl: 'https://www.tripadvisor.com/Attraction_Review-test',
      observedAt,
      extractionMethod: 'fixture'
    },
    {
      providerId: 'klook',
      providerOfferId: `${prefix}-pass`,
      type: 'activity',
      title: `${destination} attraction pass`,
      priceAmount: 45,
      currency: 'USD',
      rating: 4.7,
      ratingScale: 5,
      reviewCount: 620,
      sourceUrl: 'https://www.klook.com/activity/test',
      observedAt,
      extractionMethod: 'fixture'
    }
  ]
}

export function normalizedFixtureCandidates(destination: string) {
  return fixturesForDestination(destination).map(normalizeCandidate)
}
