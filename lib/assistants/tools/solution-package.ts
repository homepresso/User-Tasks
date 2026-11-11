/**
 * Packaging what the Agent built (server side): a solution's items — tables,
 * forms, decision tables, workflows, reports — become ONE package, so the
 * person can remove the whole solution in one go, version it, and share it.
 *
 * Everything goes through the existing package MCP tools as the person
 * (lib/mcp/tools/packages.ts → lib/services/packages.ts / package-installs.ts),
 * so their permissions, audit and the package rules apply unchanged:
 *
 *  1. packages_create (packages.manage) with every created item as a root —
 *     or packages_update `add` when the solution already has a package
 *     ("Add to package <name>");
 *  2. packages_build: a signed version, 1.0.0 for a new package, the next
 *     minor version when items are added;
 *  3. packages_install of that version in this same workspace
 *     (packages.install): the items already exist here, so nothing is
 *     created or changed — the install only records that the package owns
 *     them, which is what makes "Uninstall" (Packages → Installed) remove
 *     everything it created. Without packages.install the package is still
 *     made (versioning, sharing); the result says one-click uninstall needs
 *     that permission.
 *
 * Used by build_plan's `package` option (after the items, in the same flow)
 * and by package_solution (items built earlier in the conversation). Sharing
 * to the community gallery is a separate confirmed step
 * (package_share_to_gallery): it follows the gallery's own submission flow
 * (validated now, queued for a moderator, nothing public until approved).
 */
import type { AssistantToolDef, ToolEnv } from '../engine'
import { CommunityListingSchema, COMMUNITY_LICENCES, DEFAULT_LICENCE } from '@/lib/gallery/community'
import { GALLERY_CATEGORIES } from '@/lib/gallery/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments and payloads are JSON */

/** Item kinds a solution package carries (package asset types of the same name). */
export const PACKAGE_ITEM_KINDS = ['data_table', 'form', 'decision_table', 'workflow', 'report'] as const
export type PackageItemKind = (typeof PACKAGE_ITEM_KINDS)[number]

export const PACKAGES_PAGE = '/packages?tab=authored'
export const INSTALLED_PAGE = '/packages?tab=library'
export const FIRST_VERSION = '1.0.0'
export const UNINSTALL_NOTE = 'Uninstalling the package (Packages → Installed → Uninstall) removes everything it created; items changed since are kept unless forced, and tables that hold rows unless you choose to delete their data.'

export interface PackageOption {
  /** Package name (a new package). */
  name: string
  description?: string
  /** First version of a new package (default 1.0.0). */
  version?: string
  /** Add the items to this existing package (id or slug) instead of making a new one. */
  add_to?: string
  /** The person also wants to share it to the community gallery (a separate confirmed step afterwards). */
  share?: boolean
}

export interface PackagingAccess {
  /** packages.manage: create / update / build packages. */
  manage: boolean
  /** packages.install: register the package as installed here (one-click uninstall). */
  install: boolean
  /** The community gallery accepts submissions on this instance (and the person may build packages). */
  share: boolean
}

export interface PackagedItem { kind: string; id: string; name?: string }

export interface PackagingResult {
  status: 'packaged' | 'skipped' | 'failed'
  reason?: string
  error?: string
  package?: { id: string; name: string; slug: string | null; version: string | null; href: string; added_to_existing: boolean }
  /** Registered as installed here: Uninstall removes every item. */
  installed?: boolean
  install_id?: string | null
  install_note?: string
  items?: number
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** build_plan's `package` argument, cleaned (null: no packaging). */
export function normalizePackageOption(raw: unknown): PackageOption | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const add_to = text(r.add_to, 100)
  const name = text(r.name, 120)
  if (!name && !add_to) throw new Error('package: give the package a name (or add_to with an existing package id)')
  const version = text(r.version, 30)
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.version "${version}" is not a version like 1.0.0`)
  const description = text(r.description, 500)
  return { name: name || add_to, ...(description ? { description } : {}), ...(version ? { version } : {}), ...(add_to ? { add_to } : {}), ...(r.share === true ? { share: true } : {}) }
}

/** The slug packages_create derives from a name (lib/utils/slug toUrlSlug, simplified for comparison). */
export function packageSlug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

/**
 * Before the card: refuse packaging into a name that is already taken (a
 * rebuild) — the model asks "Add to package <name>" instead — and resolve
 * add_to to a real package. Returns the existing package when add_to is set.
 */
export async function checkPackageOption(opt: PackageOption, call: (name: string, args: Record<string, any>) => Promise<any>): Promise<{ id: string; name: string; latest_version: string | null } | null> {
  const listed = await call('packages_list', { limit: 0 })
  const packages: any[] = Array.isArray(listed?.packages) ? listed.packages : []
  if (opt.add_to) {
    const found = packages.find((p) => p.id === opt.add_to || p.slug === opt.add_to || String(p.name).toLowerCase() === opt.add_to!.toLowerCase())
    if (!found) throw new Error(`package.add_to: there is no package “${opt.add_to}” in this workspace — make a new package (name) instead`)
    return { id: String(found.id), name: String(found.name), latest_version: found.latest_version ? String(found.latest_version) : null }
  }
  const slug = packageSlug(opt.name)
  const clash = packages.find((p) => p.slug === slug || String(p.name).toLowerCase() === opt.name.toLowerCase())
  if (clash) throw new Error(`A package “${clash.name}” (id ${clash.id}) already exists. Ask the person with ask_user: "Add to package ${clash.name}" (then set package.add_to: "${clash.id}") or "New package" with another name — then call again.`)
  return null
}

/** Card lines for packaging (shown on the plan card and package_solution's card). */
export function packagingCardParts(opt: PackageOption, access: PackagingAccess, existing: { name: string; latest_version: string | null } | null): { lines: string[]; warnings: string[] } {
  if (!access.manage) return { lines: [], warnings: ['Packaging is skipped: making packages needs the Manage packages permission (packages.manage) — ask an admin'] }
  const lines = [existing
    ? `Packaged as: ${existing.name} (adds these items; new version ${existing.latest_version ? 'after ' + existing.latest_version : FIRST_VERSION})`
    : `Packaged as: ${opt.name} ${opt.version ?? FIRST_VERSION} — one-click uninstall, versioning and sharing`]
  const warnings: string[] = []
  if (!access.install) warnings.push('The package is made, but it is not registered as installed here: one-click uninstall needs the Install packages permission (packages.install)')
  if (opt.share) lines.push(access.share ? 'Then: share to the community gallery (you confirm the listing next; a moderator reviews it before anything is public)' : 'Sharing to the gallery is not available on this instance — the package can be shared as a file instead')
  return { lines, warnings }
}

const versionOf = (payload: any): string | null => {
  const v = payload?.version
  return typeof v === 'string' ? v : v?.version ? String(v.version) : null
}

/** Package the items (create or add, build, register as installed here). Never throws. */
export async function packageItems(items: PackagedItem[], opt: PackageOption, deps: { call: (name: string, args: Record<string, any>) => Promise<any>; access: PackagingAccess; env?: ToolEnv }): Promise<PackagingResult> {
  if (!deps.access.manage) return { status: 'skipped', reason: 'Making packages needs the Manage packages permission (packages.manage)' }
  const refs = items.filter((i) => (PACKAGE_ITEM_KINDS as readonly string[]).includes(i.kind) && /^[0-9a-f-]{36}$/i.test(String(i.id))).map((i) => ({ type: i.kind, id: String(i.id) }))
  if (!refs.length) return { status: 'skipped', reason: 'No items to package' }
  const step = async (key: string, label: string, fn: () => Promise<any>) => {
    const id = `${deps.env?.toolCallId ?? 'pkg'}-${key}`
    deps.env?.emit({ type: 'tool_start', id, name: 'packages', label })
    const payload = await fn().catch((e) => ({ error: (e as Error)?.message || 'failed' }))
    deps.env?.emit({ type: 'tool_end', id, name: 'packages', ok: !payload?.error, label })
    return payload
  }
  let pkg: any
  let addedToExisting = false
  if (opt.add_to) {
    const r = await step('package-add', `Adding ${refs.length} items to the package`, () => deps.call('packages_update', { package_id: opt.add_to, add: refs }))
    if (r?.error) return { status: 'failed', error: r.error }
    pkg = r.package
    addedToExisting = true
  } else {
    const r = await step('package-create', `Creating package “${opt.name}”`, () => deps.call('packages_create', { name: opt.name, ...(opt.description ? { description: opt.description } : {}), roots: refs }))
    if (r?.error) return { status: 'failed', error: r.error }
    pkg = r.package
  }
  if (!pkg?.id) return { status: 'failed', error: 'The package tool returned no package' }
  const buildArgs = addedToExisting && pkg.latest_version ? { package_id: pkg.id, bump: 'minor', notes: 'Items added by the Agent' } : { package_id: pkg.id, version: opt.version ?? FIRST_VERSION, notes: 'Built by the Agent' }
  const built = await step('package-build', 'Building and signing the package', () => deps.call('packages_build', buildArgs))
  const href = PACKAGES_PAGE
  const base = { id: String(pkg.id), name: String(pkg.name ?? opt.name), slug: pkg.slug ? String(pkg.slug) : null, href, added_to_existing: addedToExisting }
  if (built?.error) return { status: 'failed', error: `The package was saved but building a version failed: ${built.error}`, package: { ...base, version: null } }
  const version = versionOf(built)
  deps.env?.emit({ type: 'changed', kind: 'package', id: base.id, title: `${base.name}${version ? ` ${version}` : ''}`, href, action: addedToExisting ? 'updated' : 'created' })
  if (!deps.access.install) {
    return { status: 'packaged', package: { ...base, version }, installed: false, items: refs.length, install_note: 'Not registered as installed here: one-click uninstall needs the Install packages permission (packages.install). The package can still be versioned, downloaded and shared.' }
  }
  // The items already exist here: installing this version only records that the package owns them.
  const installed = await step('package-register', 'Registering the package for one-click uninstall', () => deps.call('packages_install', { package_id: base.id, ...(version ? { version } : {}) }))
  if (installed?.error) {
    return { status: 'packaged', package: { ...base, version }, installed: false, items: refs.length, install_note: `The package is built, but registering it as installed here failed (${installed.error}) — uninstall-in-one is not available until it is installed from Packages → Authored here.` }
  }
  return { status: 'packaged', package: { ...base, version }, installed: true, install_id: installed?.install?.id ? String(installed.install.id) : null, items: refs.length, install_note: UNINSTALL_NOTE }
}

const ITEM_ARG = {
  type: 'object',
  properties: { kind: { type: 'string', enum: [...PACKAGE_ITEM_KINDS] }, id: { type: 'string' }, name: { type: 'string' } },
  required: ['kind', 'id'],
}

export interface SolutionPackageDeps {
  call: (name: string, args: Record<string, any>) => Promise<any>
  access: PackagingAccess
  /** Submits a built package to the community gallery as the person (lib/services/gallery-community submitCommunityPackage). */
  share?: (file: { name: string; bytes: Uint8Array }, listing: unknown) => Promise<{ id: string; slug: string; version: string; title: string; status: string }>
}

/** package_solution: package items built earlier (one confirmation). */
export function packageSolutionTool(deps: SolutionPackageDeps): AssistantToolDef {
  const cleanItems = (raw: unknown): PackagedItem[] => (Array.isArray(raw) ? raw : [])
    .filter((i: any) => i && (PACKAGE_ITEM_KINDS as readonly string[]).includes(i.kind) && /^[0-9a-f-]{36}$/i.test(String(i.id)))
    .map((i: any) => ({ kind: String(i.kind), id: String(i.id), ...(i.name ? { name: String(i.name).slice(0, 200) } : {}) }))
  return {
    name: 'package_solution',
    description: 'Package items you built (tables, forms, decision tables, workflows, reports) as ONE package: one-click uninstall of the whole solution, versioning (1.0.0) and sharing. Or add them to an existing package (add_to). For a build_plan use its `package` option instead. The person confirms.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package name, e.g. "Purchase requests"' },
        description: { type: 'string' },
        version: { type: 'string', description: 'First version (default 1.0.0)' },
        add_to: { type: 'string', description: 'An existing package id: add the items to it (new minor version)' },
        items: { type: 'array', items: ITEM_ARG, description: 'Every item of the solution, with its id' },
      },
      required: ['items'],
    },
    mode: 'write',
    label: (args) => `Packaging ${String(args.name ?? 'the solution').slice(0, 60)}`,
    confirm: async (args) => {
      const opt = normalizePackageOption({ name: args.name, description: args.description, version: args.version, add_to: args.add_to })!
      const items = cleanItems(args.items)
      if (!items.length) throw new Error('package_solution needs the items (kind and id of each)')
      if (!deps.access.manage) throw new Error('Making packages needs the Manage packages permission (packages.manage) — tell the person and skip packaging')
      const existing = await checkPackageOption(opt, deps.call)
      const parts = packagingCardParts(opt, deps.access, existing)
      return {
        title: existing ? `Add to package “${existing.name}”` : `Package “${opt.name}”`,
        lines: [...parts.lines, `${items.length} item${items.length === 1 ? '' : 's'}: ${items.slice(0, 10).map((i) => `“${i.name ?? i.kind}”`).join(', ')}${items.length > 10 ? ` and ${items.length - 10} more` : ''}`, 'Nothing is changed in the items themselves'],
        warnings: parts.warnings,
        confirm_label: existing ? 'Add to package' : 'Package it',
      }
    },
    run: async (args, env) => {
      const opt = normalizePackageOption({ name: args.name, description: args.description, version: args.version, add_to: args.add_to })!
      const result = await packageItems(cleanItems(args.items), opt, { call: deps.call, access: deps.access, env })
      return { result: { ...result, note: packagingNote(result, deps.access) }, ok: result.status !== 'failed' }
    },
  }
}

/** What the model tells the person after packaging. */
export function packagingNote(result: PackagingResult, access: PackagingAccess, share = false): string {
  if (result.status === 'skipped') return `Packaging was skipped: ${result.reason}. Say so in one line.`
  if (result.status === 'failed') return `Packaging failed: ${result.error}. The items are built; offer package_solution to try again.`
  const parts = [`Say it is packaged as [${result.package!.name} ${result.package!.version ?? ''}](${result.package!.href}).`]
  parts.push(result.installed ? `Tell them: ${UNINSTALL_NOTE} (${INSTALLED_PAGE})` : String(result.install_note ?? ''))
  if (share) parts.push(access.share ? 'They asked to share it: call package_share_to_gallery with this package_id and a listing (title, summary 40–200 characters, description 100+ characters, category, tags) — the person confirms the listing.' : 'They asked to share it, but the community gallery is not available on this instance: say they can download the package (Packages → Authored here) and share the file.')
  return parts.join(' ')
}

/** package_share_to_gallery: the community gallery's own submission flow, confirmed. */
export function shareToGalleryTool(deps: SolutionPackageDeps): AssistantToolDef | null {
  if (!deps.share || !deps.access.share) return null
  const share = deps.share
  const listingOf = (args: Record<string, any>) => {
    const l = args.listing && typeof args.listing === 'object' ? args.listing : {}
    return { ...l, licence: l.licence ?? DEFAULT_LICENCE }
  }
  return {
    name: 'package_share_to_gallery',
    description: 'Share a package (built in this workspace) to the UserTasks community gallery: the latest version is validated now and queued for a moderator — nothing is public until it is approved. The person confirms the listing.',
    parameters: {
      type: 'object',
      properties: {
        package_id: { type: 'string' },
        listing: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '3–80 characters' },
            summary: { type: 'string', description: 'One sentence, 40–200 characters' },
            description: { type: 'string', description: 'What it does and what it contains, 100–6000 characters, plain text' },
            category: { type: 'string', enum: GALLERY_CATEGORIES.map((c) => c.id) },
            tags: { type: 'array', items: { type: 'string' }, description: '1–8 lower-case words' },
            author_name: { type: 'string', description: 'How the author is shown (ask if unsure)' },
            licence: { type: 'string', enum: [...COMMUNITY_LICENCES] },
          },
          required: ['title', 'summary', 'description', 'category', 'tags', 'author_name'],
        },
      },
      required: ['package_id', 'listing'],
    },
    mode: 'write',
    label: () => 'Sharing to the gallery',
    confirm: async (args) => {
      const parsed = CommunityListingSchema.safeParse(listingOf(args))
      if (!parsed.success) throw new Error(`Fix the listing first: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'listing'}: ${i.message}`).join('; ')}`)
      const got = await deps.call('packages_get', { package_id: String(args.package_id) })
      if (got?.error) throw new Error(`Can't find that package: ${got.error}`)
      const pkg = got.package
      if (!pkg?.latest_version) throw new Error('The package has no built version yet — build it first')
      const l = parsed.data
      return {
        title: `Share “${pkg.name}” ${pkg.latest_version} to the community gallery`,
        lines: [`Listing: “${l.title}” — ${l.summary}`, `Category: ${GALLERY_CATEGORIES.find((c) => c.id === l.category)?.title ?? l.category} · tags: ${l.tags.join(', ')} · licence ${l.licence}`, `Author shown as: ${l.author_name}`, 'Submitted for review: a moderator checks it before anything is public, and you are emailed the decision'],
        warnings: ['Shared packages are public once approved: they carry the items\' structure (never secrets or table rows unless the package includes rows)'],
        confirm_label: 'Submit for review',
      }
    },
    run: async (args) => {
      const dl = await deps.call('packages_download', { package_id: String(args.package_id) })
      if (dl?.error || !dl?.file_base64) return { result: { error: dl?.error ?? 'Could not read the package file' }, ok: false }
      try {
        const submission = await share({ name: String(dl.file_name ?? 'package.utpkg'), bytes: new Uint8Array(Buffer.from(String(dl.file_base64), 'base64')) }, listingOf(args))
        return { result: { submitted: true, submission, note: 'Say it is submitted for review (status pending): a moderator approves it before it is listed in the community gallery, and they get an email with the decision. Their submissions: /gallery/share.' } }
      } catch (error) {
        return { result: { error: (error as Error)?.message || 'The submission failed' }, ok: false }
      }
    },
  }
}

/** Item types package_items can add or remove (every packageable type). */
export const PACKAGE_EDIT_KINDS = ['workflow', 'workflow_activity', 'data_table', 'integration', 'connector', 'decision_table', 'email_template', 'agent', 'report', 'role', 'mcp_server', 'retention_policy', 'log_destination', 'form', 'form_theme', 'form_control'] as const

/**
 * package_items: add items to / remove items from an existing package (one
 * confirmation), then — by default — build the next version and update the
 * install here, so one-click uninstall covers the change. The card shows the
 * dependencies an add brings in and, for a removal, what in the package still
 * uses the item ("Workflow X uses this form"): confirming removes it anyway.
 * Same MCP tools and permissions as everywhere else (packages_items_add /
 * packages_items_remove / packages_build with update_install).
 */
export function packageItemsTool(deps: { call: (name: string, args: Record<string, any>) => Promise<any>; access: PackagingAccess }): AssistantToolDef {
  const refs = (raw: unknown) => (Array.isArray(raw) ? raw : [])
    .filter((i: any) => i && (PACKAGE_EDIT_KINDS as readonly string[]).includes(i.kind) && /^[0-9a-f-]{36}$/i.test(String(i.id)))
    .map((i: any) => ({ type: String(i.kind), id: String(i.id) }))
  const resolve = async (wanted: string) => {
    const listed = await deps.call('packages_list', { limit: 0 })
    const found = (Array.isArray(listed?.packages) ? listed.packages : []).find((p: any) => p.id === wanted || p.slug === wanted || String(p.name).toLowerCase() === wanted.toLowerCase())
    if (!found) throw new Error(`There is no package “${wanted}” in this workspace (packages_list shows them)`)
    return found as { id: string; name: string; latest_version: string | null }
  }
  const names = (list: any[]) => list.slice(0, 8).map((i) => `${String(i.label ?? i.type).toLowerCase()} “${i.name || i.id}”`).join(', ') + (list.length > 8 ? ` and ${list.length - 8} more` : '')
  return {
    name: 'package_items',
    description: 'Add items to or remove items from an existing package (by id, slug or name), e.g. "add the expense workflow to the Purchase requests package". Adds bring what the items use (with_dependencies, default true); removing an item another item uses is shown on the card and confirmed by the person. Then builds the next version (minor for adds, patch for removals) and updates the install here so uninstall covers the change (build: false skips that). The person confirms.',
    parameters: {
      type: 'object',
      properties: {
        package: { type: 'string', description: 'Package id, slug or name' },
        add: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: [...PACKAGE_EDIT_KINDS] }, id: { type: 'string' }, name: { type: 'string' } }, required: ['kind', 'id'] } },
        remove: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: [...PACKAGE_EDIT_KINDS] }, id: { type: 'string' }, name: { type: 'string' } }, required: ['kind', 'id'] } },
        with_dependencies: { type: 'boolean', description: 'Default true' },
        build: { type: 'boolean', description: 'Build the next version and update the install here (default true)' },
      },
      required: ['package'],
    },
    mode: 'write',
    label: (args) => `Changing package ${String(args.package ?? '').slice(0, 60)}`,
    confirm: async (args) => {
      if (!deps.access.manage) throw new Error('Changing packages needs the Manage packages permission (packages.manage) — tell the person')
      const add = refs(args.add)
      const remove = refs(args.remove)
      if (!add.length && !remove.length) throw new Error('package_items needs add or remove (kind and id of each item)')
      const pkg = await resolve(String(args.package ?? ''))
      const withDeps = args.with_dependencies !== false
      const lines: string[] = []
      const warnings: string[] = []
      if (add.length) {
        const plan = await deps.call('packages_items_add', { package_id: pkg.id, items: add, dry_run: true })
        if (plan?.error) throw new Error(plan.error)
        lines.push(`Adds: ${names(plan.adding)}`)
        if (plan.dependencies?.length) {
          if (withDeps) lines.push(`With what they use: ${names(plan.dependencies)}`)
          else warnings.push(`Leaves out what they use (${names(plan.dependencies)}): it must exist wherever the package is installed`)
        }
      }
      if (remove.length) {
        const plan = await deps.call('packages_items_remove', { package_id: pkg.id, items: remove, dry_run: true })
        if (plan?.error) throw new Error(plan.error)
        lines.push(`Removes: ${names(plan.removing)} (they stay in the workspace)`)
        for (const w of plan.warnings ?? []) warnings.push(`${w} — confirming removes it anyway`)
      }
      if (args.build !== false) {
        lines.push(`Then builds the next ${add.length ? 'minor' : 'patch'} version${pkg.latest_version ? ` after ${pkg.latest_version}` : ''}${deps.access.install ? ' and updates the install here: uninstall removes what is added and keeps what is removed' : ''}`)
        if (!deps.access.install) warnings.push('The install here is not updated: that needs the Install packages permission (packages.install)')
      } else {
        lines.push('Not built yet: the package shows “Unpublished changes” until a new version is built')
      }
      return { title: `Change package “${pkg.name}”`, lines, warnings, confirm_label: remove.length && warnings.some((w) => /removes it anyway/.test(w)) ? 'Remove anyway' : 'Change package' }
    },
    run: async (args, env) => {
      const pkg = await resolve(String(args.package ?? ''))
      const add = refs(args.add)
      const remove = refs(args.remove)
      const result: Record<string, any> = { package: { id: pkg.id, name: pkg.name, href: PACKAGES_PAGE } }
      if (add.length) {
        const r = await deps.call('packages_items_add', { package_id: pkg.id, items: add, with_dependencies: args.with_dependencies !== false })
        if (r?.error) return { result: { ...result, error: r.error }, ok: false }
        result.added = add.length
        result.dependencies = r.dependencies_added
      }
      if (remove.length) {
        // The card showed what still uses them; confirming it removes them anyway.
        const r = await deps.call('packages_items_remove', { package_id: pkg.id, items: remove, force: true })
        if (r?.error) return { result: { ...result, error: r.error }, ok: false }
        result.removed = remove.length
      }
      if (args.build !== false) {
        const built = await deps.call('packages_build', { package_id: pkg.id, bump: add.length ? 'minor' : 'patch', notes: 'Items changed by the Agent', ...(deps.access.install ? { update_install: true } : {}) })
        if (built?.error) return { result: { ...result, error: `The package was changed but building a version failed: ${built.error}` }, ok: false }
        result.version = built.version?.version ?? null
        result.install = built.install_sync ?? null
      }
      env.emit({ type: 'changed', kind: 'package', id: pkg.id, title: `${pkg.name}${result.version ? ` ${result.version}` : ''}`, href: PACKAGES_PAGE, action: 'updated' })
      return { result: { ...result, note: `Say what changed in the package [${pkg.name}](${PACKAGES_PAGE})${result.version ? ` (now ${result.version})` : ' (unpublished until a new version is built)'}${result.install?.note ? `. ${result.install.note}` : ''}.` } }
    },
  }
}
