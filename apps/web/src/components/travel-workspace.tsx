'use client'

import dynamic from 'next/dynamic'
import {
  Activity,
  BarChart3,
  BellRing,
  Briefcase,
  CalendarDays,
  CircleDollarSign,
  FileText,
  Info,
  ListChecks,
  Map,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Upload
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

const MapExplorer = dynamic(() => import('./workspace-map').then((module) => module.WorkspaceMap), {
  ssr: false,
  loading: () => <div className="map-empty">Map is loading.</div>
})

type TabId = 'timeline' | 'inspect' | 'compare' | 'budget' | 'monitors' | 'sources' | 'imports' | 'jobs' | 'admin' | 'settings'

interface Trip {
  id: string
  destination: string
  destinationResolution?: {
    status: 'resolved' | 'unresolved'
    center: { lat: number; lng: number }
    confidence: number
    source: string
    attribution: string
    observedAt: string
    warning?: string
  }
  startDate: string
  endDate: string
  travelerCount: number
  currency: string
  budgetTotal: number
  priorities: string[]
  pace: 'relaxed' | 'balanced' | 'packed'
  interests: string[]
  status: string
}

interface Candidate {
  providerId: string
  providerOfferId: string
  type: string
  title: string
  bookingUrl: string
  freshness: string
  observedAt: string
  price?: { amount: number; currency: string; observedAt: string; sourceUrl: string; exact: boolean }
  scores: { total: number; rating: number; price: number; logistics: number; risk: number }
  warnings: string[]
  explanation: string
  sourceAttributions: Array<{ providerId: string; url: string; observedAt: string; extractionMethod: string; confidence: number }>
}

interface SourceAttribution {
  providerId: string
  url: string
  observedAt: string
  extractionMethod: string
  confidence: number
}

interface Variant {
  id: string
  strategy: string
  totalScore: number
  totalCost: { min: number; max: number; currency: string; unknownCount: number }
  days: Array<{
    date: string
    items: Array<{
      candidateId: string
      title: string
      startTime?: string
      endTime?: string
      locked: boolean
      travelBufferMinutes: number
      weatherRisk: {
        level: 'low' | 'moderate' | 'high'
        summary: string
        precipitationProbability: number
        temperatureC: number
      }
      sourceAttributions: SourceAttribution[]
    }>
  }>
  sourceAttributions: SourceAttribution[]
  winnerExplanation: string
  loserExplanations: string[]
  warnings: string[]
}

interface Job {
  id: string
  tripId: string
  kind: string
  phase: string
  status: string
  progress: number
  costUsd: number
  events: Array<{ type: string; at: string }>
}

interface ImportSummary {
  id: string
  result: { confidence: number; needsUserCorrection: boolean; extractedBookings: Array<{ title: string }> }
  fileMetadata?: { fileName: string; mimeType: string; sizeBytes: number; sourceType: string; warnings: string[] }
}

interface BrowserObservation {
  id: string
  providerId: string
  url: string
  title: string
  status: 'observed' | 'failed'
  observedAt: string
  sourceSummary: string
  redacted: boolean
  truncated: boolean
  retention: 'metadata_only'
  reason?: string
}

interface PriceMonitor {
  id: string
  tripId: string
  candidateId: string
  providerId: string
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

type CandidateDetail = Candidate & {
  handoff: {
    id: string
    providerId: string
    url: string
    disclosure: string
    freshness: string
    checklist: string[]
    allowedActions: string[]
    expiresAt: string
  }
}

interface ReplacementSuggestion {
  candidateId: string
  title: string
  providerId: string
  type: string
  score: number
  sourceUrl: string
  reason: string
}

export function TravelWorkspace() {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [selectedTab, setSelectedTab] = useState<TabId>('timeline')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [paired, setPaired] = useState(false)
  const [imports, setImports] = useState<ImportSummary[]>([])
  const [browserObservations, setBrowserObservations] = useState<BrowserObservation[]>([])
  const [monitors, setMonitors] = useState<PriceMonitor[]>([])
  const [selectedCandidateDetail, setSelectedCandidateDetail] = useState<CandidateDetail | null>(null)
  const [replacementSuggestions, setReplacementSuggestions] = useState<ReplacementSuggestion[]>([])

  useEffect(() => {
    void apiFetch<Trip[]>('/api/trips')
      .then((trips) => setRecentTrips((current) => mergeRecentTrips(current, trips)))
      .catch(() => setRecentTrips((current) => current))
  }, [])

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const created = await apiFetch<Trip>('/api/trips', {
        method: 'POST',
        body: JSON.stringify({
          destination: form.get('destination'),
          startDate: form.get('startDate'),
          endDate: form.get('endDate'),
          travelerCount: Number(form.get('travelerCount') ?? 1),
          currency: form.get('currency') || 'USD',
          budgetTotal: Number(form.get('budgetTotal') ?? 1),
          pace: form.get('pace') || 'balanced',
          priorities: [form.get('priority') || 'value'],
          interests: String(form.get('interests') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        })
      })
      setTrip(created)
      setCandidates([])
      setVariants([])
      setImports([])
      setBrowserObservations([])
      setMonitors([])
      setSelectedCandidateDetail(null)
      setReplacementSuggestions([])
      setRecentTrips((current) => mergeRecentTrips([created], current))
      setMessage('Trip workspace created.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create trip.')
    } finally {
      setBusy(false)
    }
  }

  async function resumeTrip(nextTrip: Trip) {
    setBusy(true)
    setMessage('')
    try {
      const [nextCandidates, nextVariants, nextImports, nextBrowserObservations, nextMonitors] = await Promise.all([
        apiFetch<Candidate[]>(`/api/trips/${nextTrip.id}/candidates`),
        apiFetch<Variant[]>(`/api/trips/${nextTrip.id}/itinerary/solve`, { method: 'POST', body: JSON.stringify({}) }),
        apiFetch<ImportSummary[]>(`/api/trips/${nextTrip.id}/imports`),
        apiFetch<BrowserObservation[]>(`/api/trips/${nextTrip.id}/browser-observations`),
        apiFetch<PriceMonitor[]>(`/api/trips/${nextTrip.id}/monitors`)
      ])
      setTrip(nextTrip)
      setCandidates(nextCandidates)
      setVariants(nextVariants)
      setImports(nextImports)
      setBrowserObservations(nextBrowserObservations)
      setMonitors(nextMonitors)
      setSelectedCandidateDetail(null)
      setReplacementSuggestions([])
      setJob(null)
      setMessage(`Resumed ${nextTrip.destination}. Pair the companion again before new browser research.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to resume trip.')
    } finally {
      setBusy(false)
    }
  }

  async function pairCompanion() {
    setBusy(true)
    try {
      const result = await apiFetch<{ paired: boolean }>('/api/local-companion/pair', {
        method: 'POST',
        body: JSON.stringify({})
      })
      setPaired(result.paired)
      setMessage(result.paired ? 'Local companion paired.' : 'Pairing failed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pairing failed.')
    } finally {
      setBusy(false)
    }
  }

  async function startResearch() {
    if (!trip) return
    setBusy(true)
    setMessage('')
    try {
      const result = await apiFetch<{ job: Job; plan: unknown; candidates: Candidate[]; variants: Variant[]; browserObservations: BrowserObservation[] }>(
        `/api/trips/${trip.id}/research-runs`,
        {
        method: 'POST',
        body: JSON.stringify({})
        }
      )
      setJob(result.job)
      setCandidates(result.candidates)
      setVariants(result.variants)
      setBrowserObservations(result.browserObservations)
      setSelectedCandidateDetail(null)
      setReplacementSuggestions([])
      setMessage('Research run finished with local browser-source observations and policy-gated fallback candidates.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Research failed.')
    } finally {
      setBusy(false)
    }
  }

  async function controlJob(action: 'pause' | 'resume' | 'cancel') {
    if (!job) return
    const updated = await apiFetch<Job>(`/api/jobs/${job.id}/${action}`, { method: 'POST', body: JSON.stringify({}) })
    setJob(updated)
  }

  async function importText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trip) return
    setBusy(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const file = form.get('bookingFile')
      const bookingText = String(form.get('bookingText') ?? '').trim()
      const confidence = Number(form.get('confidence') ?? 0.9)
      const payload =
        file instanceof File && file.size > 0
          ? {
              file: {
                fileName: file.name,
                mimeType: file.type || mimeTypeFromName(file.name),
                sizeBytes: file.size,
                contentBase64: await fileToBase64(file),
                ...(bookingText ? { extractedText: bookingText } : {}),
                ocrConfidence: confidence
              }
            }
          : {
              text: bookingText,
              sourceType: 'manual',
              confidence
            }
      const result = await apiFetch<ImportSummary>(`/api/trips/${trip.id}/imports`, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      setImports((current) => [result, ...current])
      setMessage(result.result.needsUserCorrection ? 'Import needs manual correction.' : 'Import ready to lock.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  async function createPriceMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trip) return
    const form = new FormData(event.currentTarget)
    const monitor = await apiFetch<PriceMonitor>(`/api/trips/${trip.id}/monitors`, {
      method: 'POST',
      body: JSON.stringify({
        candidateId: form.get('candidateId'),
        cadence: form.get('cadence') || 'daily',
        stopDate: form.get('stopDate') || undefined,
        notifyOn: form.get('notifyOn') || 'price_change'
      })
    })
    setMonitors((current) => [monitor, ...current.filter((item) => item.id !== monitor.id)])
    setMessage('Price monitor active.')
  }

  async function stopPriceMonitor(id: string) {
    const stopped = await apiFetch<PriceMonitor>(`/api/monitors/${id}`, { method: 'DELETE' })
    setMonitors((current) => current.map((item) => (item.id === id ? stopped : item)))
    setMessage('Price monitor stopped.')
  }

  async function setItineraryLock(candidateId: string, locked: boolean) {
    if (!trip) return
    setBusy(true)
    setMessage('')
    try {
      const result = await apiFetch<{ variants: Variant[]; locked: boolean }>(`/api/itinerary-items/${candidateId}/lock`, {
        method: 'PATCH',
        body: JSON.stringify({ tripId: trip.id, locked })
      })
      setVariants(result.variants)
      setReplacementSuggestions([])
      setMessage(result.locked ? 'Itinerary item locked and reoptimized.' : 'Itinerary item unlocked and reoptimized.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update itinerary lock.')
    } finally {
      setBusy(false)
    }
  }

  async function removeItineraryItem(candidateId: string) {
    if (!trip) return
    setBusy(true)
    setMessage('')
    try {
      const result = await apiFetch<{ variants: Variant[]; replacements: ReplacementSuggestion[] }>(`/api/itinerary-items/${candidateId}/remove`, {
        method: 'POST',
        body: JSON.stringify({ tripId: trip.id })
      })
      setVariants(result.variants)
      setReplacementSuggestions(result.replacements)
      setMessage('Itinerary item removed and reoptimized.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to remove itinerary item.')
    } finally {
      setBusy(false)
    }
  }

  async function inspectCandidate(candidateId: string) {
    setBusy(true)
    setMessage('')
    try {
      const detail = await apiFetch<CandidateDetail>(`/api/candidates/${candidateId}`)
      setSelectedCandidateDetail(detail)
      setMessage('Candidate inspector loaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load candidate inspector.')
    } finally {
      setBusy(false)
    }
  }

  async function clearLocalWorkspace() {
    setBusy(true)
    setMessage('')
    try {
      await apiFetch('/api/privacy/local-state', { method: 'DELETE' })
      setTrip(null)
      setRecentTrips([])
      setCandidates([])
      setVariants([])
      setJob(null)
      setImports([])
      setBrowserObservations([])
      setMonitors([])
      setSelectedCandidateDetail(null)
      setReplacementSuggestions([])
      setPaired(false)
      setSelectedTab('timeline')
      setMessage('Local TravelWizard state cleared.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clear local state.')
    } finally {
      setBusy(false)
    }
  }

  const selectedVariant = variants[0]
  const exactTotal = useMemo(() => candidates.reduce((sum, candidate) => sum + (candidate.price?.amount ?? 0), 0), [candidates])
  const unknownPriceCount = useMemo(() => candidates.filter((candidate) => !candidate.price).length, [candidates])

  return (
    <main className="app-shell">
      <aside className="panel" aria-label="Trip setup and controls">
        <section className="section">
          <h1>TravelWizard</h1>
          <span className={paired ? 'status status-good' : 'status status-warn'}>
            <ShieldCheck size={15} aria-hidden="true" />
            {paired ? 'Companion paired' : 'Companion unpaired'}
          </span>
        </section>

        <section className="section">
          <h2>Destination Setup</h2>
          <form onSubmit={createTrip}>
            <label className="field">
              <span className="label">Destination</span>
              <input className="input" name="destination" placeholder="Lisbon, Portugal" required />
            </label>
            <div className="metric-grid">
              <label className="field">
                <span className="label">Start</span>
                <input className="input" name="startDate" type="date" required />
              </label>
              <label className="field">
                <span className="label">End</span>
                <input className="input" name="endDate" type="date" required />
              </label>
            </div>
            <div className="metric-grid">
              <label className="field">
                <span className="label">Travelers</span>
                <input className="input" name="travelerCount" type="number" min="1" defaultValue="1" required />
              </label>
              <label className="field">
                <span className="label">Budget</span>
                <input className="input" name="budgetTotal" type="number" min="1" defaultValue="1200" required />
              </label>
            </div>
            <div className="metric-grid">
              <label className="field">
                <span className="label">Currency</span>
                <input className="input" name="currency" defaultValue="USD" maxLength={3} required />
              </label>
              <label className="field">
                <span className="label">Priority</span>
                <select className="select" name="priority" defaultValue="value">
                  <option value="value">Best value</option>
                  <option value="budget">Cost first</option>
                  <option value="rating">Rating</option>
                  <option value="comfort">Comfort</option>
                  <option value="speed">Speed</option>
                  <option value="low_risk">Low risk</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span className="label">Pace</span>
              <select className="select" name="pace" defaultValue="balanced">
                <option value="relaxed">Relaxed</option>
                <option value="balanced">Balanced</option>
                <option value="packed">Packed</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Interests</span>
              <input className="input" name="interests" placeholder="history, food, architecture" />
            </label>
            <div className="button-row">
              <button className="btn btn-primary" disabled={busy} type="submit">
                <Briefcase size={16} aria-hidden="true" />
                Create
              </button>
              <button className="btn" disabled={busy} type="button" onClick={pairCompanion}>
                <ShieldCheck size={16} aria-hidden="true" />
                Pair
              </button>
              <button className="btn" disabled={!trip || !paired || busy} type="button" onClick={startResearch}>
                <Search size={16} aria-hidden="true" />
                Research
              </button>
            </div>
          </form>
          <p className="meta" role="status" aria-live="polite">
            {message || 'Empty workflow ready.'}
          </p>
          {trip?.destinationResolution && (
            <p className="meta">
              Map source {trip.destinationResolution.source}; confidence {Math.round(trip.destinationResolution.confidence * 100)}%; observed {trip.destinationResolution.observedAt}.
            </p>
          )}
        </section>

        {recentTrips.length > 0 && (
          <section className="section">
            <h2>Recent Trips</h2>
            <div className="list">
              {recentTrips.map((recentTrip) => (
                <div className="item-card compact" key={recentTrip.id}>
                  <h3>{recentTrip.destination}</h3>
                  <p className="meta">
                    {recentTrip.startDate} to {recentTrip.endDate} · {recentTrip.currency} {recentTrip.budgetTotal}
                  </p>
                  <button className="btn" disabled={busy} type="button" onClick={() => void resumeTrip(recentTrip)}>
                    <RotateCcw size={15} aria-hidden="true" />
                    Resume
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <h2>Agent Job Console</h2>
          {job ? (
            <div className="list">
              <div className="item-card">
                <h3>{job.kind} job</h3>
                <p className="meta">
                  {job.status} - {job.phase} - {job.progress}% - ${job.costUsd.toFixed(4)}
                </p>
                <div className="button-row">
                  <button className="btn" type="button" onClick={() => controlJob('pause')}>
                    <Pause size={15} aria-hidden="true" />
                    Pause
                  </button>
                  <button className="btn" type="button" onClick={() => controlJob('resume')}>
                    <Play size={15} aria-hidden="true" />
                    Resume
                  </button>
                  <button className="btn btn-danger" type="button" onClick={() => controlJob('cancel')}>
                    <Square size={15} aria-hidden="true" />
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="meta">No long-running job has started.</p>
          )}
        </section>
      </aside>

      <section className="map-stage" aria-label="Map Explorer">
        <MapExplorer trip={trip} candidates={candidates} />
        {candidates.length === 0 && (
          <div className="map-empty">
            <strong>Map Explorer</strong>
            <p className="meta">Create a trip, pair the local companion, then run research. No demo trip is seeded.</p>
          </div>
        )}
      </section>

      <aside className="panel panel-right" aria-label="Planner details">
        <section className="section">
          <div className="tabs" role="tablist" aria-label="Workspace sections">
            {([
              ['timeline', CalendarDays, 'Timeline'],
              ['inspect', Info, 'Inspect'],
              ['compare', ListChecks, 'Compare'],
              ['budget', CircleDollarSign, 'Budget'],
              ['monitors', BellRing, 'Monitors'],
              ['sources', FileText, 'Sources'],
              ['imports', Upload, 'Imports'],
              ['jobs', Activity, 'Jobs'],
              ['admin', BarChart3, 'Admin'],
              ['settings', Settings, 'Settings']
            ] as Array<[TabId, LucideIcon, string]>).map(([id, Icon, label]) => (
              <button
                key={String(id)}
                aria-selected={selectedTab === id}
                className="tab"
                role="tab"
                type="button"
                onClick={() => setSelectedTab(id as TabId)}
              >
                <Icon size={14} aria-hidden="true" />
                {String(label)}
              </button>
            ))}
          </div>
        </section>

        {selectedTab === 'timeline' && (
          <TimelinePanel
            {...(selectedVariant ? { variant: selectedVariant } : {})}
            busy={busy}
            replacementSuggestions={replacementSuggestions}
            onLock={setItineraryLock}
            onRemove={removeItineraryItem}
          />
        )}
        {selectedTab === 'inspect' && <CandidateInspectorPanel candidates={candidates} detail={selectedCandidateDetail} busy={busy} onInspect={inspectCandidate} />}
        {selectedTab === 'compare' && <ComparePanel variants={variants} />}
        {selectedTab === 'budget' && <BudgetPanel exactTotal={exactTotal} unknownPriceCount={unknownPriceCount} currency={trip?.currency ?? 'USD'} candidates={candidates} />}
        {selectedTab === 'monitors' && <PriceMonitorPanel trip={trip} candidates={candidates} monitors={monitors} onCreate={createPriceMonitor} onStop={stopPriceMonitor} />}
        {selectedTab === 'sources' && <SourcesPanel candidates={candidates} variants={variants} browserObservations={browserObservations} />}
        {selectedTab === 'imports' && <ImportsPanel onImport={importText} imports={imports} disabled={!trip} />}
        {selectedTab === 'jobs' && <JobPanel job={job} />}
        {selectedTab === 'admin' && <AdminPanel />}
        {selectedTab === 'settings' && <SettingsPanel paired={paired} busy={busy} onClear={clearLocalWorkspace} />}
      </aside>
    </main>
  )
}

function mergeRecentTrips(primary: Trip[], secondary: Trip[]) {
  const seen = new Set<string>()
  return [...primary, ...secondary]
    .filter((item) => {
      if (seen.has(item.id)) {
        return false
      }
      seen.add(item.id)
      return true
    })
    .slice(0, 8)
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function mimeTypeFromName(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.eml')) return 'message/rfc822'
  if (lower.endsWith('.ics')) return 'text/calendar'
  return 'text/plain'
}

function TimelinePanel({
  variant,
  busy,
  replacementSuggestions,
  onLock,
  onRemove
}: {
  variant?: Variant
  busy: boolean
  replacementSuggestions: ReplacementSuggestion[]
  onLock: (candidateId: string, locked: boolean) => void
  onRemove: (candidateId: string) => void
}) {
  return (
    <section className="section">
      <h2>Timeline Planner</h2>
      {variant ? (
        <div className="list">
          <p className="meta">{variant.winnerExplanation}</p>
          {variant.days.map((day) => (
            <div className="item-card" key={day.date}>
              <h3>{day.date}</h3>
              {day.items.length === 0 ? (
                <p className="meta">Open time for rest, weather changes, or manual additions.</p>
              ) : (
                day.items.map((item) => {
                  const weatherRisk = item.weatherRisk ?? {
                    level: 'low',
                    summary: 'Weather context unavailable for this retained item.'
                  }
                  return (
                    <div className="timeline-row" key={`${day.date}-${item.title}`}>
                      <p className="meta">
                        {item.startTime} - {item.endTime}: {item.title}
                      </p>
                      <p className="meta">
                        Buffer {item.travelBufferMinutes ?? 0} min - Weather {weatherRisk.level}: {weatherRisk.summary}
                      </p>
                      <div className="button-row">
                        <button className="btn" disabled={busy} type="button" onClick={() => onLock(item.candidateId, !item.locked)}>
                          {item.locked ? 'Unlock item' : 'Lock item'}
                        </button>
                        <button className="btn btn-danger" disabled={busy} type="button" onClick={() => onRemove(item.candidateId)}>
                          <Trash2 size={15} aria-hidden="true" />
                          Remove item
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ))}
          {replacementSuggestions.length > 0 && (
            <div className="item-card">
              <h3>Replacement Suggestions</h3>
              {replacementSuggestions.map((replacement) => (
                <div className="timeline-row" key={replacement.candidateId}>
                  <p className="meta">
                    {replacement.title} - {replacement.providerId} - score {Math.round(replacement.score)}
                  </p>
                  <p className="meta">{replacement.reason}</p>
                  <a className="btn" href={replacement.sourceUrl} target="_blank" rel="noreferrer">
                    Open source
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="meta">No itinerary yet.</p>
      )}
    </section>
  )
}

function CandidateInspectorPanel({
  candidates,
  detail,
  busy,
  onInspect
}: {
  candidates: Candidate[]
  detail: CandidateDetail | null
  busy: boolean
  onInspect: (candidateId: string) => void
}) {
  return (
    <section className="section">
      <h2>Candidate Inspector</h2>
      {candidates.length === 0 ? (
        <p className="meta">Run research first to inspect source-backed candidates.</p>
      ) : (
        <div className="list">
          {candidates.map((candidate) => (
            <div className="item-card compact" key={candidate.providerOfferId}>
              <h3>{candidate.title}</h3>
              <p className="meta">
                {candidate.providerId} - score {candidate.scores.total} - {candidate.price ? `${candidate.price.currency} ${candidate.price.amount}` : 'Manual price verification'}
              </p>
              <button className="btn" disabled={busy} type="button" onClick={() => onInspect(candidate.providerOfferId)}>
                <Info size={15} aria-hidden="true" />
                Inspect
              </button>
            </div>
          ))}
        </div>
      )}
      {detail && (
        <div className="list" style={{ marginTop: 12 }}>
          <div className="item-card">
            <h3>{detail.title}</h3>
            <p className="meta">{detail.explanation}</p>
            <div className="score-grid">
              {Object.entries(detail.scores)
                .filter(([key]) => key !== 'total')
                .map(([key, value]) => (
                  <span className="status" key={key}>
                    {key} {Math.round(Number(value))}
                  </span>
                ))}
            </div>
          </div>
          <div className="item-card">
            <h3>Price Snapshot</h3>
            <p className="meta">
              {detail.price
                ? `${detail.price.currency} ${detail.price.amount} exact observed price from ${detail.price.observedAt}.`
                : 'Exact current price unavailable; manual source verification required.'}
            </p>
            {detail.warnings.map((warning) => (
              <p className="meta" key={warning}>
                {warning}
              </p>
            ))}
          </div>
          <div className="item-card">
            <h3>Manual Handoff</h3>
            <p className="meta">{detail.handoff.disclosure}</p>
            {detail.handoff.checklist.map((item) => (
              <p className="meta" key={item}>
                {item}
              </p>
            ))}
            <p className="meta">Allowed actions: {detail.handoff.allowedActions.join(', ')}</p>
            <a className="btn" href={detail.handoff.url} target="_blank" rel="noreferrer">
              Open provider source
            </a>
          </div>
          <div className="item-card">
            <h3>Source Evidence</h3>
            {detail.sourceAttributions.map((source) => (
              <p className="meta" key={`${source.providerId}-${source.url}`}>
                {source.providerId} - {source.extractionMethod} - confidence {Math.round(source.confidence * 100)}% - {source.observedAt}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ComparePanel({ variants }: { variants: Variant[] }) {
  return (
    <section className="section">
      <h2>Compare Variants</h2>
      <div className="list">
        {variants.length === 0 ? (
          <p className="meta">No variants yet.</p>
        ) : (
          variants.map((variant) => (
            <div className="item-card" key={variant.id}>
              <h3>{variant.strategy.replace('_', ' ')}</h3>
              <p className="meta">
                Score {variant.totalScore} - {variant.totalCost.currency} {variant.totalCost.min}
              </p>
              {variant.loserExplanations.slice(0, 2).map((reason) => (
                <p className="meta" key={reason}>
                  {reason}
                </p>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function BudgetPanel({
  exactTotal,
  unknownPriceCount,
  currency,
  candidates
}: {
  exactTotal: number
  unknownPriceCount: number
  currency: string
  candidates: Candidate[]
}) {
  return (
    <section className="section">
      <h2>Budget Board</h2>
      <div className="metric-grid">
        <div className="metric">
          <span className="meta">Exact observed</span>
          <strong>
            {currency} {exactTotal}
          </strong>
        </div>
        <div className="metric">
          <span className="meta">Unknown prices</span>
          <strong>{unknownPriceCount}</strong>
        </div>
      </div>
      <div className="list">
        {candidates.map((candidate) => (
          <div className="item-card" key={candidate.providerOfferId}>
            <h3>{candidate.title}</h3>
            <p className="meta">
              {candidate.price ? `${candidate.price.currency} ${candidate.price.amount} observed ${candidate.price.observedAt}` : 'Manual verification required'}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function PriceMonitorPanel({
  trip,
  candidates,
  monitors,
  onCreate,
  onStop
}: {
  trip: Trip | null
  candidates: Candidate[]
  monitors: PriceMonitor[]
  onCreate: (event: FormEvent<HTMLFormElement>) => void
  onStop: (id: string) => void
}) {
  return (
    <section className="section">
      <h2>Price Monitor Center</h2>
      {!trip ? (
        <p className="meta">Create a trip before enabling user-requested price monitors.</p>
      ) : candidates.length === 0 ? (
        <p className="meta">Run research first so monitors can attach to source-backed candidates.</p>
      ) : (
        <form onSubmit={onCreate}>
          <label className="field">
            <span className="label">Candidate</span>
            <select className="select" name="candidateId" defaultValue={candidates[0]?.providerOfferId} required>
              {candidates.map((candidate) => (
                <option key={candidate.providerOfferId} value={candidate.providerOfferId}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </label>
          <div className="metric-grid">
            <label className="field">
              <span className="label">Cadence</span>
              <select className="select" name="cadence" defaultValue="daily">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Notify on</span>
              <select className="select" name="notifyOn" defaultValue="price_change">
                <option value="price_change">Any price change</option>
                <option value="price_drop">Price drop</option>
                <option value="manual_review">Manual review</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label">Stop date</span>
            <input className="input" name="stopDate" type="date" />
          </label>
          <button className="btn btn-primary" type="submit">
            <BellRing size={16} aria-hidden="true" />
            Start monitor
          </button>
        </form>
      )}
      <div className="list" style={{ marginTop: 12 }}>
        {monitors.length === 0 ? (
          <p className="meta">No explicit price monitors are active for this trip.</p>
        ) : (
          monitors.map((monitor) => (
            <div className="item-card" key={monitor.id}>
              <h3>{monitor.title}</h3>
              <p className="meta">
                {monitor.active ? 'Active' : 'Stopped'} - {monitor.cadence} - {monitor.notifyOn.replace('_', ' ')}
                {monitor.stopDate ? ` - stops ${monitor.stopDate}` : ''}
              </p>
              <p className="meta">{monitor.lastResult.message}</p>
              <p className="meta">
                Source checked {monitor.lastResult.checkedAt} - {monitor.lastResult.freshness}
              </p>
              <div className="button-row">
                <a className="btn" href={monitor.lastResult.sourceUrl} target="_blank" rel="noreferrer">
                  Open source
                </a>
                <button className="btn btn-danger" disabled={!monitor.active} type="button" onClick={() => onStop(monitor.id)}>
                  <Square size={15} aria-hidden="true" />
                  Stop monitor
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function SourcesPanel({ candidates, variants, browserObservations }: { candidates: Candidate[]; variants: Variant[]; browserObservations: BrowserObservation[] }) {
  const planningSources = uniqueSources(variants.flatMap((variant) => variant.sourceAttributions ?? [])).filter(
    (source) => source.providerId === 'openmeteo' || source.providerId === 'openstreetmap'
  )

  return (
    <section className="section">
      <h2>Source Drawer</h2>
      <div className="list">
        {browserObservations.map((observation) => (
          <div className="item-card" key={observation.id}>
            <h3>{observation.providerId}</h3>
            <p className="meta">{observation.title}</p>
            <p className="meta">
              {observation.status === 'observed' ? `local browser - ${observation.observedAt}` : `browser source failed - ${observation.reason ?? 'manual retry required'}`}
            </p>
            {observation.sourceSummary && <p className="meta">{observation.sourceSummary}</p>}
            <a href={observation.url} target="_blank" rel="noreferrer">
              Open source
            </a>
          </div>
        ))}
        {planningSources.map((source) => (
          <div className="item-card" key={`${source.providerId}-${source.url}-${source.observedAt}`}>
            <h3>{source.providerId}</h3>
            <p className="meta">
              Planning context - {source.extractionMethod} - confidence {Math.round(source.confidence * 100)}% - {source.observedAt}
            </p>
            <a href={source.url} target="_blank" rel="noreferrer">
              Open source
            </a>
          </div>
        ))}
        {candidates.length === 0 && browserObservations.length === 0 && planningSources.length === 0 ? (
          <p className="meta">No provider observations yet.</p>
        ) : (
          candidates.flatMap((candidate) =>
            candidate.sourceAttributions.map((source) => (
              <div className="item-card" key={`${candidate.providerOfferId}-${source.url}`}>
                <h3>{source.providerId}</h3>
                <p className="meta">{candidate.title}</p>
                <p className="meta">
                  {source.extractionMethod} - confidence {Math.round(source.confidence * 100)}% - {source.observedAt}
                </p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open source
                </a>
              </div>
            ))
          )
        )}
      </div>
    </section>
  )
}

function uniqueSources(sources: SourceAttribution[]): SourceAttribution[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.providerId}:${source.url}:${source.observedAt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function ImportsPanel({
  onImport,
  imports,
  disabled
}: {
  onImport: (event: FormEvent<HTMLFormElement>) => void
  imports: ImportSummary[]
  disabled: boolean
}) {
  return (
    <section className="section">
      <h2>Import Center</h2>
      <form onSubmit={onImport}>
        <label className="field">
          <span className="label">Booking file</span>
          <input className="input" name="bookingFile" type="file" accept=".txt,.text,.eml,.ics,.pdf,.png,.jpg,.jpeg,text/plain,message/rfc822,text/calendar,application/pdf,image/png,image/jpeg" />
        </label>
        <label className="field">
          <span className="label">OCR or booking text</span>
          <textarea className="textarea" name="bookingText" placeholder="Paste text from scanned PDFs/images when OCR is needed" />
        </label>
        <label className="field">
          <span className="label">OCR confidence</span>
          <input className="input" name="confidence" type="number" min="0" max="1" step="0.01" defaultValue="0.9" />
        </label>
        <button className="btn btn-primary" disabled={disabled} type="submit">
          <Upload size={16} aria-hidden="true" />
          Import
        </button>
      </form>
      <div className="list">
        {imports.map((item) => (
          <div className="item-card" key={item.id}>
            <h3>{item.result.extractedBookings[0]?.title ?? 'Imported booking'}</h3>
            <p className="meta">
              Confidence {Math.round(item.result.confidence * 100)}% - {item.result.needsUserCorrection ? 'Manual correction required' : 'Ready to lock'}
            </p>
            {item.fileMetadata && (
              <p className="meta">
                {item.fileMetadata.fileName} - {item.fileMetadata.sourceType} - {item.fileMetadata.sizeBytes} bytes
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function JobPanel({ job }: { job: Job | null }) {
  return (
    <section className="section">
      <h2>Job Events</h2>
      {job ? (
        <div className="list">
          {job.events.map((event) => (
            <div className="item-card" key={`${event.type}-${event.at}`}>
              <h3>{event.type}</h3>
              <p className="meta">{event.at}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="meta">No job events yet.</p>
      )}
    </section>
  )
}

function AdminPanel() {
  return (
    <section className="section">
      <h2>Provider Health Admin</h2>
      <AdminMetrics />
    </section>
  )
}

function AdminMetrics() {
  const [metrics, setMetrics] = useState<unknown>(null)

  async function load() {
    const [runtime, health, costs] = await Promise.all([apiFetch('/api/admin/runtime-health'), apiFetch('/api/admin/provider-health'), apiFetch('/api/admin/costs')])
    setMetrics({ runtime, health, costs })
  }

  return (
    <div className="list">
      <button className="btn" type="button" onClick={load}>
        <RotateCcw size={15} aria-hidden="true" />
        Refresh
      </button>
      <pre className="item-card">{metrics ? JSON.stringify(metrics, null, 2) : 'No admin snapshot loaded.'}</pre>
    </div>
  )
}

function SettingsPanel({ paired, busy, onClear }: { paired: boolean; busy: boolean; onClear: () => void }) {
  return (
    <section className="section">
      <h2>Settings</h2>
      <div className="list">
        <div className="item-card">
          <h3>Model config</h3>
          <p className="meta">Uses OpenAI-compatible .env variables on the local machine.</p>
        </div>
        <div className="item-card">
          <h3>Browser safety</h3>
          <p className="meta">{paired ? 'Local companion paired. Cookies and replay traces remain off by default.' : 'Pairing required before browser-source research.'}</p>
        </div>
        <div className="item-card">
          <h3>Retention</h3>
          <p className="meta">Provider observations retain metadata, source links, field confidence, and timestamps only.</p>
          <button className="btn btn-danger" disabled={busy} type="button" onClick={onClear}>
            <Square size={15} aria-hidden="true" />
            Clear local state
          </button>
        </div>
      </div>
    </section>
  )
}
