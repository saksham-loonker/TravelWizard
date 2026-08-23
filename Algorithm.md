# TravelWizard Algorithm

## Purpose

This document defines the algorithms and state machines that turn a trip brief into a coordinated, explainable, legally safer itinerary with provider handoffs. It supports the implementation plan in `Plan.md`. `Plan.md` is the product and build authority; this file is the algorithm companion. Future build agents must use recommended defaults from `Plan.md` instead of stopping for more product questions.

## Locked Runtime Configuration

- Scope: global travel planning.
- Destination mode: destination chosen by user.
- Trip modes: support all major styles, with balanced defaults that work for budget/student and quality/comfort travelers.
- Verticals: activities, attractions, hotels, flights, trains, restaurants, maps, weather, budget, reviews, and provider handoffs.
- Optimization: best value balanced across cost, quality, logistics, weather fit, and review confidence.
- Provider priority: Tripadvisor, Klook, GetYourGuide, Expedia, Agoda, with additional providers through adapters.
- App mode: local, private, single-user first build. Do not require hosted auth, signup, teams, or cloud tenancy.
- Browser runtime: local `swiftbrowse` companion on the user's computer, headless by default and hybrid/headed when useful.
- Browser package source: the user will copy the whole `swiftbrowse` project into this repository before implementation; target import path is the repo-copied package, recommended as `vendor/swiftbrowse`.
- Browser-source timing: browser-source research starts immediately in the first functional build after local companion pairing and policy guards pass.
- Browser capabilities in v1: suggest, open tabs, navigate, read, extract allowed source facts, collect links, and monitor prices if the user asks.
- Browser restrictions in v1: no form filling, no booking clicks, no payment clicks, no confirm/cancel clicks, no credential storage, no traveler PII storage, and no replay traces by default.
- Imports: support OCR/document extraction for existing bookings.
- LLM: OpenAI-compatible API configured from `.env`.
- Price display: exact observed source prices with timestamp and freshness; never invent exact prices.
- Planning loop: multi-round research, draft, critique, repair, and improve.
- Demo data: no seeded demo trip. The user will test with their own destination.
- Runtime/deployment: focus on local running now; Vercel is a future target only.

## Core Pipeline

```text
input trip brief
  -> validate and normalize
  -> import existing bookings with OCR when provided
  -> infer missing soft preferences
  -> apply recommended defaults and mark irreducible missing hard constraints as manual-required states
  -> seed map explorer for chosen destination
  -> build provider research plan
  -> run provider policy checks
  -> collect candidates from allowed APIs and local browser research
  -> normalize provider data
  -> resolve duplicate entities
  -> enrich with geo, route, budget, rating, and risk signals
  -> score candidates
  -> generate itinerary variants
  -> optimize each variant
  -> critique feasibility and compliance
  -> repair and re-score
  -> explain tradeoffs
  -> create provider handoff links
  -> monitor stale or user-booked items
```

## Data Types

```ts
type TripPriority = 'budget' | 'value' | 'rating' | 'comfort' | 'speed' | 'low_risk'

interface TripRequest {
  origin?: GeoPlace
  destinations: GeoPlace[]
  dateWindow: DateWindow
  travelers: Traveler[]
  budget: BudgetEnvelope
  priorities: TripPriority[]
  interests: string[]
  mustInclude: string[]
  avoid: string[]
  pace: 'relaxed' | 'balanced' | 'packed'
  accessibilityNeeds: string[]
  riskTolerance: 'low' | 'medium' | 'high'
  currency: string
  locale: string
}

interface ProviderCandidate {
  canonicalId?: string
  providerId: string
  providerOfferId: string
  type: 'activity' | 'hotel' | 'flight' | 'train' | 'restaurant' | 'poi' | 'transfer'
  title: string
  geo?: GeoPoint
  timeWindow?: TimeWindow
  durationMinutes?: number
  price?: MoneyRange
  cancellation?: CancellationPolicy
  reviewSignal?: ReviewSignal
  sourceAttributions: SourceAttribution[]
  bookingUrl?: string
  freshness: 'live' | 'cached' | 'estimated' | 'stale' | 'manual_verify'
  policyMode: ProviderAccessMode
  observedAt?: string
}

interface ScoredCandidate extends ProviderCandidate {
  scores: CandidateScores
  warnings: Warning[]
  explanation: string
}

interface ItineraryVariant {
  id: string
  days: ItineraryDay[]
  totalCost: MoneyRange
  totalScore: number
  tradeoffs: Tradeoff[]
  warnings: Warning[]
  sourceAttributions: SourceAttribution[]
}

interface BrowserObservation {
  providerId: string
  url: string
  title: string
  observedAt: string
  extractedFields: Record<string, unknown>
  sourceLinks: string[]
  policyDecisionId: string
  freshness: 'live' | 'cached' | 'stale' | 'manual_verify'
}

interface ImportExtraction {
  documentId: string
  sourceType: 'pdf' | 'image' | 'email' | 'calendar' | 'manual'
  extractedBookings: ImportedBooking[]
  confidence: number
  needsUserCorrection: boolean
}
```

## Step 1: Validate And Normalize Trip Brief

### Rules

- Hard constraints must be explicit: dates, traveler count, budget, origin for transport, and user-chosen destination.
- Soft preferences may be inferred but must be labeled as assumptions.
- Dates must be timezone-aware.
- Currency must be normalized to the user's display currency and retain original provider currency.
- Budget must include categories: transport, lodging, activities, food, local transit, buffer, fees.
- PII must not be stored in v1. User-provided travel documents must be OCR-processed into non-sensitive booking facts only.

### Pseudocode

```ts
function normalizeTripRequest(input: unknown): NormalizedTripRequest {
  const parsed = TripRequestSchema.parse(input)
  const hardMissing = findMissingHardConstraints(parsed)

  if (hardMissing.length > 0) {
    return {
      status: 'needs_user_input',
      missingFields: hardMissing,
      assumptions: []
    }
  }

  const assumptions = inferSoftPreferences(parsed)
  const normalizedBudget = normalizeBudget(parsed.budget, parsed.currency)
  const dateWindow = normalizeDateWindow(parsed.dateWindow, parsed.destinations)

  return {
    status: 'ready',
    request: {
      ...parsed,
      budget: normalizedBudget,
      dateWindow
    },
    assumptions
  }
}
```

## Step 1A: Import Existing Bookings With OCR

Existing bookings can arrive as PDFs, screenshots, scanned images, email exports, calendar files, or manual text. The import algorithm must extract only trip-planning facts and must not persist passports, payment card data, dates of birth, government IDs, loyalty IDs, or provider credentials.

### Extracted Fields

- Provider name.
- Booking reference when it is not sensitive.
- Hotel/activity/transport title.
- Address or station/airport.
- Date and time.
- Traveler count.
- Price and currency.
- Cancellation deadline if visible.
- Source document pointer.
- OCR confidence.

### Algorithm

1. Validate file type, size, and source.
2. Convert PDF/image pages to OCR text.
3. Run deterministic parsers for dates, prices, addresses, flight/train numbers, and hotel names.
4. Use the LLM only to structure ambiguous text, with sensitive fields redacted first.
5. Compare extracted dates and places against the trip brief.
6. Mark low-confidence fields for user correction.
7. Convert confirmed extracted bookings into locked itinerary constraints.

```ts
async function importExistingBooking(document: ImportDocument): Promise<ImportExtraction> {
  validateImportDocument(document)
  const ocrText = await runOcr(document)
  const redactedText = redactSensitiveFields(ocrText)
  const deterministicFields = parseBookingFields(redactedText)
  const structured = await structureAmbiguousBookingText(redactedText, deterministicFields)
  const confidence = scoreExtractionConfidence(structured)

  return {
    documentId: document.id,
    sourceType: document.sourceType,
    extractedBookings: structured.bookings,
    confidence,
    needsUserCorrection: confidence < 0.85
  }
}
```

## Step 2: Build Research Plan

The research plan decides which providers and search calls are needed.

### Inputs

- TripRequest.
- Enabled providers.
- Provider capabilities.
- Provider policies.
- User country and destination country.
- Budget and trip priorities.

### Output

`ResearchPlan` containing provider jobs, cache keys, policy gates, and fallback paths.

### Algorithm

1. Expand destination into search areas.
2. Determine needed verticals: activity, lodging, transport, restaurants, route, weather, reviews, and map context.
3. Select providers by capability and access mode.
4. Remove providers whose policies block the requested use.
5. Build cache keys from destination, dates, traveler count, locale, currency, and provider.
6. Mark jobs requiring local `swiftbrowse` browser research.
7. Add fallback jobs for manual provider handoff if API or browser research is unavailable.

```ts
function buildResearchPlan(request: TripRequest, providers: Provider[]): ResearchPlan {
  const neededVerticals = inferVerticals(request)
  const jobs = []

  for (const vertical of neededVerticals) {
    const capableProviders = providers.filter(provider =>
      provider.capabilities.includes(vertical)
    )

    for (const provider of capableProviders) {
      const decision = evaluateProviderPolicy(provider, vertical, request)
      if (decision.allowed) {
        jobs.push(createProviderJob(provider, vertical, request, decision))
      } else if (provider.supportsUserOpen) {
        jobs.push(createManualHandoffJob(provider, vertical, request, decision.reason))
      }
    }
  }

  return prioritizeResearchJobs(jobs, request.priorities)
}
```

## Step 3: Provider Policy Guard

Every provider operation must pass through the policy guard.

### Decision Inputs

- Provider.
- Operation.
- Data fields requested.
- Storage intent.
- Display intent.
- User consent state.
- Rate-limit state.
- Terms-review status.

### Decision Outputs

- `allow`: operation may run.
- `allow_with_redaction`: operation may run but some fields must be removed.
- `allow_user_open_only`: app may open provider URL but not collect protected content.
- `allow_local_browser_research`: local `swiftbrowse` may open/read/observe the page under policy and rate limits.
- `require_user_approval`: user must approve before action.
- `deny`: operation is blocked.

```ts
function evaluatePolicy(input: PolicyInput): PolicyDecision {
  if (!input.provider.termsReviewed && input.environment === 'production') {
    return deny('provider_terms_not_reviewed')
  }

  if (!input.provider.allowedOperations.includes(input.operation)) {
    return fallbackOrDeny(input, 'operation_not_allowed')
  }

  if (input.operation.kind === 'form_fill' && input.environment === 'v1') {
    return deny('form_fill_blocked_in_v1')
  }

  if (input.operation.isIrreversible) {
    return deny('irreversible_external_action_blocked_in_v1')
  }

  if (input.operation.kind === 'cookie_export' || input.operation.kind === 'credential_storage') {
    return deny('credential_or_cookie_storage_blocked')
  }

  if (input.operation.kind === 'local_browser_research' && input.provider.allowLocalBrowserResearch) {
    if (!input.localCompanionPaired) return deny('local_companion_not_paired')
    return allowLocalBrowserResearch()
  }

  if (input.dataFields.some(field => input.provider.forbiddenFields.includes(field))) {
    return allowWithRedaction('forbidden_fields_removed')
  }

  if (input.rateLimit.remaining <= 0) {
    return deny('provider_rate_limited')
  }

  return allow()
}
```

## Step 4: Collect Candidates

### Requirements

- Use official APIs where available.
- Use local `swiftbrowse` browser research for provider pages when API access is absent or insufficient and policy permits it.
- Respect provider cache TTL.
- Back off on 429 and provider-specific retry headers.
- Store raw provider response only if policy allows it.
- Always store source attribution and freshness timestamp.
- Capture exact observed prices only with source URL, timestamp, currency, and freshness state.
- Preserve provider URL for user handoff.
- Do not fill forms, export cookies, or store credentials during collection.

### Local Browser Collection

1. Pair the web app with the local companion using a short-lived token.
2. Create a browser job with allowed provider domains and target fields.
3. Launch `swiftbrowse` in headless mode by default, with cookies disabled unless a future explicit consent feature is added.
4. Use `goto`, `snapshot`, `text`, `links`, `extract`, and `table` to observe pages.
5. Stop before any form entry, login wall, CAPTCHA, booking flow, payment flow, or confirm/cancel action.
6. Return `BrowserObservation` objects with source URLs, timestamps, extracted fields, and policy decisions.
7. Convert observations into normalized provider candidates only when the fields are source-supported.

### Error Handling

- Provider timeout: retry with exponential backoff, then degrade to manual handoff.
- Provider 401/403: disable provider capability and alert admin.
- Provider 429: back off and show partial results.
- Provider schema change: quarantine adapter and use fallback.
- Price unavailable: mark `manual_verify`.
- Local browser blocked by CAPTCHA/login/anti-bot: stop and return `manual_verify` with provider link.
- Local companion offline: fall back to provider handoff and show the missing local-browser capability.

## Step 5: Normalize Provider Data

Provider responses must be mapped into canonical candidates.

### Normalization Rules

- Convert prices to `MoneyRange`.
- Keep original currency and converted currency.
- Convert ratings to a 0-100 internal scale.
- Keep rating source separate from rating value.
- Convert locations to WGS84 lat/lng.
- Normalize durations to minutes.
- Normalize cancellation into common buckets.
- Normalize availability into explicit time windows.
- Preserve provider-specific IDs.
- Do not copy fields whose display/storage is not allowed.
- Set `observedAt` on every browser-sourced price and review signal.

```ts
function normalizeCandidate(raw: RawProviderOffer, policy: ProviderPolicy): ProviderCandidate {
  const allowed = filterAllowedFields(raw, policy)

  return {
    providerId: raw.providerId,
    providerOfferId: raw.id,
    type: mapProviderType(raw.type),
    title: normalizeTitle(allowed.title),
    geo: normalizeGeo(allowed.location),
    durationMinutes: normalizeDuration(allowed.duration),
    price: normalizeMoneyRange(allowed.price),
    cancellation: normalizeCancellation(allowed.cancellation),
    reviewSignal: normalizeReviewSignal(allowed.rating, allowed.reviewCount),
    sourceAttributions: buildAttributions(raw),
    bookingUrl: allowed.bookingUrl,
    freshness: raw.freshness,
    policyMode: policy.accessMode,
    observedAt: raw.observedAt
  }
}
```

## Step 6: Entity Resolution

The same activity, attraction, hotel, or station may appear on many platforms.

### Matching Signals

- Provider canonical IDs.
- Name similarity.
- Geo distance.
- Address similarity.
- Duration similarity.
- Category similarity.
- Image hash only if image use is licensed.
- Provider cross-reference IDs where licensed.

### Algorithm

1. Group by type and destination area.
2. Block obvious non-matches by distance and category.
3. Compute match score.
4. Merge if score >= high threshold.
5. Mark as possible duplicate if between thresholds.
6. Never merge transport offers unless route, date, time, carrier, and fare class match.

```ts
function resolveEntities(candidates: ProviderCandidate[]): CanonicalCandidate[] {
  const groups = blockByTypeAndGeo(candidates)
  const resolved = []

  for (const group of groups) {
    const clusters = cluster(group, (a, b) => {
      return weightedAverage([
        [nameSimilarity(a.title, b.title), 0.35],
        [geoSimilarity(a.geo, b.geo), 0.30],
        [categorySimilarity(a.type, b.type), 0.15],
        [durationSimilarity(a.durationMinutes, b.durationMinutes), 0.10],
        [addressSimilarity(a, b), 0.10]
      ])
    })

    resolved.push(...mergeClusters(clusters))
  }

  return resolved
}
```

## Step 7: Rating And Review Normalization

Do not compare raw 4.7/5 from one site against 9.1/10 from another without normalization.

Raw review text must not be stored or republished unless the provider license explicitly allows it. Store only allowed aggregate signals, source URLs, timestamps, and generated explanations grounded in those signals.

### Bayesian Rating

Use a Bayesian adjusted score so low-review-count items do not dominate.

```text
bayesian_rating = (v / (v + m)) * R + (m / (v + m)) * C
```

Where:

- `R` = normalized item rating on 0-100 scale.
- `v` = review count for item.
- `m` = minimum reviews threshold for confidence.
- `C` = category/global mean rating.

### Review Confidence

```text
review_confidence =
  min(1, log10(review_count + 1) / log10(confidence_review_count + 1))
  * recency_factor
  * source_trust_factor
```

### Rating Score

```text
rating_score = bayesian_rating * review_confidence + category_mean * (1 - review_confidence)
```

## Step 8: Cost Normalization

### Cost Fields

- Base price.
- Taxes and fees if known.
- Platform service fees if known.
- Baggage/seat/ancillary estimates for transport.
- Local transit cost.
- Cancellation/refund risk.
- Price freshness.
- Currency conversion timestamp.
- Observed-at timestamp for exact browser/API prices.

Exact price display rule:

- If the source provides an exact price, display that exact observed price with provider, URL, currency, and timestamp.
- If the source does not provide an exact price, do not estimate one as exact.
- If price is stale or unavailable, mark `manual_verify`.

### Budget Fit

```text
budget_fit = 100 - min(100, max(0, (projected_total - budget_total) / budget_total * 100))
```

### Value Score

```text
value_score = rating_score / max(1, normalized_price_index)
```

Clamp and scale to 0-100.

## Step 9: Candidate Scoring

### Score Components

- `user_fit_score`: interests, avoid-list, pace, accessibility, preferred style.
- `rating_score`: Bayesian and confidence-adjusted review quality.
- `price_score`: relative affordability and budget fit.
- `logistics_score`: location, duration, route impact, time-window fit.
- `risk_score`: cancellation, transfer risk, weather, stale availability, and provider reliability. Visa/passport/safety-advisory scoring is not first-class in v1.
- `provider_score`: provider trust, policy clarity, handoff quality.
- `novelty_diversity_score`: avoids repetitive days.

### Weighted Formula

```text
candidate_score =
  w_user_fit * user_fit_score +
  w_rating * rating_score +
  w_price * price_score +
  w_logistics * logistics_score +
  w_risk * risk_score +
  w_provider * provider_score +
  w_diversity * novelty_diversity_score
```

### Default Weights

For balanced/value trips:

```json
{
  "user_fit": 0.22,
  "rating": 0.18,
  "price": 0.18,
  "logistics": 0.17,
  "risk": 0.15,
  "provider": 0.05,
  "diversity": 0.05
}
```

Modify weights by trip priority:

- Budget: increase price and budget fit.
- Ratings: increase rating and review confidence.
- Low risk: increase risk and cancellation flexibility.
- Speed: increase logistics and route time.
- Comfort: increase hotel quality, transfer buffer, and low-risk transport.

## Step 10: Route And Time Feasibility

### Constraints

- Opening hours.
- Check-in/check-out times.
- Flight/rail departure and arrival times.
- Transfer buffers.
- Meal breaks.
- Sleep/rest hours.
- Activity duration.
- Transit duration and uncertainty.
- Accessibility needs.
- Group pace.

### Time Buffer Defaults

- Airport domestic departure buffer: configurable, default 120 minutes.
- Airport international departure buffer: configurable, default 180 minutes.
- Rail departure buffer: configurable, default 30 minutes.
- Hotel check-in buffer: default 30 minutes.
- Activity transfer buffer: default 15 minutes plus route uncertainty.
- Self-transfer flight buffer: conservative and destination-specific; warn heavily.

## Step 11: Itinerary Optimization

This is a constrained multi-objective optimization problem. Use deterministic algorithms first, then LLMs for explanation and preference interpretation.

### Variant Strategy

Generate multiple variants:

- `best_value`
- `lowest_cost`
- `highest_rated`
- `low_risk`
- `packed`
- `relaxed`

### Algorithm Choice

- For the initial full build: greedy construction plus local repair, with deterministic feasibility checks and complete explanation output.
- For deeper optimization: optional OR-Tools CP-SAT or mixed-integer optimization for exact time-window scheduling.
- For large candidate sets: beam search plus local search.

### Greedy Plus Repair Pseudocode

```ts
function buildItineraryVariant(
  request: TripRequest,
  candidates: ScoredCandidate[],
  strategy: Strategy
): ItineraryVariant {
  const days = initializeDays(request.dateWindow)
  const selected = []
  const ranked = rankCandidatesForStrategy(candidates, strategy)

  for (const candidate of ranked) {
    const placements = findFeasiblePlacements(candidate, days, request)
    const bestPlacement = chooseBestPlacement(candidate, placements, strategy)

    if (bestPlacement) {
      applyPlacement(days, candidate, bestPlacement)
      selected.push(candidate)
    }
  }

  const repaired = repairItinerary(days, request, strategy)
  const scored = scoreItinerary(repaired, request, strategy)

  return {
    id: createId(),
    days: repaired,
    totalCost: calculateTotalCost(repaired),
    totalScore: scored.total,
    tradeoffs: scored.tradeoffs,
    warnings: collectWarnings(repaired),
    sourceAttributions: collectSources(repaired)
  }
}
```

### Repair Operations

- Move activity to another day.
- Insert buffer.
- Remove low-score item.
- Replace with geographically closer item.
- Swap order within day.
- Move hotel base recommendation.
- Split overpacked day.
- Add free time.
- Add manual verification warning.

### Hard Failure Conditions

- Total schedule exceeds waking hours after buffers.
- User hard must-have is missing and no explanation exists.
- Budget exceeds hard budget and user did not allow overage.
- Transport connection impossible.
- Provider handoff unavailable for a required booking.
- Required accessibility constraint is not satisfied.

### Multi-Round Planning Loop

V1 must not stop after the first valid itinerary. Run a bounded multi-round loop:

1. Research candidates.
2. Draft 2-5 itinerary variants.
3. Critique each variant for budget, routing, weather, source confidence, and provider-policy risk.
4. Repair the worst issues.
5. Re-score variants.
6. Explain the final winners and the rejected credible alternatives.

```ts
function planWithCritique(request: TripRequest, candidates: ScoredCandidate[]): ItineraryVariant[] {
  let variants = generateInitialVariants(request, candidates)

  for (let round = 0; round < 3; round += 1) {
    const critiques = variants.map(variant => critiqueVariant(variant, request))
    if (critiques.every(critique => critique.blockingIssues.length === 0)) break

    variants = variants.map((variant, index) =>
      repairFromCritique(variant, critiques[index], request)
    )
    variants = variants.map(variant => scoreItinerary(variant, request))
  }

  return rankItineraryVariants(variants)
}
```

## Step 12: Budget Allocation

### Category Allocation

Default budget categories:

- transport
- lodging
- activities
- food
- local_transit
- fees
- emergency_buffer

### Algorithm

1. Reserve emergency buffer first.
2. Estimate required transport and lodging.
3. Allocate remaining budget to activities, food, and local transit.
4. If total exceeds budget, run downgrade search:
   - alternate lodging area
   - fewer paid activities
   - transit instead of rideshare
   - cheaper date/time
   - remove low-value item
5. Explain tradeoffs.

```ts
function optimizeBudget(itinerary: ItineraryVariant, budget: BudgetEnvelope): BudgetResult {
  const spend = calculateSpendByCategory(itinerary)
  const overages = findOverages(spend, budget)

  if (overages.length === 0) {
    return { status: 'within_budget', spend, recommendations: [] }
  }

  const substitutions = findBudgetSubstitutions(itinerary, overages)
  const revised = applyBestSubstitutions(itinerary, substitutions)

  return {
    status: isWithinBudget(revised, budget) ? 'within_budget_after_changes' : 'over_budget',
    spend: calculateSpendByCategory(revised),
    recommendations: substitutions,
    revisedItinerary: revised
  }
}
```

## Step 13: Explanation Generation

Every itinerary and candidate must include an explanation.

### Candidate Explanation Must Include

- Why it fits the user's preferences.
- Main score drivers.
- Provider/source list.
- Price freshness.
- Rating confidence.
- Logistics impact.
- Risk warnings.
- What to verify before booking.

### Itinerary Explanation Must Include

- Overall strategy.
- Main tradeoffs.
- Budget fit.
- Why the day order makes sense.
- Why rejected alternatives lost.
- Stale or manual verification warnings.

### Guardrails

- Do not invent source facts.
- Do not claim a provider has availability unless the source says so.
- Do not state legal, visa, safety, or medical conclusions as certainty.
- Use "verify" language for dynamic prices, policies, and provider availability.

## Step 14: Handoff Link Generation

### Inputs

- Selected candidate.
- Provider policy.
- User locale/currency.
- Trip dates and traveler count.

### Algorithm

1. Check provider access mode.
2. Build official URL or deep link.
3. Do not attach affiliate parameters in v1.
4. Add disclosure.
5. Add freshness warning.
6. Add verification checklist.
7. Persist handoff.
8. Return link to UI.

```ts
function createHandoff(candidate: ScoredCandidate, context: HandoffContext): HandoffLink {
  const decision = evaluatePolicy({
    provider: context.provider,
    operation: 'create_handoff',
    dataFields: ['url', 'dates', 'traveler_count'],
    storageIntent: 'handoff_tracking',
    displayIntent: 'external_link',
    userConsent: context.userConsent
  })

  if (!decision.allowed) {
    throw new PolicyError(decision.reason)
  }

  const url = buildProviderUrl(candidate, context)

  return {
    id: createId(),
    providerId: candidate.providerId,
    url,
    disclosure: buildDisclosure(context),
    freshness: candidate.freshness,
    checklist: buildVerificationChecklist(candidate),
    expiresAt: calculateExpiry(candidate)
  }
}
```

## Step 15: Browser Agent Rules

The browser agent is a controlled local assistant powered by `swiftbrowse`, not an unrestricted bot. It runs on the user's computer, headless by default and hybrid/headed when visibility is needed.

### Allowed Actions In V1

- Pair with a local companion using a short-lived token.
- Open provider pages and tabs.
- Navigate/search/read allowed provider pages.
- Use `snapshot`, `text`, `links`, `extract`, and `table` to gather allowed source facts.
- Extract page title, URL, exact observed prices, ratings, review counts, cancellation snippets where allowed, and source links.
- Monitor prices later if the user explicitly asks.
- Take screenshots only when needed for debugging or OCR and only if allowed by the user's settings.

### Blocked Actions In V1

- Filling forms.
- Completing payment.
- Clicking final booking confirmation.
- Clicking cancel/refund/accept terms/submit reservation actions.
- Solving CAPTCHA.
- Creating accounts.
- Logging in with stored credentials.
- Exporting or storing provider cookies.
- Storing passports, dates of birth, government IDs, loyalty IDs, or payment data.
- Circumventing bot controls.
- Downloading bulk content.
- Republishing protected review text.
- Ignoring provider rate limits.
- Saving replay traces by default.

### Browser Agent State Machine

```text
created
  -> pair_local_swiftbrowse_companion
  -> policy_check
  -> awaiting_user_approval
  -> launch_local_headless_or_hybrid_context
  -> navigate_allowed_url
  -> observe_with_snapshot_text_links_extract_table
  -> stop_before_login_form_fill_or_irreversible_action
  -> persist_minimal_source_summary
  -> close_or_keep_for_user_requested_monitoring
```

## Step 16: Monitoring And Staleness

### Staleness Rules

- Live prices become stale after provider-specific TTL.
- Cached API results become stale after provider-specific TTL.
- Manual links are always `manual_verify`.
- Weather forecasts are reliable only within provider forecast window.
- Availability for activities/hotels/transport must be rechecked before handoff.

### Monitoring Jobs

- Price drop, only if user asks.
- Price increase, only if user asks.
- Availability change, only if user asks.
- Cancellation deadline, only if user asks or imported from a booking.
- Check-in/check-out reminder, only if user asks or imported from a booking.
- Schedule conflict after user marks booking.
- Provider policy change requiring integration review.

## Step 17: Failure Modes And Recovery

| Failure | Recovery |
|---|---|
| Provider API unavailable | Use cache if fresh; otherwise manual handoff. |
| Provider returns 429 | Back off, reduce concurrency, show partial results. |
| Price changed | Mark stale, re-optimize budget, show provider verification link, and require manual verification before treating the price as current. |
| Candidate no longer available | Replace from same cluster/category. |
| Itinerary over budget | Run budget downgrade algorithm. |
| Day overpacked | Remove lowest marginal value item or split day. |
| Route impossible | Reorder, add buffer, or replace item. |
| Local companion offline | Fall back to provider links and tell the user local browser research is unavailable. |
| Browser blocked | Stop automation and open manual link only. |
| OCR extraction low confidence | Require user correction before using the booking as a hard constraint. |
| LLM uncertain | Ask user or run deterministic fallback. |
| Terms not reviewed | Disable production integration. |

## Step 18: Evaluation Harness

### Fixture Trips

Create deterministic fixtures:

- 3-day New York budget trip.
- 5-day Paris family trip.
- 7-day Japan rail-heavy trip.
- 4-day London museum/theater trip.
- Global mixed-provider trip using Tripadvisor, Klook, GetYourGuide, Expedia, and Agoda fixtures.
- Multi-city Europe flight plus rail trip.
- Accessibility-constrained city trip.
- Imported-booking OCR trip with a hotel PDF and flight screenshot.
- Last-minute weekend trip.

### Eval Metrics

- Feasibility: no impossible time windows.
- Budget accuracy: projected total within allowed range.
- Source coverage: every item has attribution.
- Freshness accuracy: stale/manual items labeled correctly.
- Route sanity: no excessive backtracking unless explained.
- Diversity: not repetitive unless requested.
- Preference fit: must-haves included or explained.
- Compliance: no disallowed provider action.
- Browser safety: no form fill, no booking click, no cookie export.
- OCR accuracy: low-confidence booking fields are not silently accepted.
- Explanation faithfulness: no unsupported claims.

### Regression Tests

For every fixture, assert:

- Itinerary has at least one valid variant.
- Required day count matches trip dates.
- Every scheduled item has a start/end or reason for flexibility.
- Total cost range is computed.
- Every bookable item has handoff or manual verification status.
- Every provider output has source attribution.
- No blocked provider operation occurs.
- Browser-sourced exact prices include provider, URL, currency, and observed timestamp.
- OCR-imported bookings become locked constraints only after confidence or user correction.

## Step 19: Ranking Itinerary Variants

Final itinerary score:

```text
itinerary_score =
  0.22 * average_candidate_score +
  0.18 * budget_fit_score +
  0.16 * logistics_score +
  0.14 * risk_score +
  0.12 * preference_coverage_score +
  0.08 * source_confidence_score +
  0.05 * diversity_score +
  0.05 * handoff_readiness_score
```

Penalties:

- Over budget without approval.
- Missing must-have.
- Stale required price.
- Unlicensed source dependency.
- Impossible route.
- Insufficient transfer buffer.
- Too many manual-only items.
- Weak review confidence for key recommendation.

## Step 20: Implementation Order

Build algorithms in this exact order:

1. Type schemas and validation.
2. Provider policy guard.
3. OCR import extraction with fixtures.
4. Mock provider adapters.
5. Local `swiftbrowse` companion adapter with mocked command execution.
6. Candidate normalization.
7. Entity resolution.
8. Rating and cost scoring.
9. Route matrix abstraction.
10. Greedy itinerary builder.
11. Repair operations.
12. Budget optimizer.
13. Explanation generator.
14. Handoff generation.
15. Agent job state machine.
16. Browser-agent policy enforcement.
17. Price monitoring jobs.
18. Live provider adapters and local-browser provider workflows.

Do not implement unguarded live provider adapters. Browser-source provider workflows can be implemented immediately after mock adapters, local companion pairing, URL policy, command policy, source transparency, and retention guards have tests.

## Acceptance Criteria For Algorithm Package

- All exported functions are deterministic for the same inputs.
- No algorithm requires live provider calls in unit tests.
- Candidate scores include component breakdowns.
- Itinerary scores include penalties and tradeoffs.
- Every item can be traced back to source attributions.
- Every provider action has a policy decision.
- Optimizer can produce alternatives, not just one answer.
- Overpacked and over-budget plans are repaired or rejected.
- Browser automation is impossible without local companion pairing, provider-policy approval, and user approval where required.
- Browser automation cannot fill forms, click bookings/payments/confirmations/cancellations, export cookies, or store credentials in v1.
- Exact prices are exact observed source prices with timestamp, never model guesses.
- OCR imports redact sensitive fields and require user correction when confidence is low.
- The system can explain "why this" and "why not that" from stored score components.
