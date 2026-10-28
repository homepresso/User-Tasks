import { HOUSEKEEPING_OPTIONS, housekeepingKey, parseHousekeepingValue, type HousekeepingOption } from '@/lib/config/housekeeping'
import type { InfrastructureViewer } from './instance-admins'
import type { HousekeepingClient, HousekeepingRunResult, HousekeepingStatus } from './housekeeping'

/**
 * Settings → Infrastructure → Housekeeping: save settings and run a pass.
 * Instance admins only — the same check as the page (viewerCanSeeInfrastructure:
 * verified email on INSTANCE_ADMIN_EMAILS / instance.admin_emails). No
 * workspace role grants it; a tenant owner is refused like anyone else.
 * The server actions (app/actions/housekeeping.ts) bind the real
 * dependencies; tests pass fakes.
 */

export interface HousekeepingActionDeps {
  canView: (user: InfrastructureViewer | null | undefined) => Promise<boolean>
  client: () => HousekeepingClient
  /** instance_settings write (validated again there), recorded with the user's id. */
  writeSetting: (key: string, value: unknown, updatedBy: string) => Promise<void>
  log?: (line: string) => void
}

export type HousekeepingActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; fieldErrors?: Partial<Record<HousekeepingOption, string>> }

const DENIED = { ok: false as const, error: 'Only instance administrators can change housekeeping.' }

export async function saveHousekeepingSettingsAs(
  user: InfrastructureViewer | null | undefined,
  input: Partial<Record<HousekeepingOption, unknown>>,
  deps: HousekeepingActionDeps,
): Promise<HousekeepingActionResult<{ status: HousekeepingStatus; changed: string[] }>> {
  if (!user || !(await deps.canView(user))) return DENIED
  const values: Array<[HousekeepingOption, boolean | number]> = []
  const fieldErrors: Partial<Record<HousekeepingOption, string>> = {}
  for (const option of HOUSEKEEPING_OPTIONS) {
    if (!(option in input) || input[option] === undefined) continue
    try {
      values.push([option, parseHousekeepingValue(option, input[option])])
    } catch (error) {
      fieldErrors[option] = (error as Error).message
    }
  }
  const unknown = Object.keys(input).filter((key) => !(HOUSEKEEPING_OPTIONS as string[]).includes(key))
  if (unknown.length) return { ok: false, error: `Unknown housekeeping setting: ${unknown.join(', ')}` }
  if (Object.keys(fieldErrors).length) return { ok: false, error: 'Some values are out of range.', fieldErrors }

  const client = deps.client()
  const current = (await client.status()).settings
  const changed: string[] = []
  for (const [option, value] of values) {
    if (current[option] === value) continue
    await deps.writeSetting(housekeepingKey(option), value, user.id)
    changed.push(`${housekeepingKey(option)}=${JSON.stringify(value)}`)
  }
  if (changed.length) (deps.log ?? console.info)(`[housekeeping] ${user.email ?? user.id} set ${changed.join(', ')}`)
  return { ok: true, changed, status: await client.status() }
}

export async function runHousekeepingAs(
  user: InfrastructureViewer | null | undefined,
  options: { dryRun?: boolean },
  deps: HousekeepingActionDeps,
): Promise<HousekeepingActionResult<{ result: HousekeepingRunResult; status: HousekeepingStatus }>> {
  if (!user || !(await deps.canView(user))) return DENIED
  const client = deps.client()
  const result = await client.run({ trigger: 'ui', force: true, dryRun: options.dryRun === true, actor: user.email ?? user.id, budgetMs: 25_000 })
  if (!options.dryRun) (deps.log ?? console.info)(`[housekeeping] pass run by ${user.email ?? user.id}: ${result.status}`)
  return { ok: true, result, status: await client.status() }
}
