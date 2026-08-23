import { describe, expect, it } from 'vitest'
import {
  buildResearchPlan,
  classifyBrowserAction,
  createHandoffLink,
  createJobStore,
  evaluatePolicy,
  generateItineraryVariants,
  normalizeCandidate,
  normalizeTripRequest,
  parseBookingText,
  redactSensitiveFields,
  sanitizeSourceSummary,
  scoreCandidate,
  validateExactPriceSnapshot,
  validateProviderUrl
} from '../index'

const observedAt = '2026-05-23T07:00:00.000Z'

describe('provider and browser safety gates', () => {
  it('blocks local browser research until the companion is paired', () => {
    const decision = evaluatePolicy({
      providerId: 'tripadvisor',
      providerAllowedOperations: ['local_browser_research'],
      operation: { kind: 'local_browser_research', isIrreversible: false },
      dataFields: ['name', 'price', 'source_timestamp'],
      forbiddenFields: ['review_text'],
      localCompanionPaired: false,
      userApproved: true,
      rateLimitRemaining: 5,
      environment: 'local'
    })

    expect(decision.type).toBe('deny')
    expect(decision.reason).toBe('local_companion_not_paired')
  })

  it('allows browser-source research only after pairing, approval, URL allowlist, and safe commands pass', () => {
    const urlDecision = validateProviderUrl('https://www.tripadvisor.com/Attraction_Review-test', {
      providerId: 'tripadvisor',
      allowedDomains: ['tripadvisor.com', 'www.tripadvisor.com']
    })
    const actionDecision = classifyBrowserAction({
      command: 'extract',
      label: 'Read price and rating',
      href: 'https://www.tripadvisor.com/Attraction_Review-test'
    })
    const policy = evaluatePolicy({
      providerId: 'tripadvisor',
      providerAllowedOperations: ['local_browser_research'],
      operation: { kind: 'local_browser_research', isIrreversible: false },
      dataFields: ['name', 'price', 'source_timestamp'],
      forbiddenFields: ['review_text'],
      localCompanionPaired: true,
      userApproved: true,
      rateLimitRemaining: 5,
      environment: 'local'
    })

    expect(urlDecision.allowed).toBe(true)
    expect(actionDecision.type).toBe('allow')
    expect(policy.type).toBe('allow_local_browser_research')
  })

  it('blocks form-fill, credential, booking, payment, confirmation, and cancellation actions', () => {
    const blocked = ['type', 'fill', 'select', 'upload', 'save-state', 'cookie-export', 'eval']
    for (const command of blocked) {
      expect(classifyBrowserAction({ command, label: 'anything' }).type).toBe('deny')
    }

    const unsafeLabels = [
      'Book now',
      'Pay and confirm',
      'Cancel reservation',
      'Sign in',
      'Submit traveler details'
    ]

    for (const label of unsafeLabels) {
      expect(classifyBrowserAction({ command: 'click', label }).type).toBe('deny')
    }

    expect(classifyBrowserAction({ command: 'click', label: 'Continue', href: 'https://www.klook.com/booking/checkout' }).type).toBe('deny')
  })

  it('blocks off-scope, private-network, and dangerous-scheme URLs', () => {
    expect(validateProviderUrl('javascript:alert(1)', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(false)
    expect(validateProviderUrl('file:///C:/secret.txt', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(false)
    expect(validateProviderUrl('http://www.klook.com/activity/test', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(false)
    expect(validateProviderUrl('http://127.0.0.1:5432', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(false)
    expect(validateProviderUrl('https://evil.example', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(false)
  })

  it('covers explicit policy approvals, denials, redaction, and safe browser clicks', () => {
    const basePolicy = {
      providerId: 'tripadvisor',
      providerAllowedOperations: ['local_browser_research', 'official_api'],
      dataFields: ['name', 'price'],
      forbiddenFields: ['review_text'],
      localCompanionPaired: true,
      userApproved: true,
      rateLimitRemaining: 2,
      environment: 'local' as const
    }

    expect(
      evaluatePolicy({
        ...basePolicy,
        environment: 'production',
        termsReviewed: false,
        operation: { kind: 'official_api', isIrreversible: false }
      }).reason
    ).toBe('provider_terms_not_reviewed')
    expect(evaluatePolicy({ ...basePolicy, operation: { kind: 'form_fill', isIrreversible: false } }).reason).toBe('form_fill_blocked_in_v1')
    expect(evaluatePolicy({ ...basePolicy, operation: { kind: 'booking_click', isIrreversible: true } }).reason).toBe('irreversible_external_action_blocked_in_v1')
    expect(evaluatePolicy({ ...basePolicy, operation: { kind: 'cookie_export', isIrreversible: false } }).reason).toBe('credential_or_cookie_storage_blocked')
    expect(evaluatePolicy({ ...basePolicy, operation: { kind: 'source_link', isIrreversible: false } }).type).toBe('allow_user_open_only')
    expect(evaluatePolicy({ ...basePolicy, userApproved: false, operation: { kind: 'local_browser_research', isIrreversible: false } }).type).toBe('require_user_approval')
    expect(evaluatePolicy({ ...basePolicy, rateLimitRemaining: 0, operation: { kind: 'local_browser_research', isIrreversible: false } }).reason).toBe('provider_rate_limited')
    expect(
      evaluatePolicy({
        ...basePolicy,
        dataFields: ['name', 'review_text'],
        forbiddenFields: ['review_text'],
        operation: { kind: 'local_browser_research', isIrreversible: false }
      }).type
    ).toBe('allow_with_redaction')
    expect(evaluatePolicy({ ...basePolicy, operation: { kind: 'official_api', isIrreversible: false } }).type).toBe('allow')
    expect(classifyBrowserAction({ command: 'unknown', label: 'Read source' }).reason).toBe('browser_command_not_allowlisted')
    expect(classifyBrowserAction({ command: 'click', label: 'Show more filters' }).type).toBe('allow')
    expect(validateProviderUrl('not a url', { providerId: 'klook', allowedDomains: ['klook.com'] }).reason).toBe('invalid_url')
    expect(validateProviderUrl('https://deals.klook.com/activity/test', { providerId: 'klook', allowedDomains: ['klook.com'] }).allowed).toBe(true)
  })
})

describe('trip, price, candidate, itinerary, and handoff semantics', () => {
  it('normalizes a real empty-workflow trip brief without seeding demo candidates', () => {
    const normalized = normalizeTripRequest({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-02',
      endDate: '2026-07-05',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 1600,
      priorities: ['value'],
      pace: 'balanced'
    })

    expect(normalized.status).toBe('ready')
    expect(normalized.request.destination.label).toBe('Lisbon, Portugal')
    expect(normalized.seededDemoData).toBe(false)
  })

  it('rejects impossible trip date ranges before itinerary solving', () => {
    const normalized = normalizeTripRequest({
      destination: 'Lisbon, Portugal',
      startDate: '2026-07-05',
      endDate: '2026-07-02',
      travelerCount: 2,
      currency: 'USD',
      budgetTotal: 1600,
      priorities: ['value'],
      pace: 'balanced'
    })

    expect(normalized.status).toBe('needs_user_input')
    expect(normalized.missingFields).toContain('endDate')
  })

  it('rejects exact prices without source URL, currency, or observation timestamp', () => {
    expect(validateExactPriceSnapshot({ amount: 42, currency: 'USD', observedAt, sourceUrl: 'https://www.klook.com/activity/test' }).valid).toBe(true)
    expect(validateExactPriceSnapshot({ amount: 42, currency: 'USD', sourceUrl: 'https://www.klook.com/activity/test' }).valid).toBe(false)
    expect(validateExactPriceSnapshot({ amount: 42, observedAt, sourceUrl: 'https://www.klook.com/activity/test' }).valid).toBe(false)
  })

  it('stores source-backed normalized candidates and score component explanations', () => {
    const candidate = normalizeCandidate({
      providerId: 'klook',
      providerOfferId: 'klook-alfama',
      type: 'activity',
      title: 'Alfama walking tour',
      priceAmount: 35,
      currency: 'USD',
      rating: 4.7,
      ratingScale: 5,
      reviewCount: 820,
      sourceUrl: 'https://www.klook.com/activity/alfama',
      observedAt,
      extractionMethod: 'fixture'
    })
    const scored = scoreCandidate(candidate, {
      priorities: ['value'],
      interests: ['history', 'food'],
      budgetPerDay: 250,
      categoryMeanRating: 78
    })

    expect(scored.sourceAttributions).toHaveLength(1)
    expect(scored.price?.exact).toBe(true)
    expect(scored.scores.total).toBeGreaterThan(60)
    expect(scored.explanation).toContain('source-backed')
  })

  it('creates multiple variants with winner and loser explanations', () => {
    const candidates = [
      normalizeCandidate({
        providerId: 'getyourguide',
        providerOfferId: 'castle',
        type: 'activity',
        title: 'Castle and culture pass',
        priceAmount: 50,
        currency: 'USD',
        rating: 4.8,
        ratingScale: 5,
        reviewCount: 1400,
        sourceUrl: 'https://www.getyourguide.com/castle',
        observedAt,
        extractionMethod: 'fixture'
      }),
      normalizeCandidate({
        providerId: 'tripadvisor',
        providerOfferId: 'luxury-dinner',
        type: 'restaurant',
        title: 'Luxury tasting dinner',
        priceAmount: 240,
        currency: 'USD',
        rating: 4.5,
        ratingScale: 5,
        reviewCount: 120,
        sourceUrl: 'https://www.tripadvisor.com/Restaurant_Review-test',
        observedAt,
        extractionMethod: 'fixture'
      })
    ].map((candidate) =>
      scoreCandidate(candidate, {
        priorities: ['value'],
        interests: ['culture'],
        budgetPerDay: 180,
        categoryMeanRating: 78
      })
    )

    const variants = generateItineraryVariants({
      tripId: 'trip-test',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
      currency: 'USD',
      budgetTotal: 700,
      pace: 'balanced',
      candidates
    })

    expect(variants.length).toBeGreaterThanOrEqual(3)
    expect(variants[0]?.winnerExplanation).toContain('wins')
    expect(variants[0]?.winnerExplanation).toContain('weather risk')
    expect(variants[0]?.loserExplanations.length).toBeGreaterThan(0)
    expect(variants[0]?.days[0]?.items[0]?.travelBufferMinutes).toBeGreaterThan(0)
    expect(variants[0]?.sourceAttributions.some((source) => source.providerId === 'openmeteo')).toBe(true)
    expect(variants[0]?.sourceAttributions.some((source) => source.providerId === 'openstreetmap')).toBe(true)
  })

  it('uses route buffers and weather risk to explain schedule warnings', () => {
    const candidate = scoreCandidate(
      normalizeCandidate({
        providerId: 'klook',
        providerOfferId: 'rainy-tour',
        type: 'activity',
        title: 'Rain-sensitive river tour',
        priceAmount: 40,
        currency: 'USD',
        rating: 4.4,
        ratingScale: 5,
        reviewCount: 300,
        sourceUrl: 'https://www.klook.com/activity/rainy-tour',
        observedAt,
        extractionMethod: 'fixture',
        durationMinutes: 180
      }),
      {
        priorities: ['value'],
        interests: ['river'],
        budgetPerDay: 150,
        categoryMeanRating: 78
      }
    )
    const weatherSource = {
      providerId: 'openmeteo',
      url: 'https://api.open-meteo.com/v1/forecast?fixture=storm',
      observedAt,
      extractionMethod: 'fixture' as const,
      confidence: 0.9,
      policyDecisionId: 'weather-storm'
    }
    const routeSource = {
      providerId: 'openstreetmap',
      url: 'https://www.openstreetmap.org/directions?fixture=long',
      observedAt,
      extractionMethod: 'fixture' as const,
      confidence: 0.88,
      policyDecisionId: 'route-long'
    }

    const variants = generateItineraryVariants({
      tripId: 'weather-route',
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      currency: 'USD',
      budgetTotal: 200,
      pace: 'balanced',
      candidates: [candidate],
      weatherByDate: {
        '2026-07-02': {
          level: 'high',
          summary: 'Thunderstorms likely in the afternoon.',
          precipitationProbability: 86,
          temperatureC: 21,
          sourceAttribution: weatherSource
        }
      },
      routeBuffersByCandidateId: {
        'rainy-tour': {
          minutes: 55,
          mode: 'transit',
          summary: 'Cross-town transit needs a long transfer buffer.',
          sourceAttribution: routeSource
        }
      }
    })

    const firstItem = variants[0]?.days[0]?.items[0]
    expect(firstItem?.travelBufferMinutes).toBe(55)
    expect(firstItem?.weatherRisk.level).toBe('high')
    expect(firstItem?.sourceAttributions).toEqual(expect.arrayContaining([weatherSource, routeSource]))
    expect(variants[0]?.warnings).toEqual(expect.arrayContaining([expect.stringContaining('high weather risk'), expect.stringContaining('Long transit buffer')]))
    expect(variants[0]?.totalScore).toBeLessThan(90)
  })

  it('preserves locked itinerary candidates across reoptimization variants', () => {
    const candidates = [
      normalizeCandidate({
        providerId: 'klook',
        providerOfferId: 'cheap-pass',
        type: 'activity',
        title: 'Cheap city pass',
        priceAmount: 20,
        currency: 'USD',
        rating: 4.9,
        ratingScale: 5,
        reviewCount: 1000,
        sourceUrl: 'https://www.klook.com/activity/cheap-pass',
        observedAt,
        extractionMethod: 'fixture'
      }),
      normalizeCandidate({
        providerId: 'tripadvisor',
        providerOfferId: 'locked-food-tour',
        type: 'restaurant',
        title: 'Locked food tour',
        priceAmount: 220,
        currency: 'USD',
        rating: 4.1,
        ratingScale: 5,
        reviewCount: 60,
        sourceUrl: 'https://www.tripadvisor.com/Restaurant_Review-locked',
        observedAt,
        extractionMethod: 'fixture'
      })
    ].map((candidate) =>
      scoreCandidate(candidate, {
        priorities: ['budget'],
        interests: ['budget'],
        budgetPerDay: 40,
        categoryMeanRating: 78
      })
    )

    const variants = generateItineraryVariants({
      tripId: 'locked-trip',
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      currency: 'USD',
      budgetTotal: 80,
      pace: 'relaxed',
      candidates,
      lockedCandidateIds: ['locked-food-tour']
    })

    for (const variant of variants) {
      const items = variant.days.flatMap((day) => day.items)
      expect(items.some((item) => item.candidateId === 'locked-food-tour' && item.locked)).toBe(true)
    }
  })

  it('excludes removed candidates from reoptimized variants unless they remain locked', () => {
    const candidates = [
      normalizeCandidate({
        providerId: 'klook',
        providerOfferId: 'remove-me',
        type: 'activity',
        title: 'Remove me pass',
        priceAmount: 20,
        currency: 'USD',
        rating: 4.9,
        ratingScale: 5,
        reviewCount: 1000,
        sourceUrl: 'https://www.klook.com/activity/remove-me',
        observedAt,
        extractionMethod: 'fixture'
      }),
      normalizeCandidate({
        providerId: 'tripadvisor',
        providerOfferId: 'keep-me',
        type: 'activity',
        title: 'Keep me walk',
        priceAmount: 25,
        currency: 'USD',
        rating: 4.8,
        ratingScale: 5,
        reviewCount: 900,
        sourceUrl: 'https://www.tripadvisor.com/Attraction_Review-keep',
        observedAt,
        extractionMethod: 'fixture'
      })
    ].map((candidate) =>
      scoreCandidate(candidate, {
        priorities: ['value'],
        interests: ['walk'],
        budgetPerDay: 100,
        categoryMeanRating: 78
      })
    )

    const variants = generateItineraryVariants({
      tripId: 'excluded-trip',
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      currency: 'USD',
      budgetTotal: 120,
      pace: 'balanced',
      candidates,
      excludedCandidateIds: ['remove-me']
    })

    expect(variants.every((variant) => variant.days.flatMap((day) => day.items).every((item) => item.candidateId !== 'remove-me'))).toBe(true)
    expect(variants.some((variant) => variant.days.flatMap((day) => day.items).some((item) => item.candidateId === 'keep-me'))).toBe(true)
  })

  it('creates provider handoff links without affiliate, booking, payment, or form-fill actions', () => {
    const handoff = createHandoffLink({
      providerId: 'agoda',
      url: 'https://www.agoda.com/hotel/test',
      observedAt,
      freshness: 'live',
      currency: 'USD'
    })

    expect(handoff.url).toBe('https://www.agoda.com/hotel/test')
    expect(handoff.disclosure).toContain('Book and support')
    expect(handoff.allowedActions).toEqual(['open_provider_url', 'manual_verify'])
  })

  it('handles sparse candidates, priority strategies, empty variants, and invalid handoff URLs', () => {
    const sparse = normalizeCandidate({
      providerId: 'openstreetmap',
      providerOfferId: 'poi-1',
      type: 'poi',
      title: 'Miradouro viewpoint',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      observedAt,
      extractionMethod: 'local_browser',
      freshness: 'manual_verify',
      geo: { lat: 38.71, lng: -9.13 },
      durationMinutes: 45
    })

    expect(sparse.price).toBeUndefined()
    expect(sparse.policyMode).toBe('local_user_browser')
    expect(sparse.geo?.lat).toBe(38.71)
    expect(sparse.durationMinutes).toBe(45)

    const official = normalizeCandidate({
      providerId: 'openmeteo',
      providerOfferId: 'weather-1',
      type: 'poi',
      title: 'Weather window',
      priceAmount: 0,
      currency: 'USD',
      rating: 7,
      ratingScale: 10,
      sourceUrl: 'https://api.open-meteo.com/v1/forecast',
      observedAt,
      extractionMethod: 'official_api',
      freshness: 'cached'
    })

    const contexts = [
      { priorities: ['budget' as const], interests: [], budgetPerDay: 1, categoryMeanRating: 78 },
      { priorities: ['rating' as const], interests: ['viewpoint'], budgetPerDay: 200, categoryMeanRating: 78 },
      { priorities: ['low_risk' as const], interests: [], budgetPerDay: 200, categoryMeanRating: 78 },
      { priorities: ['speed' as const], interests: [], budgetPerDay: 200, categoryMeanRating: 78 }
    ]
    const scored = contexts.map((context) => scoreCandidate(sparse, context))
    expect(scored.every((candidate) => candidate.warnings.includes('Price unavailable; manual verification required.'))).toBe(true)
    expect(scoreCandidate(official, contexts[1]).policyMode).toBe('official_api')

    const emptyVariants = generateItineraryVariants({
      tripId: 'empty',
      startDate: '2026-07-02',
      endDate: '2026-07-02',
      currency: 'USD',
      budgetTotal: 0,
      pace: 'relaxed',
      candidates: []
    })
    expect(emptyVariants[0]?.winnerExplanation).toContain('no selected items')
    expect(emptyVariants[0]?.warnings).toEqual([])
    expect(() => createHandoffLink({ providerId: 'agoda', url: 'ftp://bad', observedAt, freshness: 'stale', currency: 'USD' })).toThrow(/http or https/)
  })
})

describe('OCR import and job controls', () => {
  it('redacts sensitive identifiers before booking structuring', () => {
    const redacted = redactSensitiveFields(
      'Passport A1234567 card 4111 1111 1111 1111 DOB 1990-02-03 loyalty ABCD1234 email alex@example.com phone +1 415 555 0199 token=abc123456789 Hotel Azul 2026-07-02 $140'
    )

    expect(redacted).not.toContain('A1234567')
    expect(redacted).not.toContain('4111 1111 1111 1111')
    expect(redacted).not.toContain('1990-02-03')
    expect(redacted).not.toContain('alex@example.com')
    expect(redacted).not.toContain('abc123456789')
    expect(redacted).toContain('[REDACTED_PASSPORT]')
  })

  it('caps retained source summaries before they can be sent to model prompts', () => {
    const source = `Price USD 42 contact alex@example.com ${'dynamic availability '.repeat(200)}`
    const result = sanitizeSourceSummary(source, 120)

    expect(result.summary.length).toBeLessThanOrEqual(120)
    expect(result.summary).not.toContain('alex@example.com')
    expect(result.truncated).toBe(true)
  })

  it('marks low-confidence OCR imports for manual correction', () => {
    const parsed = parseBookingText('Faint scan Hotel Azul Lisbon 2026-07-02 USD 140', {
      documentId: 'doc-1',
      sourceType: 'image',
      ocrConfidence: 0.63
    })

    expect(parsed.needsUserCorrection).toBe(true)
    expect(parsed.extractedBookings[0]?.lockedConstraint).toBe(false)
  })

  it('rejects oversized OCR text before parsing or retention', () => {
    expect(() =>
      parseBookingText('x'.repeat(20_001), {
        documentId: 'doc-large',
        sourceType: 'manual',
        ocrConfidence: 0.9
      })
    ).toThrow(/Import text exceeds/)
  })

  it('supports observable pause, resume, and cancel job controls', () => {
    const store = createJobStore()
    const job = store.create({ tripId: 'trip-1', kind: 'research', phase: 'source_plan' })

    expect(store.pause(job.id).status).toBe('paused')
    expect(store.pause(job.id).status).toBe('paused')
    expect(store.resume(job.id).status).toBe('running')
    expect(store.cancel(job.id).status).toBe('cancelled')
    expect(() => store.resume(job.id)).toThrow(/Cannot transition cancelled job/)
    expect(() => store.progress(job.id, 100, 'should_not_spend', 3)).toThrow(/Cannot progress cancelled job/)
    expect(store.get(job.id)?.events.map((event) => event.type)).toEqual(['created', 'paused', 'resumed', 'cancelled'])
  })

  it('hydrates job stores, clamps progress, emits immutable snapshots, and locks high-confidence imports', () => {
    const snapshots: unknown[][] = []
    const store = createJobStore({
      initialJobs: [
        {
          id: 'job_7',
          tripId: 'trip-old',
          kind: 'monitor',
          phase: 'watch_price',
          status: 'running',
          progress: 20,
          costUsd: 0.01,
          events: [{ type: 'created', at: observedAt }]
        },
        {
          id: 'external-job',
          tripId: 'trip-other',
          kind: 'solve',
          phase: 'variants_ready',
          status: 'completed',
          progress: 100,
          costUsd: 0.02,
          events: [{ type: 'completed', at: observedAt }]
        }
      ],
      onChange: (jobs) => snapshots.push(jobs)
    })

    const created = store.create({ tripId: 'trip-new', kind: 'ocr', phase: 'parse' })
    expect(created.id).toBe('job_8')
    const progressed = store.progress(created.id, 140, 'done', 0.5)
    progressed.events.push({ type: 'mutated', at: observedAt })

    expect(store.get(created.id)?.progress).toBe(100)
    expect(store.get(created.id)?.events.map((event) => event.type)).toEqual(['created', 'progress'])
    expect(store.list()).toHaveLength(3)
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(() => store.pause('external-job')).toThrow(/Cannot transition completed job/)

    const parsed = parseBookingText('Loose note without recognizable booking price', {
      documentId: 'doc-high',
      sourceType: 'manual',
      ocrConfidence: 1.4
    })
    expect(parsed.confidence).toBe(1)
    expect(parsed.needsUserCorrection).toBe(false)
    expect(parsed.extractedBookings[0]?.lockedConstraint).toBe(true)
    expect(parsed.extractedBookings[0]?.title).toBe('Imported booking')
  })
})

describe('research plan', () => {
  it('uses official APIs when configured and browser-source fallback when policy guards allow it', () => {
    const plan = buildResearchPlan({
      destination: 'Lisbon',
      verticals: ['activities', 'hotels', 'restaurants'],
      providers: [
        { id: 'tripadvisor', modes: ['local_user_browser', 'source_link'], allowLocalBrowserResearch: true },
        { id: 'expedia', modes: ['official_api', 'local_user_browser', 'source_link'], allowLocalBrowserResearch: true, credentialsConfigured: true }
      ],
      localCompanionPaired: true
    })

    expect(plan.jobs.some((job) => job.mode === 'official_api')).toBe(true)
    expect(plan.jobs.some((job) => job.mode === 'local_user_browser')).toBe(true)
    expect(plan.jobs.every((job) => job.policyDecisionId)).toBe(true)
  })
})
