import { PROVIDER_AREAS } from '@/lib/config/schema'
import { hasSecretRefs, resolveSecretRefs, secretTtlMs } from '@/lib/config/secret-refs'
import { runDoctor } from '@/lib/admin/doctor'
import type { AreaSwitch, PreflightCheck, SwitchContext } from './types'

/**
 * realtime / email / secrets / cache: configuration-only switches. Nothing is copied;
 * the target is validated first (realtime: LISTEN/NOTIFY round trip or the
 * Supabase settings; email: provider options, optional test send; secrets:
 * every `secret://` reference in every area's options resolves through the
 * new store; cache: connection, probe write/read and a rate-limit window
 * counted across calls), then the provider setting is written.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function doctorChecks(ctx: SwitchContext, area: 'realtime' | 'email' | 'cache', extra: { emailTo?: string } = {}): Promise<PreflightCheck[]> {
  const report = await runDoctor({ config: ctx.targetConfig, sql: ctx.db, areas: [area], emailTo: extra.emailTo })
  return report.checks.map((c) => ({ name: `${c.area} ${c.name}`, severity: c.status === 'fail' ? 'error' : c.status === 'warn' ? 'warn' : 'ok', detail: c.detail }))
}

export const realtimeSwitch: AreaSwitch = {
  area: 'realtime',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks = await doctorChecks(ctx, 'realtime')
    if (ctx.to === 'supabase' && !ctx.config.bootstrap.supabase.url) {
      checks.push({ name: 'supabase', severity: 'error', detail: 'SUPABASE_URL is required by the supabase realtime provider' })
    }
    return checks
  },
  steps(ctx) {
    ctx.notes.push('Browsers pick up the realtime provider on their next page load (open tabs keep the old one until they reload).')
    return []
  },
}

export const emailSwitch: AreaSwitch = {
  area: 'email',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    try {
      const testTo = typeof ctx.options.flags['test-to'] === 'string' ? (ctx.options.flags['test-to'] as string) : undefined
      return await doctorChecks(ctx, 'email', { emailTo: ctx.options.dryRun ? undefined : testTo })
    } catch (error) {
      return [{ name: 'email', severity: 'error', detail: message(error) }]
    }
  },
  steps: () => [],
}

export const secretsSwitch: AreaSwitch = {
  area: 'secrets',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    const target = ctx.targetConfig.providers.secrets
    let store
    try {
      const { resolveSecretStore } = await import('@/lib/providers/secrets')
      store = resolveSecretStore(target.id, target.options)
      checks.push({ name: 'store', severity: 'ok', detail: `${target.id} store configured` })
    } catch (error) {
      return [{ name: 'store', severity: 'error', detail: message(error) }]
    }
    let refs = 0
    for (const area of PROVIDER_AREAS) {
      if (area === 'secrets') continue
      const options = ctx.config.providers[area].options
      if (!hasSecretRefs(options)) continue
      refs++
      try {
        await resolveSecretRefs(area, options, store, secretTtlMs(target.options))
        checks.push({ name: `${area} refs`, severity: 'ok', detail: `secret:// references resolve in the ${target.id} store` })
      } catch (error) {
        checks.push({ name: `${area} refs`, severity: 'error', detail: message(error) })
      }
    }
    if (!refs) checks.push({ name: 'references', severity: 'ok', detail: 'no secret:// references to resolve' })
    return checks
  },
  steps: () => [],
}

export const cacheSwitch: AreaSwitch = {
  area: 'cache',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    try {
      return await doctorChecks(ctx, 'cache')
    } catch (error) {
      return [{ name: 'cache', severity: 'error', detail: message(error) }]
    }
  },
  steps(ctx) {
    ctx.notes.push('Rate-limit windows start empty on the new store. Running app instances switch within 30 s (the settings cache); restart them to switch at once.')
    return []
  },
}
