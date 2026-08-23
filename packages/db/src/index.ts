import { relations } from 'drizzle-orm'
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  localOwnerLabel: text('local_owner_label').notNull().default('Local owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id),
  destinationLabel: text('destination_label').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  travelerCount: integer('traveler_count').notNull(),
  currency: text('currency').notNull(),
  budgetTotal: numeric('budget_total').notNull(),
  pace: text('pace').notNull(),
  priorities: jsonb('priorities').notNull().default([]),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const destinations = pgTable('destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  label: text('label').notNull(),
  country: text('country'),
  timezone: text('timezone'),
  center: text('center_wkt'),
  bbox: jsonb('bbox'),
  aliases: jsonb('aliases').notNull().default([]),
  confidence: numeric('confidence').notNull().default('0.75')
})

export const providerSources = pgTable('provider_sources', {
  id: text('id').primaryKey(),
  accessMode: text('access_mode').notNull(),
  policyStatus: text('policy_status').notNull().default('review_required'),
  credentialsConfigured: boolean('credentials_configured').notNull().default(false),
  allowedDomains: jsonb('allowed_domains').notNull().default([]),
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(6),
  healthScore: numeric('health_score').notNull().default('0.8')
})

export const searchRuns = pgTable('search_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  progress: integer('progress').notNull().default(0),
  costUsd: numeric('cost_usd').notNull().default('0'),
  pauseRequested: boolean('pause_requested').notNull().default(false),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  logs: jsonb('logs').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const sourceObservations = pgTable(
  'source_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id').references(() => trips.id),
    providerId: text('provider_id').notNull(),
    url: text('url').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    extractionMethod: text('extraction_method').notNull(),
    confidence: numeric('confidence').notNull(),
    fields: jsonb('fields').notNull().default({}),
    policyDecisionId: text('policy_decision_id').notNull(),
    provenanceHash: text('provenance_hash').notNull()
  },
  (table) => ({
    providerIndex: index('source_observations_provider_idx').on(table.providerId),
    tripIndex: index('source_observations_trip_idx').on(table.tripId)
  })
)

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  providerId: text('provider_id').notNull(),
  providerOfferId: text('provider_offer_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  bookingUrl: text('booking_url').notNull(),
  freshness: text('freshness').notNull(),
  scoreVector: jsonb('score_vector').notNull().default({}),
  explanation: text('explanation').notNull().default('')
})

export const itineraryVariants = pgTable('itinerary_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  strategy: text('strategy').notNull(),
  totalScore: numeric('total_score').notNull(),
  totalCost: jsonb('total_cost').notNull().default({}),
  tradeoffs: jsonb('tradeoffs').notNull().default([]),
  warnings: jsonb('warnings').notNull().default([]),
  winnerExplanation: text('winner_explanation').notNull()
})

export const itineraryItems = pgTable('itinerary_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').references(() => itineraryVariants.id),
  candidateId: uuid('candidate_id').references(() => candidates.id),
  startTime: timestamp('start_time', { withTimezone: true }),
  endTime: timestamp('end_time', { withTimezone: true }),
  locked: boolean('locked').notNull().default(false),
  sourceLinks: jsonb('source_links').notNull().default([])
})

export const priceSnapshots = pgTable('price_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').references(() => candidates.id),
  amount: numeric('amount').notNull(),
  currency: text('currency').notNull(),
  sourceUrl: text('source_url').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  freshness: text('freshness').notNull(),
  feesIncluded: boolean('fees_included')
})

export const reviewSignals = pgTable('review_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').references(() => candidates.id),
  normalizedRating: numeric('normalized_rating').notNull(),
  reviewCount: integer('review_count').notNull(),
  confidence: numeric('confidence').notNull(),
  sourceUrl: text('source_url').notNull()
})

export const bookingImports = pgTable('booking_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  sourceType: text('source_type').notNull(),
  confidence: numeric('confidence').notNull(),
  extractedBookings: jsonb('extracted_bookings').notNull().default([]),
  needsUserCorrection: boolean('needs_user_correction').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true })
})

export const browserSessions = pgTable('browser_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: text('provider_id').notNull(),
  allowedCommands: jsonb('allowed_commands').notNull().default([]),
  currentUrl: text('current_url'),
  paired: boolean('paired').notNull().default(false),
  retentionMode: text('retention_mode').notNull().default('metadata_only'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const priceMonitors = pgTable('price_monitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id),
  candidateId: uuid('candidate_id').references(() => candidates.id),
  cadence: text('cadence').notNull(),
  stopDate: text('stop_date'),
  active: boolean('active').notNull().default(true),
  lastResult: jsonb('last_result').notNull().default({})
})

export const adminMetrics = pgTable('admin_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  value: numeric('value').notNull(),
  dimensions: jsonb('dimensions').notNull().default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow()
})

export const tripRelations = relations(trips, ({ many }) => ({
  candidates: many(candidates),
  searchRuns: many(searchRuns),
  observations: many(sourceObservations)
}))

export const schema = {
  users,
  trips,
  destinations,
  providerSources,
  searchRuns,
  sourceObservations,
  candidates,
  itineraryVariants,
  itineraryItems,
  priceSnapshots,
  reviewSignals,
  bookingImports,
  browserSessions,
  priceMonitors,
  adminMetrics
}
