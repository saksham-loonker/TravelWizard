import { providerRegistry } from '@travelwizard/providers'

const forbiddenSecrets = new Set(['dev-local-secret-change-me', 'replace-with-a-random-local-secret', 'replace-with-a-random-local-secret-at-least-24-chars'])

export function requireCompanionSecret(env: { LOCAL_COMPANION_SECRET?: string } = process.env): string {
  const secret = env.LOCAL_COMPANION_SECRET?.trim()
  if (!secret || forbiddenSecrets.has(secret) || secret.length < 24) {
    throw new Error('LOCAL_COMPANION_SECRET must be set to a non-default value with at least 24 characters.')
  }
  return secret
}

export function isAllowedOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  return !origin || origin === expectedOrigin
}

export function domainsForProvider(providerId: string): string[] {
  const provider = providerRegistry.find((item) => item.id === providerId)
  if (!provider || !provider.allowLocalBrowserResearch) {
    throw new Error('Provider is not enabled for local browser research')
  }
  return [...provider.allowedDomains]
}
