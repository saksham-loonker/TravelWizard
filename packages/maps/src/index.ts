export type GeocodeSource = 'fixture' | 'nominatim' | 'cache' | 'manual_fallback'
export type GeocodeStatus = 'resolved' | 'unresolved'

export interface MapPoint {
  lat: number
  lng: number
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface DestinationResolution {
  status: GeocodeStatus
  label: string
  query: string
  center: MapPoint
  bbox?: MapBounds
  confidence: number
  source: GeocodeSource
  sourceUrl?: string
  attribution: string
  observedAt: string
  cached: boolean
  warning?: string
}

export interface DestinationGeocoderClient {
  (input: { query: string; key: string; observedAt: string }): Promise<DestinationResolution | null>
}

interface NominatimPlace {
  display_name?: string
  lat?: string
  lon?: string
  boundingbox?: [string, string, string, string]
  importance?: number
  osm_type?: string
  osm_id?: number
}

export function normalizeDestinationKey(destination: string): string {
  return destination
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function createDestinationResolver(options: {
  client: DestinationGeocoderClient
  now?: () => string
  cache?: Map<string, DestinationResolution>
}) {
  const cache = options.cache ?? new Map<string, DestinationResolution>()
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async resolve(destination: string): Promise<DestinationResolution> {
      const query = destination.trim()
      const key = normalizeDestinationKey(query)
      if (!query || !key) return unresolvedDestination(query, now(), 'Destination is empty; enter a real destination before map research.')

      const cached = cache.get(key)
      if (cached) return { ...cached, source: 'cache', cached: true }

      const observedAt = now()
      const resolved = (await options.client({ query, key, observedAt })) ?? unresolvedDestination(query, observedAt, 'Destination needs manual map verification.')
      cache.set(key, { ...resolved, cached: false })
      return resolved
    }
  }
}

export function createFixtureGeocoderClient(): DestinationGeocoderClient {
  return async ({ query, key, observedAt }) => {
    const fixture = fixtureDestinations[key]
    if (!fixture) return null
    return {
      status: 'resolved',
      label: fixture.label,
      query,
      center: fixture.center,
      bbox: fixture.bbox,
      confidence: fixture.confidence,
      source: 'fixture',
      sourceUrl: fixture.sourceUrl,
      attribution: 'OpenStreetMap contributors',
      observedAt,
      cached: false
    }
  }
}

export function createNominatimGeocoderClient(options: {
  baseUrl: string
  userAgent: string
  fetchImpl?: typeof fetch
}): DestinationGeocoderClient {
  const fetchImpl = options.fetchImpl ?? fetch
  return async ({ query, observedAt }) => {
    const endpoint = new URL('/search', normalizedBaseUrl(options.baseUrl))
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('limit', '1')
    endpoint.searchParams.set('addressdetails', '0')

    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': options.userAgent
      }
    })
    if (!response.ok) return null

    const places = (await response.json()) as NominatimPlace[]
    const place = places[0]
    const lat = Number(place?.lat)
    const lng = Number(place?.lon)
    if (!place || !Number.isFinite(lat) || !Number.isFinite(lng)) return null

    return {
      status: 'resolved',
      label: place.display_name ?? query,
      query,
      center: { lat, lng },
      ...(place.boundingbox ? { bbox: nominatimBounds(place.boundingbox) } : {}),
      confidence: clamp(place.importance ?? 0.7, 0.35, 0.98),
      source: 'nominatim',
      sourceUrl: osmSourceUrl(place) ?? endpoint.toString(),
      attribution: 'OpenStreetMap contributors',
      observedAt,
      cached: false
    }
  }
}

export function composeGeocoderClients(clients: DestinationGeocoderClient[]): DestinationGeocoderClient {
  return async (input) => {
    for (const client of clients) {
      const result = await client(input)
      if (result) return result
    }
    return null
  }
}

export function unresolvedDestination(query: string, observedAt: string, warning: string): DestinationResolution {
  return {
    status: 'unresolved',
    label: query || 'Unknown destination',
    query,
    center: { lat: 20, lng: 0 },
    confidence: 0.1,
    source: 'manual_fallback',
    attribution: 'Manual verification required before using map results.',
    observedAt,
    cached: false,
    warning
  }
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function nominatimBounds(value: [string, string, string, string]): MapBounds {
  const [south, north, west, east] = value.map(Number)
  return { south: south ?? 0, north: north ?? 0, west: west ?? 0, east: east ?? 0 }
}

function osmSourceUrl(place: NominatimPlace): string | undefined {
  if (!place.osm_type || !place.osm_id) return undefined
  return `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const fixtureDestinations: Record<
  string,
  {
    label: string
    center: MapPoint
    bbox: MapBounds
    confidence: number
    sourceUrl: string
  }
> = {
  'lisbon-portugal': {
    label: 'Lisbon, Portugal',
    center: { lat: 38.7223, lng: -9.1393 },
    bbox: { north: 38.82, south: 38.65, east: -9.05, west: -9.24 },
    confidence: 0.95,
    sourceUrl: 'fixture://destinations/lisbon-portugal'
  },
  'paris-france': {
    label: 'Paris, France',
    center: { lat: 48.8566, lng: 2.3522 },
    bbox: { north: 48.91, south: 48.81, east: 2.42, west: 2.25 },
    confidence: 0.95,
    sourceUrl: 'fixture://destinations/paris-france'
  },
  'new-york-united-states': {
    label: 'New York, United States',
    center: { lat: 40.7128, lng: -74.006 },
    bbox: { north: 40.92, south: 40.49, east: -73.7, west: -74.26 },
    confidence: 0.94,
    sourceUrl: 'fixture://destinations/new-york-united-states'
  },
  'london-united-kingdom': {
    label: 'London, United Kingdom',
    center: { lat: 51.5072, lng: -0.1276 },
    bbox: { north: 51.7, south: 51.28, east: 0.28, west: -0.51 },
    confidence: 0.94,
    sourceUrl: 'fixture://destinations/london-united-kingdom'
  },
  'tokyo-japan': {
    label: 'Tokyo, Japan',
    center: { lat: 35.6762, lng: 139.6503 },
    bbox: { north: 35.9, south: 35.5, east: 139.92, west: 139.45 },
    confidence: 0.94,
    sourceUrl: 'fixture://destinations/tokyo-japan'
  },
  'kyoto-japan': {
    label: 'Kyoto, Japan',
    center: { lat: 35.0116, lng: 135.7681 },
    bbox: { north: 35.15, south: 34.87, east: 135.9, west: 135.65 },
    confidence: 0.92,
    sourceUrl: 'fixture://destinations/kyoto-japan'
  }
}
