import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; font-src 'self' data:; connect-src 'self' http://127.0.0.1:4317 http://localhost:4317 https://api.open-meteo.com https://nominatim.openstreetmap.org; form-action 'self'"
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(configDir, '../..'),
  reactStrictMode: false,
  transpilePackages: ['@travelwizard/domain', '@travelwizard/providers', '@travelwizard/ocr'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders
      }
    ]
  }
}

export default nextConfig
