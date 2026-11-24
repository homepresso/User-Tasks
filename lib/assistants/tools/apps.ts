/**
 * The Agent building apps (server side): the confirmation cards and results
 * of the app write tools, which are the MCP tools of the same name run as
 * the signed-in person (lib/assistants/tools/designer.ts binds them):
 *
 *  - apps_apply_spec: the card IS the plan — apps_plan runs first (as the
 *    person, read-only) and a spec with problems never reaches a card: the
 *    plain-language errors go back to the model to fix (ToolPrecheck), like
 *    the workflow self-check. A valid spec shows the app, its pages, every
 *    new / changed widget (a table preview), the audience and the warnings;
 *    confirming applies it in one step (lib/services/app-spec.ts — whole or
 *    nothing, audited as the person "via Agent").
 *  - apps_access_grant: the card lists the exact form grants (who gets View +
 *    Submit on which form), recomputed from apps_access_check; only grants
 *    the person may give (Manage roles) are offered at all.
 *  - apps_package: the card is the package preview (what travels); the
 *    result drops the file bytes and links the Packages page.
 *  - Drafts: apps_apply_spec saves to the app's DRAFT (the card says so);
 *    afterwards the person gets two buttons — Publish now / Keep as a draft —
 *    and apps_publish (its card lists what publishing changes, from
 *    apps_compare) makes it live. apps_draft_discard and
 *    apps_version_restore have their own cards. publish: true on the spec
 *    (only when the person explicitly asked to make it live now) publishes
 *    in the same confirmed step.
 */
import type { ToolEnv } from '../engine'
import { ToolPrecheck } from '../engine'
import type { ConfirmCard } from '../types'
import { PACKAGES_PAGE } from './solution-package'

/* eslint-disable @typescript-eslint/no-explicit-any -- MCP payloads are JSON */

type Read = (name: string, args: Record<string, any>) => Promise<any>
type Card = Omit<ConfirmCard, 'tool_call_id' | 'tool'>

export const APP_WRITE_TOOLS = new Set(['apps_apply_spec', 'apps_access_grant', 'apps_package', 'apps_publish', 'apps_draft_discard', 'apps_version_restore'])

/** The prefix of the error a spec with problems comes back with (the model fixes it and calls again). */
export const SPEC_PROBLEMS = 'The app spec has problems — fix every one and call apps_apply_spec again with the corrected spec (apps_plan checks it without a card)'

export async function describeAppWrite(tool: string, args: Record<string, any>, read: Read): Promise<Card> {
  if (tool === 'apps_apply_spec') {
    const plan = await read('apps_plan', args)
    if (plan?.error) throw new Error(String(plan.error))
    if (!plan?.valid) throw new ToolPrecheck(`${SPEC_PROBLEMS} (${(plan?.errors ?? []).length} listed in errors)`, { errors: plan?.errors ?? [] })
    const s = plan.summary
    const destructive = (s?.warnings ?? []).some((w: string) => /^(Deletes|Removes) /.test(w))
    return {
      title: s?.title ?? 'Build the app',
      lines: s?.lines ?? [],
      warnings: s?.warnings ?? [],
      preview: s?.preview ?? null,
      confirm_label: plan.save_as === 'publish' ? (plan.mode === 'create' ? 'Build and publish' : 'Apply and publish') : plan.mode === 'create' ? 'Build app' : 'Apply changes',
      ...(destructive ? { danger: true } : {}),
    }
  }
  if (tool === 'apps_publish' || tool === 'apps_draft_discard' || tool === 'apps_version_restore') {
    const restore = tool === 'apps_version_restore'
    const cmp = await read('apps_compare', restore ? { app_id: args.app_id, from: 'draft', to: Number(args.version) } : { app_id: args.app_id })
    if (cmp?.error) throw new Error(`Can't read that app's versions: ${cmp.error}`)
    const app = await read('apps_get', { app_id: args.app_id })
    const name = app?.name ?? args.app_id
    const lines: string[] = Array.isArray(cmp?.diff?.lines) ? cmp.diff.lines.slice(0, 20) : []
    if (tool === 'apps_publish') {
      const problems: string[] = cmp?.publish_problems ?? []
      if (problems.length) throw new ToolPrecheck('The draft can\'t be published yet — tell the person what to fix', { problems })
      const first = cmp?.from?.version == null
      if (!first && cmp?.diff?.unchanged) throw new ToolPrecheck('Nothing to publish: the draft matches the published version', {})
      const issues = await read('apps_access_check', { app_id: args.app_id }).catch(() => null)
      const gaps = Array.isArray(issues?.gaps) ? issues.gaps.length : 0
      return {
        title: `Publish app “${name}”`,
        lines: first ? ['First version: everyone in the app’s audience can open it', ...lines] : lines,
        warnings: [
          'Everyone in the audience sees this version from now on',
          ...(gaps ? [`${gaps} access issue${gaps === 1 ? '' : 's'}: some people in the audience can’t use something the app shows`] : []),
        ],
        confirm_label: 'Publish',
      }
    }
    if (tool === 'apps_draft_discard') {
      if (cmp?.diff?.unchanged) throw new ToolPrecheck('There are no unpublished changes to discard', {})
      return { title: `Discard the draft of “${name}”`, lines: lines.length ? lines.map((l) => `Undo: ${l}`) : ['Every unpublished change'], warnings: ['The app goes back to its published version; this can\'t be undone'], confirm_label: 'Discard draft', danger: true }
    }
    return { title: `Restore version ${args.version} of “${name}” into the draft`, lines: lines.length ? lines : ['The draft already matches that version'], warnings: ['Replaces the current draft; nothing changes for the audience until you publish'], confirm_label: 'Restore' }
  }
  if (tool === 'apps_access_grant') {
    const analysis = await read('apps_access_check', { app_id: args.app_id })
    if (analysis?.error) throw new Error(`Can't check that app's access: ${analysis.error}`)
    const wanted = Array.isArray(args.keys) && args.keys.length ? new Set(args.keys.map(String)) : null
    const gaps = (analysis?.gaps ?? []).filter((g: any) => g?.fix?.kind === 'grant' && g.fix.can_grant && (!wanted || wanted.has(g.key)))
    if (!gaps.length) {
      const askOnly = (analysis?.gaps ?? []).filter((g: any) => g?.fix?.kind === 'ask' || (g?.fix?.kind === 'grant' && !g.fix.can_grant))
      throw new ToolPrecheck(askOnly.length ? 'None of these access issues is one you can fix with a grant — tell the person whom to ask (each gap\'s fix says who)' : 'There are no access issues to fix', { gaps: askOnly.slice(0, 10).map((g: any) => g.message) })
    }
    const seen = new Set<string>()
    const lines: string[] = []
    for (const g of gaps) {
      const once = `${g.object.id}:${g.principal.type}:${g.principal.id}`
      if (seen.has(once)) continue
      seen.add(once)
      lines.push(`${g.principal.name}: View + Submit on form “${g.object.name}”`)
    }
    return {
      title: `Fix access for this app (${lines.length} form grant${lines.length === 1 ? '' : 's'})`,
      lines: lines.slice(0, 20).concat(lines.length > 20 ? [`and ${lines.length - 20} more`] : []),
      warnings: ['Gives these people access to the forms themselves (not only through the app); each grant is audited on the form'],
      confirm_label: 'Grant access',
    }
  }
  // apps_package
  const preview = await read('apps_package_preview', { app_id: args.app_id, ...(args.excluded ? { excluded: args.excluded } : {}), ...(args.data_modes ? { data_modes: args.data_modes } : {}) })
  if (preview?.error) throw new Error(`Can't package that app: ${preview.error}`)
  const items = Array.isArray(preview?.contents?.items) ? preview.contents.items : []
  const byType = new Map<string, number>()
  for (const it of items) byType.set(String(it?.type ?? 'item'), (byType.get(String(it?.type ?? 'item')) ?? 0) + 1)
  const lines = [
    `App “${preview?.app?.name ?? args.app_id}”${preview?.package ? ` — next version of its package` : ' — a new package'}`,
    ...(byType.size ? [`Includes ${[...byType].map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}${n === 1 ? '' : 's'}`).join(', ')}`] : []),
    ...(args.version ? [`Version ${args.version}`] : []),
  ]
  const warnings = ['Audience, editors and usage data are never included', ...((preview?.embed_origins ?? []).length ? [`Embed widgets need these sites allowed where it is installed: ${preview.embed_origins.join(', ')}`] : [])]
  return { title: `Package app “${preview?.app?.name ?? 'app'}”`, lines, warnings, confirm_label: 'Package' }
}

/** After an app write: the change chip, and a result the model can report from (never the package bytes). */
export function appWriteResult(tool: string, payload: any, env: ToolEnv): any {
  if (tool === 'apps_apply_spec') {
    const app = payload?.app
    if (app?.id) env.emit({ type: 'changed', kind: 'app', id: String(app.id), title: String(app.name ?? 'App'), href: String(payload.builder_href ?? payload.href ?? `/apps/${app.slug}`), action: payload.mode === 'create' ? 'created' : 'updated' })
    const issues = Number(payload?.access?.issues ?? 0)
    const draft = payload?.saved_as === 'draft'
    if (draft) {
      env.emit({
        type: 'choice', id: `${env.toolCallId}:publish`,
        question: `Saved as a draft${payload.mode === 'create' ? ' — only the app’s editors see it' : ' — its audience still sees the published version'}. Publish it to make it live?`,
        options: [
          { label: 'Publish now', reply: `Publish the app “${String(app?.name ?? 'app')}”.` },
          { label: 'Keep it as a draft', reply: 'Keep it as a draft for now.' },
        ],
      })
    }
    const draftNote = draft ? `Saved as a DRAFT: say so, link the preview ([Preview](preview_href)) and the builder. The person sees "Publish now" / "Keep it as a draft" buttons — call apps_publish (they confirm on its card) only when they choose to publish. ` : payload?.saved_as === 'published' ? `Published as version ${payload.version}: everyone in the audience sees it. ` : ''
    return {
      ...payload,
      next: draftNote + (issues
        ? `${issues} access issue${issues === 1 ? '' : 's'}: people in the audience can't use something the app shows. Call apps_access_check, explain, and offer apps_access_grant for the ones the person can fix.`
        : 'Link the app ([name](href)) and offer to open it in the builder (builder_href). If it is not shared yet, offer to set the audience.'),
    }
  }
  if (tool === 'apps_publish' || tool === 'apps_draft_discard' || tool === 'apps_version_restore') {
    const app = payload?.app
    if (app?.id) env.emit({ type: 'changed', kind: 'app', id: String(app.id), title: String(app.name ?? 'App'), href: tool === 'apps_publish' ? `/apps/${app.slug}` : `/apps/${app.slug}?preview=1`, action: 'updated' })
    if (tool === 'apps_publish') return { ...payload, next: `Published as version ${payload?.version}. Link the app ([name](href)).${payload?.access?.issues ? ' There are access issues: offer apps_access_check / apps_access_grant.' : ''}` }
    return { ...payload, next: tool === 'apps_draft_discard' ? 'The draft was discarded: the app is back to its published version.' : `Version ${payload?.restored_version} is now the draft; nothing changes for the audience until it is published (offer apps_publish).` }
  }
  if (tool === 'apps_access_grant') {
    return { granted: payload?.granted ?? 0, remaining_issues: payload?.analysis?.gaps?.length ?? null }
  }
  // apps_package
  const out = { ...payload }
  delete out.file_base64
  env.emit({ type: 'changed', kind: 'package', id: payload?.package?.id ?? null, title: `${payload?.package?.name ?? 'Package'}${payload?.version?.version ? ` ${payload.version.version}` : ''}`, href: PACKAGES_PAGE, action: 'created' })
  return { ...out, href: PACKAGES_PAGE, note: 'Packaged. The .utpkg downloads from the Packages page.' }
}

/** How the Agent builds apps (in the building instructions when the apps tools are offered). */
export const APPS_RULE = [
  'Apps (dashboards and portals people open from the Apps menu: pages of widgets, buttons, lists, charts, filters, an audience): build or change them with ONE app spec, never page by page.',
  '- The app tools may need loading first: call load_tools with ["apps"] when apps_* tools are not in your list.',
  '- First call apps_spec_reference (the spec format, design guide, templates, widgets) — once per conversation — and apps_search to find the real forms, workflows, tables, reports, teams and people to show (apps_object_details for a form\'s parameters or a table\'s columns). Never invent ids. If something the app needs is missing (e.g. a claim form or an approval workflow), offer to build it first (build_plan), then the app.',
  '- Then call apps_apply_spec with the complete spec: the person sees a plan card (pages, widgets, audience) and confirms; a spec with problems comes back to you as plain-language errors — fix them all and call again. Use apps_plan only when you want to check without showing a card.',
  '- Drafts: apps_apply_spec saves to the app\'s DRAFT — a new app is visible to its editors only, a changed app\'s audience keeps the published version — until it is published. Say so and link the preview (preview_href). The person gets Publish now / Keep as a draft buttons; call apps_publish only when they choose to publish (they confirm on its card). Set publish: true on the spec only when the person explicitly asked to make the change live straight away. apps_compare shows what publishing would change; apps_versions / apps_version_restore / apps_draft_discard manage versions (confirmed).',
  '- Changes to an app ("add a chart of overdue tasks to the Team page"): read the page (apps_page_get) for its widget ids, then apps_apply_spec { app_id, pages: [{ page: "<slug>", add_widgets / update_widgets / remove_widgets }] }. "This app" / "this page" is the app open on screen (builder.open_item, its outline names the page).',
  '- Design: follow the guide — primary actions first, metrics in a row, lists and charts side by side, every data widget titled, the theme\'s colours (no raw colours unless asked), viewers for read-only audiences and contributors for people who submit or approve. If a screenshot, mockup or PDF of a dashboard is attached, map each part to the closest widget and keep its order and grouping; say what you could not match.',
  '- After applying: link the app, and if the result reports access issues call apps_access_check and offer apps_access_grant (only the grants the person may give; confirmed). Package it with apps_package only when asked.',
].join('\n')
