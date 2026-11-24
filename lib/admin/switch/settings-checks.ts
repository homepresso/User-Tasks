import { runDoctor, type RpcClient } from '@/lib/admin/doctor'
import type { ProviderArea } from '@/lib/config/schema'
import { apiOf } from '../ops/service-sql'
import type { PreflightCheck, SwitchContext } from './types'

/**
 * Pre-flight checks for the settings changes core makes itself (free:
 * lib/infrastructure/addon.ts FREE_SETTINGS_AREAS): the doctor's checks for
 * the area, run against the configuration as it will be. Email sends a test
 * message when `--test-to` / the wizard's test address is given (never on a
 * dry run). The Infrastructure add-on brings the switch plans' own checks
 * for every other area.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function doctorPreflight(ctx: SwitchContext, area: ProviderArea, extra: { emailTo?: string } = {}): Promise<PreflightCheck[]> {
  try {
    // Without a direct connection the checks go through the service-role API, as the page's health checks do.
    const api = apiOf(ctx.db)
    const report = await runDoctor({ config: ctx.targetConfig, sql: api ? null : ctx.db, rpc: api as RpcClient | null, areas: [area], emailTo: extra.emailTo })
    return report.checks.map((c) => ({ name: `${c.area} ${c.name}`, severity: c.status === 'fail' ? 'error' : c.status === 'warn' ? 'warn' : 'ok', detail: c.detail }))
  } catch (error) {
    return [{ name: area, severity: 'error', detail: message(error) }]
  }
}

/** The free areas' pre-flight (email, sign-in); other areas have none in core. */
export function settingsPreflight(area: ProviderArea): ((ctx: SwitchContext) => Promise<PreflightCheck[]>) | null {
  if (area === 'email') {
    return (ctx) => {
      const testTo = typeof ctx.options.flags['test-to'] === 'string' ? (ctx.options.flags['test-to'] as string) : undefined
      return doctorPreflight(ctx, 'email', { emailTo: ctx.options.dryRun ? undefined : testTo })
    }
  }
  if (area === 'auth') {
    return async (ctx) => {
      // Supabase Auth has no options here (SSO for it is set up in the Supabase project).
      if (ctx.to === 'supabase') return [{ name: 'auth', severity: 'ok', detail: 'Supabase Auth: nothing to check' }]
      return doctorPreflight(ctx, 'auth')
    }
  }
  return null
}
