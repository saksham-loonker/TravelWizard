# TravelWizard Local Runbook

TravelWizard is a local, private, single-user app. The first runtime is a Next.js web app, Redis-backed worker, local browser companion, and Docker Compose services for Postgres/PostGIS plus Redis.

## Start

1. Copy `.env.example` to `.env`, replace `LOCAL_COMPANION_SECRET` with a random local-only value, and fill `OPENAI_API_KEY` only if model-backed planner calls are enabled.
2. Start services with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Run the app with `pnpm dev`.
5. In a second terminal, run `pnpm companion`.
6. In a third terminal, run `pnpm worker`.

The web app opens an empty workflow. Create a trip with your own destination; no demo trip is seeded.
User work is saved to `TRAVELWIZARD_STATE_FILE` (`storage/travelwizard-state.json` by default) so trips, research results, local browser-source observations, imports, monitors, and job state survive local server restarts. Local companion pairing is intentionally not persisted; pair again after restarting.
Destination map centers are resolved through deterministic local fixtures first, then the configured `GEOCODER_BASE_URL` when present. Public Nominatim use is for low-volume local development only; keep caching enabled and set an identifying `GEOCODER_USER_AGENT`.
Itinerary timing includes fixture-backed OSM route buffers and Open-Meteo weather risk by default; those source attributions are visible in the Source Drawer and can be replaced by live route/weather adapters later.
Use the Inspect tab after research to review a candidate's score components, exact price snapshot, source evidence, and manual provider handoff checklist. The handoff only opens provider source URLs for manual verification; TravelWizard does not submit bookings, payments, or traveler details.
Timeline items can be locked before reoptimization. Locks are stored in the local state file and the solver keeps locked candidates in every regenerated variant while marking them visibly in the timeline. Timeline items can also be removed; removal persists as a local exclusion, clears any previous lock on that candidate, re-solves the variants, and shows trip-scoped source-backed replacement suggestions with provider links.
Use Import Center to upload `.txt`, `.eml`, `.ics`, `.pdf`, `.png`, `.jpg`, or `.jpeg` booking artifacts. Text-like files are decoded locally; scanned PDFs/images require supplied OCR text in the form. The server validates MIME/extension/size, stores only parsed booking fields and file metadata/hash, redacts sensitive identifiers, and gates low-confidence OCR behind manual correction.
Use Settings -> Retention -> Clear local state to delete retained local trips, candidates, variants, imports, monitors, browser observations, destination cache entries, and job state from the configured state file.

## Safety Boundaries

- Browser-source jobs require local companion pairing, provider URL allowlists, action allowlists, provider policy approval, and retention controls.
- `type`, `fill`, `select`, `upload`, `drag`, cookie export, state save, eval, payment, booking, confirmation, cancellation, and credential actions are blocked in v1.
- Exact prices are shown only when a source URL, currency, and observed timestamp are present.
- The browser companion secret is server-side only; the web client never receives or posts it.
- Metadata-only browser responses retain source URL, timestamp, policy decision, and redacted short source summaries rather than raw page snapshots.
- Research uses the local companion for browser-source observation requests after pairing. By default these observation requests use the companion's dry-run metadata mode; set `TRAVELWIZARD_BROWSER_RUN_LIVE=true` only when you want the companion to launch swiftbrowse against allowed provider URLs.
- Mutating web API routes enforce same-origin checks, JSON-only request bodies, and a local burst rate limit before route handlers perform writes.
