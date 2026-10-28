import type { ProviderArea, ProviderId } from '@/lib/config/schema'

/**
 * Provider lookup shared by lib/providers/<area>. Each area maps provider ids
 * to factories; ids reserved for later phases have no factory yet and fail
 * loudly instead of silently falling back to the default.
 */

export class ProviderNotAvailableError extends Error {
  constructor(area: ProviderArea, id: string) {
    super(`The "${id}" ${area} provider is not available in this version`)
    this.name = 'ProviderNotAvailableError'
  }
}

export function pickProvider<A extends ProviderArea, T>(
  area: A,
  id: ProviderId<A>,
  factories: Partial<Record<ProviderId<A>, () => T>>,
): T {
  const factory = factories[id]
  if (!factory) throw new ProviderNotAvailableError(area, id)
  return factory()
}
