/**
 * Extension framework: manifest validation (lib/extensions/manifest.ts),
 * the client-safe registry (lib/extensions/registry.ts) and the server
 * registry's compatibility checks (lib/extensions/server-registry.ts),
 * proven with the in-repo example extension.
 */
import { afterEach, describe, expect, it } from 'vitest'
import exampleDefinition from '@/extensions/example-hello/manifest'
import exampleServer from '@/extensions/example-hello/server'
import exampleJson from '@/extensions/example-hello/usertasks-extension.json'
import { extensionTablePrefix, extKey, parseExtKey, parseExtensionManifest, ExtensionManifestError } from '@/lib/extensions/manifest'
import { getExtensionManifest, getLoadedExtension, hasExtensions, loadExtensionsReport } from '@/lib/extensions/registry'
import { checkCompatibility, extensionProblems, getServerExtension, isExtensionRunnable } from '@/lib/extensions/server-registry'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'

const base = () => JSON.parse(JSON.stringify(exampleJson)) as Record<string, any>
const minimal = (id: string, extra: Record<string, unknown> = {}) => ({
  manifest_version: 1, id, name: id, version: '1.0.0', publisher: { id: 'usertasks', name: 'UserTasks' },
  engines: { usertasks: '>=0.1.0' }, licence: { tier: 'free' }, ...extra,
})

function issues(raw: unknown): string[] {
  try {
    parseExtensionManifest(raw)
    return []
  } catch (error) {
    expect(error).toBeInstanceOf(ExtensionManifestError)
    return (error as ExtensionManifestError).issues
  }
}

afterEach(() => resetExtensionsForTest())

describe('extension manifest', () => {
  it('accepts the example manifest and fills defaults', () => {
    const m = parseExtensionManifest(exampleJson)
    expect(m.id).toBe('example-hello')
    expect(m.contributes.nodes.map((n) => n.key)).toEqual(['greet'])
    expect(m.contributes.nodes[0].category).toBe('action')
    expect(m.contributes.ui.navItems.find((i) => i.id === 'home')?.order).toBe(100)
    expect(m.permissions[0].implied_by).toEqual(['tasks.view_own'])
  })

  it('refuses bad ids, versions and ranges', () => {
    expect(issues({ ...base(), id: 'Bad_Id' }).join(' ')).toMatch(/id/)
    expect(issues({ ...base(), id: 'trailing-' }).join(' ')).toMatch(/id/)
    expect(issues({ ...base(), version: '1.0' }).join(' ')).toMatch(/semver/)
    expect(issues({ ...base(), engines: { usertasks: 'not a range!' } }).join(' ')).toMatch(/engines.usertasks/)
    expect(issues({ ...base(), manifest_version: 2 }).length).toBeGreaterThan(0)
    expect(issues({ ...base(), unexpected: true }).length).toBeGreaterThan(0)
  })

  it('reserves ids and the ut- prefix', () => {
    expect(issues({ ...base(), id: 'core' }).join(' ')).toMatch(/reserved/)
    expect(issues(minimal('ut-crm', { publisher: { id: 'acme', name: 'Acme' } })).join(' ')).toMatch(/first-party/)
    expect(issues(minimal('ut-crm'))).toEqual([])
  })

  it('needs a sku for paid extensions', () => {
    expect(issues({ ...base(), licence: { tier: 'paid' } }).join(' ')).toMatch(/sku/)
    expect(issues({ ...base(), licence: { tier: 'paid', sku: 'ext.hello', features: ['greetings', 'digest'] } })).toEqual([])
  })

  it('checks cross references: permissions, features, sections, pages, settings', () => {
    const m = base()
    m.contributes.ui.navItems[0].when = { permission: 'ext.other.view' }
    m.contributes.ui.navItems[1].when = { permission: 'ext.example-hello.nope' }
    m.contributes.ui.navItems[2].when = { feature: 'unknown-feature' }
    m.contributes.ui.navItems[0].group = 'ext:missing'
    m.contributes.ui.createEntries[0].target = { page: 'no-such-page' }
    m.contributes.ui.userMenu[0].target = { settings: 'no-such-settings' }
    m.contributes.nodes[0].feature = 'nope'
    const found = issues(m).join('\n')
    expect(found).toMatch(/may only name this extension's permissions/)
    expect(found).toMatch(/ext.example-hello.nope" is not declared/)
    expect(found).toMatch(/feature "unknown-feature"/)
    expect(found).toMatch(/section "missing" is not declared/)
    expect(found).toMatch(/page "no-such-page"/)
    expect(found).toMatch(/settings page "no-such-settings"/)
    expect(found).toMatch(/node greet: feature "nope"/)
  })

  it('refuses duplicates, foreign object types, non-action bulk targets and invalid targets', () => {
    const m = base()
    m.contributes.nodes.push({ ...m.contributes.nodes[0] })
    m.contributes.ui.itemActions[0].objectTypes = ['ext:other.case']
    m.contributes.ui.itemActions[4].target = { page: '' }
    const found = issues(m).join('\n')
    expect(found).toMatch(/duplicate node "greet"/)
    expect(found).toMatch(/ext:example-hello.<type>/)
    expect(found).toMatch(/bulk actions must target an action/)
    expect(issues({ ...base(), contributes: { ...base().contributes, ui: { ...base().contributes.ui, userMenu: [{ id: 'x', label: 'X', target: { url: 'http://insecure.example' , external: true } }] } } }).join(' ')).toMatch(/https/)
    expect(issues({ ...base(), contributes: { ...base().contributes, ui: { ...base().contributes.ui, userMenu: [{ id: 'x', label: 'X', target: { route: '//evil.example' } }] } } }).join(' ')).toMatch(/route/)
  })

  it('validates settings fields (options, patterns)', () => {
    const m = base()
    m.contributes.ui.settingsPages[0].schema.sections[0].fields[1].options = undefined
    m.contributes.ui.settingsPages[0].schema.sections[0].fields[0].pattern = { regex: '([', message: 'x' }
    const found = issues(m).join('\n')
    expect(found).toMatch(/needs options/)
    expect(found).toMatch(/invalid pattern/)
  })

  it('namespaces keys, tables and parses them back', () => {
    expect(extKey('example-hello', 'greet')).toBe('ext.example-hello.greet')
    expect(parseExtKey('ext.example-hello.greet')).toEqual({ extensionId: 'example-hello', key: 'greet' })
    expect(parseExtKey('task_created')).toBeNull()
    expect(extensionTablePrefix('example-hello')).toBe('ext_example_hello__')
  })
})

describe('extension registry', () => {
  it('is empty in the public build (generated registry)', () => {
    expect(hasExtensions()).toBe(false)
    expect(loadExtensionsReport()).toEqual({ extensions: [], problems: [] })
    expect(extensionProblems()).toEqual([])
  })

  it('loads the example: manifest, namespaced connector, server module', () => {
    registerExtensionsForTest({ definitions: [exampleDefinition], servers: [exampleServer] })
    expect(hasExtensions()).toBe(true)
    expect(getExtensionManifest('example-hello')?.name).toMatch(/Hello/)
    expect(getLoadedExtension('example-hello')?.connectors.map((c) => c.key)).toEqual(['ext.example-hello.echo'])
    expect(getServerExtension('example-hello')).toBe(exampleServer)
    expect(isExtensionRunnable('example-hello')).toBe(true)
    expect(extensionProblems()).toEqual([])
  })

  it('leaves out invalid manifests and reports them', () => {
    registerExtensionsForTest({ definitions: [{ manifest: { ...base(), id: 'BAD' } }, exampleDefinition], servers: [exampleServer] })
    expect(getExtensionManifest('example-hello')).not.toBeNull()
    expect(loadExtensionsReport().problems.join(' ')).toMatch(/Invalid extension manifest/)
  })

  it('reports duplicate registrations and undeclared connectors', () => {
    registerExtensionsForTest({ definitions: [exampleDefinition, exampleDefinition, { manifest: minimal('other-ext'), connectors: exampleDefinition.connectors }] })
    const problems = loadExtensionsReport().problems.join('\n')
    expect(problems).toMatch(/registered twice/)
    expect(problems).toMatch(/connector "echo" is not listed/)
  })

  it('refuses an incompatible engines range at boot (data kept, extension not run)', () => {
    const incompatible = { manifest: { ...base(), engines: { usertasks: '>=99.0.0' } }, connectors: exampleDefinition.connectors }
    registerExtensionsForTest({ definitions: [incompatible], servers: [exampleServer] })
    expect(getServerExtension('example-hello')).toBeNull()
    expect(isExtensionRunnable('example-hello')).toBe(false)
    expect(extensionProblems().join(' ')).toMatch(/needs UserTasks >=99.0.0/)
    expect(checkCompatibility(getExtensionManifest('example-hello')!).compatible).toBe(false)
  })

  it('refuses a server module that does not match its manifest', () => {
    registerExtensionsForTest({ definitions: [exampleDefinition], servers: [{ ...exampleServer, nodes: { other: async () => ({}) } }] })
    expect(getServerExtension('example-hello')).toBeNull()
    const problems = extensionProblems().join('\n')
    expect(problems).toMatch(/node "other" that the manifest does not declare/)
    expect(problems).toMatch(/node "greet" has no handler/)
  })

  it('refuses public routes the manifest does not declare', () => {
    registerExtensionsForTest({ definitions: [exampleDefinition], servers: [{ ...exampleServer, publicRoutes: [{ path: '/secret', methods: ['GET'], auth: { kind: 'none' }, handler: async () => new Response('x') }] }] })
    expect(extensionProblems().join(' ')).toMatch(/public route \/secret is not declared/)
  })
})
