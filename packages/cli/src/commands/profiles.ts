/** profiles list | use | rm */

import type { Command } from 'commander'
import { CliUsageError } from '../exit-codes'
import type { Runtime } from '../runtime'

export function registerProfileCommands(program: Command, runtime: Runtime) {
  const profiles = program.command('profiles').description('Manage saved profiles (list, use, rm)')

  profiles
    .command('list')
    .description('List saved profiles (credentials are never shown)')
    .action(async (_opts: unknown, self: Command) => {
      const config = runtime.store.read()
      const active = runtime.settings(self).profileName
      const rows = Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        current: name === active,
        url: profile.url,
        auth: profile.credentials?.type ?? null,
        tenant: profile.tenant?.name ?? profile.tenant?.slug ?? profile.tenant?.id ?? null,
        user: profile.user?.email ?? null,
      }))
      runtime.print(self, rows)
    })

  profiles
    .command('use <name>')
    .description('Make a profile the default')
    .action(async (name: string, _opts: unknown, self: Command) => {
      runtime.store.update((config) => {
        if (!config.profiles[name]) throw new CliUsageError(`No profile named "${name}"`)
        config.current_profile = name
      })
      runtime.info(self, `Now using profile "${name}".`)
    })

  profiles
    .command('rm <name>')
    .description('Delete a profile and its stored credential')
    .action(async (name: string, _opts: unknown, self: Command) => {
      if (!runtime.store.read().profiles[name]) throw new CliUsageError(`No profile named "${name}"`)
      if (!(await runtime.confirm(self, `Remove profile "${name}"?`))) throw new Error('Aborted.')
      runtime.store.update((config) => {
        delete config.profiles[name]
        if (config.current_profile === name) delete config.current_profile
      })
      runtime.info(self, `Removed profile "${name}".`)
    })
}
