CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_owner_label text NOT NULL DEFAULT 'Local owner',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id),
  destination_label text NOT NULL,
  start_date text NOT NULL,
  end_date text NOT NULL,
  traveler_count integer NOT NULL,
  currency text NOT NULL,
  budget_total numeric NOT NULL,
  pace text NOT NULL,
  priorities jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  label text NOT NULL,
  country text,
  timezone text,
  center_wkt text,
  bbox jsonb,
  aliases jsonb NOT NULL DEFAULT '[]',
  confidence numeric NOT NULL DEFAULT 0.75
);

CREATE TABLE IF NOT EXISTS provider_sources (
  id text PRIMARY KEY,
  access_mode text NOT NULL,
  policy_status text NOT NULL DEFAULT 'review_required',
  credentials_configured boolean NOT NULL DEFAULT false,
  allowed_domains jsonb NOT NULL DEFAULT '[]',
  rate_limit_per_minute integer NOT NULL DEFAULT 6,
  health_score numeric NOT NULL DEFAULT 0.8
);

CREATE TABLE IF NOT EXISTS search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  status text NOT NULL,
  phase text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  pause_requested boolean NOT NULL DEFAULT false,
  cancel_requested boolean NOT NULL DEFAULT false,
  logs jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  provider_id text NOT NULL,
  url text NOT NULL,
  observed_at timestamptz NOT NULL,
  extraction_method text NOT NULL,
  confidence numeric NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}',
  policy_decision_id text NOT NULL,
  provenance_hash text NOT NULL
);

CREATE INDEX IF NOT EXISTS source_observations_provider_idx ON source_observations(provider_id);
CREATE INDEX IF NOT EXISTS source_observations_trip_idx ON source_observations(trip_id);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  provider_id text NOT NULL,
  provider_offer_id text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  booking_url text NOT NULL,
  freshness text NOT NULL,
  score_vector jsonb NOT NULL DEFAULT '{}',
  explanation text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS itinerary_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  strategy text NOT NULL,
  total_score numeric NOT NULL,
  total_cost jsonb NOT NULL DEFAULT '{}',
  tradeoffs jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  winner_explanation text NOT NULL
);

CREATE TABLE IF NOT EXISTS itinerary_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid REFERENCES itinerary_variants(id),
  candidate_id uuid REFERENCES candidates(id),
  start_time timestamptz,
  end_time timestamptz,
  locked boolean NOT NULL DEFAULT false,
  source_links jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id),
  amount numeric NOT NULL,
  currency text NOT NULL,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  freshness text NOT NULL,
  fees_included boolean
);

CREATE TABLE IF NOT EXISTS review_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id),
  normalized_rating numeric NOT NULL,
  review_count integer NOT NULL,
  confidence numeric NOT NULL,
  source_url text NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  source_type text NOT NULL,
  confidence numeric NOT NULL,
  extracted_bookings jsonb NOT NULL DEFAULT '[]',
  needs_user_correction boolean NOT NULL,
  accepted_at timestamptz
);

CREATE TABLE IF NOT EXISTS browser_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  allowed_commands jsonb NOT NULL DEFAULT '[]',
  current_url text,
  paired boolean NOT NULL DEFAULT false,
  retention_mode text NOT NULL DEFAULT 'metadata_only',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  candidate_id uuid REFERENCES candidates(id),
  cadence text NOT NULL,
  stop_date text,
  active boolean NOT NULL DEFAULT true,
  last_result jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS admin_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value numeric NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
