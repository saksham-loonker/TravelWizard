import { describe, expect, it } from 'vitest'
import { createDestinationResolver, createFixtureGeocoderClient, createNominatimGeocoderClient, normalizeDestinationKey } from './index'

const observedAt = '2026-05-25T02:00:00.000Z'

describe('destination geocoding and map provenance', () => {
  it('normalizes destination keys and serves repeated lookups from cache with provenance', async () => {
    const requested: string[] = []
    const resolver = createDestinationResolver({
      now: () => observedAt,
      client: async ({ query }) => {
        requested.push(query)
        return {
          status: 'resolved',
          label: 'Kyoto, Japan',
          query,
          center: { lat: 35.0116, lng: 135.7681 },
          bbox: { north: 35.15, south: 34.87, east: 135.9, west: 135.65 },
          confidence: 0.92,
          source: 'nominatim',
          sourceUrl: 'https://nominatim.openstreetmap.org/search?q=Kyoto%2C%20Japan',
          attribution: 'OpenStreetMap contributors',
          observedAt,
          cached: false
        }
      }
    })

    expect(normalizeDestinationKey('  Kyoto, Japan ')).toBe('kyoto-japan')

    const first = await resolver.resolve('  Kyoto, Japan ')
    const second = await resolver.resolve('kyoto japan')

    expect(requested).toEqual(['Kyoto, Japan'])
    expect(first.status).toBe('resolved')
    expect(second.source).toBe('cache')
    expect(second.center).toEqual(first.center)
    expect(second.attribution).toContain('OpenStreetMap')
  })

  it('uses deterministic fixtures and explicit unresolved fallback instead of fake coordinates', async () => {
    const resolver = createDestinationResolver({
      now: () => observedAt,
      client: createFixtureGeocoderClient()
    })

    const lisbon = await resolver.resolve('Lisbon, Portugal')
    const unknown = await resolver.resolve('A Place That Is Not In Fixtures')

    expect(lisbon.status).toBe('resolved')
    expect(lisbon.center).toEqual({ lat: 38.7223, lng: -9.1393 })
    expect(lisbon.source).toBe('fixture')
    expect(lisbon.confidence).toBeGreaterThan(0.8)

    expect(unknown.status).toBe('unresolved')
    expect(unknown.center).toEqual({ lat: 20, lng: 0 })
    expect(unknown.source).toBe('manual_fallback')
    expect(unknown.warning).toContain('manual')
    expect(unknown.confidence).toBeLessThan(0.2)
  })

  it('parses Nominatim-compatible responses with identifying headers and OSM attribution', async () => {
    const requested: Array<{ url: string; userAgent: string | undefined }> = []
    const client = createNominatimGeocoderClient({
      baseUrl: 'https://nominatim.openstreetmap.org',
      userAgent: 'TravelWizard local dev test',
      fetchImpl: async (url, init) => {
        requested.push({ url: String(url), userAgent: init?.headers instanceof Headers ? init.headers.get('User-Agent') ?? undefined : (init?.headers as Record<string, string> | undefined)?.['User-Agent'] })
        return new Response(
          JSON.stringify([
            {
              display_name: 'Kyoto, Kyoto Prefecture, Japan',
              lat: '35.0116',
              lon: '135.7681',
              boundingbox: ['34.87', '35.15', '135.65', '135.9'],
              importance: 0.82,
              osm_type: 'relation',
              osm_id: 12345
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    })

    const result = await client({ query: 'Kyoto, Japan', key: 'kyoto-japan', observedAt })

    expect(requested[0]?.url).toContain('/search')
    expect(requested[0]?.url).toContain('format=jsonv2')
    expect(requested[0]?.userAgent).toBe('TravelWizard local dev test')
    expect(result?.status).toBe('resolved')
    expect(result?.source).toBe('nominatim')
    expect(result?.sourceUrl).toContain('openstreetmap.org')
    expect(result?.attribution).toContain('OpenStreetMap')
  })
})
