/**
 * `usertasks-admin switch` / `rollback` on UserTasks Cloud (DEPLOYMENT_MODE=cloud):
 * refused with a clear message before the add-on or its licence is consulted
 * — paid extensions are for self-hosted installs only. Self-hosted, the
 * commands still reach the add-on (here a stand-in) as before.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ADDON_CLI_CLOUD, run } from '@/packages/admin/src/cli'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import type { ExtensionDefinition, ServerExtension } from '@/lib/extensions/sdk'

const calls: string[] = []
const definition = {
  manifest: parseExtensionManifest({
    manifest_version: 1, id: 'infrastructure', name: 'Infrastructure', version: '0.1.0', publisher: { id: 'usertasks', name: 'UserTasks' },
    engines: { usertasks: '>=0.0.0', extension_sdk: '^1.2.0' }, licence: { tier: 'paid', sku: 'infrastructure', features: ['infrastructure-separation'] },
    deployments: ['self_hosted'],
  }),
} as unknown as ExtensionDefinition
const server: ServerExtension = {
  id: 'infrastructure',
  infrastructure: {
    feature: 'infrastructure-separation',
    href: '/x/infrastructure',
    actions: {},
    cli: {
      switch: { usage: 'switch usage', run: async () => { calls.push('switch'); return 0 } },
      rollback: { usage: 'rollback usage', run: async () => { calls.push('rollback'); return 0 } },
    },
  },
}

function io(env: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  return { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: env as NodeJS.ProcessEnv, lines: { out, err } }
}

afterEach(() => {
  resetExtensionsForTest()
  calls.length = 0
})

describe('usertasks-admin switch / rollback on UserTasks Cloud', () => {
  it('refused (exit 2) with the self-hosted-only message, add-on in the build or not', async () => {
    for (const withAddon of [false, true]) {
      if (withAddon) registerExtensionsForTest({ definitions: [definition], servers: [server] })
      for (const [name, args] of [['switch', ['storage', '--to', 's3', '--dry-run']], ['rollback', ['0b166a8a-5314-4257-8db6-082dc0a98f7d', '--yes']]] as const) {
        const cli = io({ DEPLOYMENT_MODE: ' Cloud ', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' })
        expect(await run([name, ...args], cli), `${name} withAddon=${withAddon}`).toBe(2)
        expect(cli.lines.err.join('\n')).toBe(ADDON_CLI_CLOUD(name))
        expect(cli.lines.err.join('\n')).toMatch(/not available on UserTasks Cloud.*self-hosted installs only/)
      }
    }
    expect(calls).toEqual([])
  })

  it('self-hosted: --help still reaches the add-on (no cloud refusal)', async () => {
    registerExtensionsForTest({ definitions: [definition], servers: [server] })
    const cli = io({ DEPLOYMENT_MODE: 'self_hosted' })
    expect(await run(['switch', '--help'], cli)).toBe(0)
    expect(cli.lines.out).toEqual(['switch usage'])
  })
})
