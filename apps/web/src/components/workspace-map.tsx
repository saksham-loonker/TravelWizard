'use client'

import { CircleDollarSign, MapPin } from 'lucide-react'
import { divIcon } from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

interface WorkspaceMapProps {
  trip: {
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
  } | null
  candidates: Array<{
    providerOfferId: string
    title: string
    type: string
    providerId: string
    price?: { amount: number; currency: string; observedAt: string }
    scores?: { total: number }
  }>
}

const defaultCenter: [number, number] = [20, 0]
const sourceMarkerIcon = divIcon({
  className: 'source-marker',
  html: '<span class="source-marker-core"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -12]
})

export function WorkspaceMap({ trip, candidates }: WorkspaceMapProps) {
  const resolution = trip?.destinationResolution
  const center: [number, number] = resolution ? [resolution.center.lat, resolution.center.lng] : defaultCenter
  const zoom = resolution?.status === 'resolved' ? 12 : 2

  return (
    <>
      <MapContainer key={`${trip?.destination ?? 'empty-map'}-${resolution?.observedAt ?? 'unresolved'}`} className="map" center={center} zoom={zoom} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {candidates.map((candidate, index) => {
          const offset = (index + 1) * 0.008
          return (
            <Marker key={candidate.providerOfferId} icon={sourceMarkerIcon} position={[center[0] + offset, center[1] + offset]}>
              <Popup>
                <strong>{candidate.title}</strong>
                <br />
                {candidate.providerId} - score {candidate.scores?.total ?? 'pending'}
                <br />
                {candidate.price ? `${candidate.price.currency} ${candidate.price.amount} observed ${candidate.price.observedAt}` : 'Manual price verification'}
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      <div className="map-empty" style={{ top: 18, bottom: 'auto', maxWidth: 380 }}>
        <span className="status">
          <MapPin size={14} aria-hidden="true" />
          {trip ? trip.destination : 'No destination'}
        </span>
        <span className="status" style={{ marginLeft: 8 }}>
          <CircleDollarSign size={14} aria-hidden="true" />
          {candidates.length} source items
        </span>
        {resolution && (
          <p className="meta">
            {resolution.status === 'resolved'
              ? `Map source ${resolution.source}; confidence ${Math.round(resolution.confidence * 100)}%; observed ${resolution.observedAt}.`
              : `${resolution.warning ?? 'Destination needs manual map verification.'} ${resolution.attribution}`}
          </p>
        )}
      </div>
    </>
  )
}
