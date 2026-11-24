/* eslint-disable @typescript-eslint/no-explicit-any -- untyped widget configs */
import { displayActionLabel, isPlaceholderLabel, resolveMenuLabels, type LabelContext } from './labels'
import type { ParamMap } from './params'
import type { AppMenuItem, AppMenuLeaf, AppRole, AppWidget, ButtonAction, PageLayout, TabTarget, Visibility, WidgetConfig } from './schema'
import { isFilterRef } from './widgets'
import { WRITE_ACTIONS, ruleActions, type AppRule, type RuleAction } from './rules'

/**
 * Apps and permissions (pure; __tests__/apps-governance.test.ts). An app
 * never grants access by itself:
 *
 *  - Every widget, button and menu entry tied to an object (form, workflow,
 *    data table, report) is shown only when the VIEWER may use that object
 *    under the existing rules — the same rules the object's own screens and
 *    APIs enforce (`objectAllowed`). Hidden items are removed from the page
 *    the server sends, so nothing about them reaches the browser; the
 *    actions themselves stay authorised by their own services.
 *  - The app role narrows further: viewers get no action buttons (open a
 *    form, start a workflow) and no Claim; contributors and editors do, when
 *    the object allows.
 *  - The designer's access analysis (`analyse…` in lib/services/app-access.ts)
 *    applies the same `objectAllowed` to every audience member.
 *
 * The existing rules, per object:
 *  - form (submit): Edit forms (forms.edit), or Submit forms (forms.submit)
 *    plus an explicit View / Submit grant on the form (the person, a team of
 *    theirs or a role they hold — the Available forms rule).
 *  - workflow (start by hand): Start workflows (workflows.activate) and View
 *    workflows (workflows.view), as POST /workflows/{id}/execute.
 *  - data table: View data (data.view).
 *  - report: View reports (reports.view) and the report shared with the
 *    workspace or created by them.
 *  - task sources: View own tasks or View all tasks; submissions: Submit or
 *    Edit forms; runs: anyone (their own runs at least).
 */

export type ObjectKind = 'form' | 'workflow' | 'data_table' | 'report' | 'agent' | 'reference'
export type Need = 'submit' | 'start' | 'view' | 'edit' | 'use'
export type Source = 'tasks' | 'submissions' | 'org'
export const OBJECT_KINDS: readonly ObjectKind[] = ['form', 'workflow', 'data_table', 'report', 'agent', 'reference']

/** One thing a page or menu points at, and what using it needs. */
export interface BoundObject {
  kind: ObjectKind
  id: string
  need: Need
  /** Action (button / menu form / editing): only contributors use it. Data: everyone in the audience reads it. */
  action: boolean
  where: string
  /** Missing it degrades the widget (read-only) instead of hiding it. */
  optional?: boolean
  /** API reference data a designer opened to app viewers (Card view "Allow app viewers"). */
  viewersAllowed?: boolean
}

export interface BoundSource { source: Source; where: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const literalId = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) && !isFilterRef(v) ? v : null)

type AnyAction = ButtonAction
/** The object an action button / tile / menu entry uses (null: none). */
export function actionBinding(a: AnyAction, where: string): { object?: BoundObject; source?: BoundSource } {
  switch (a.kind) {
    case 'new_submission': return { object: { kind: 'form', id: a.form_id, need: 'submit', action: true, where } }
    case 'start_workflow': return { object: { kind: 'workflow', id: a.workflow_id, need: 'start', action: true, where } }
    case 'open_report':
    case 'download_report': return { object: { kind: 'report', id: a.report_id, need: 'view', action: false, where } }
    case 'open_record': return { object: { kind: 'data_table', id: a.table_id, need: a.row_id ? 'view' : 'edit', action: !a.row_id, where } }
    case 'claim_next': return { source: { source: 'tasks', where } }
    default: return {}
  }
}

const TASK_WIDGETS = new Set(['task_list', 'kanban', 'task_calendar', 'my_workload', 'overdue_list', 'team_workload', 'bottleneck'])
const SOURCE_WIDGETS = new Set(['sla', 'sla_trend', 'sla_breakdown', 'cycle_time', 'throughput'])
const METRIC_LIKE = new Set(['metric', 'chart', 'kpi', 'goal', 'gauge', 'pivot', 'heatmap'])
const WORKFLOW_VIEW_WIDGETS = new Set(['run_status', 'recent_failures', 'bottleneck'])

/** The objects and data sources a widget uses (inputs bound to page filters are checked when they are read). */
export function widgetBindings(widget: AppWidget, where = widget.title || widget.type): { objects: BoundObject[]; sources: BoundSource[] } {
  const objects: BoundObject[] = []
  const sources: BoundSource[] = []
  const c = widget.config as Record<string, unknown>
  const addAction = (a: AnyAction, label: string) => {
    const b = actionBinding(a, `${where}: ${label}`)
    if (b.object) objects.push(b.object)
    if (b.source) sources.push(b.source)
  }
  const tableBoard = widget.type === 'kanban' && c.source === 'table'
  if (TASK_WIDGETS.has(widget.type) && !tableBoard) sources.push({ source: 'tasks', where })
  if (tableBoard) {
    // A board of data table rows: read the table; dragging a card writes its lane column (Manage rows).
    const id = literalId(c.table_id)
    if (id) {
      objects.push({ kind: 'data_table', id, need: 'view', action: false, where })
      if (c.allow_drag !== false) objects.push({ kind: 'data_table', id, need: 'edit', action: true, where: `${where} (moving cards)`, optional: true })
    }
  }
  if (SOURCE_WIDGETS.has(widget.type) && c.source !== 'runs') sources.push({ source: 'tasks', where })
  if (WORKFLOW_VIEW_WIDGETS.has(widget.type)) {
    const id = literalId(c.workflow_id)
    if (id) objects.push({ kind: 'workflow', id, need: 'view', action: false, where })
  }
  if (METRIC_LIKE.has(widget.type)) {
    if (c.source === 'tasks' || (widget.type === 'heatmap' && !c.source)) sources.push({ source: 'tasks', where })
    if (c.source === 'submissions') sources.push({ source: 'submissions', where })
    if (c.source === 'table_rows') {
      const id = literalId(c.table_id)
      if (id) objects.push({ kind: 'data_table', id, need: 'view', action: false, where })
    }
  }
  switch (widget.type) {
    case 'actions':
      for (const b of (widget.config as WidgetConfig<'actions'>).buttons) addAction(b.action, b.label)
      break
    case 'tiles':
      for (const t of (widget.config as WidgetConfig<'tiles'>).tiles) addAction(t.action, t.label)
      break
    case 'table_view': {
      const kind = c.kind === 'report' ? 'report' : 'data_table'
      const id = literalId(kind === 'report' ? c.report_id : c.table_id)
      if (id) objects.push({ kind, id, need: 'view', action: false, where })
      break
    }
    case 'recent':
      if (c.source === 'submissions') sources.push({ source: 'submissions', where })
      break
    case 'start_workflow': {
      const id = literalId(c.workflow_id)
      if (id) objects.push({ kind: 'workflow', id, need: 'start', action: true, where })
      break
    }
    case 'submission_trend':
    case 'my_submissions':
    case 'field_analytics':
      sources.push({ source: 'submissions', where })
      break
    case 'form_embed': {
      const id = literalId(c.form_id)
      if (id) objects.push({ kind: 'form', id, need: 'submit', action: true, where })
      break
    }
    case 'data_grid':
    case 'record_card':
    case 'filtered_list': {
      const id = literalId(c.table_id)
      if (id) {
        objects.push({ kind: 'data_table', id, need: 'view', action: false, where })
        if (widget.type === 'data_grid' && (c.editable || c.allow_delete)) objects.push({ kind: 'data_table', id, need: 'edit', action: true, where: `${where} (${c.editable ? 'editing' : 'deleting rows'})`, optional: true })
      }
      break
    }
    case 'card_view': {
      const id = literalId(c.source === 'report' ? c.report_id : c.source === 'reference' ? c.reference_id : c.table_id)
      const kind: ObjectKind = c.source === 'report' ? 'report' : c.source === 'reference' ? 'reference' : 'data_table'
      if (id) objects.push({ kind, id, need: 'view', action: false, where, ...(kind === 'reference' ? { viewersAllowed: c.allow_viewers === true } : {}) })
      for (const a of (widget.config as WidgetConfig<'card_view'>).actions) {
        if (a.kind === 'start_workflow') objects.push({ kind: 'workflow', id: a.workflow_id, need: 'start', action: true, where: `${where}: ${a.label}`, optional: true })
        if (a.kind === 'open_form') objects.push({ kind: 'form', id: a.form_id, need: 'submit', action: true, where: `${where}: ${a.label}`, optional: true })
      }
      break
    }
    case 'org_chart':
      sources.push({ source: 'org', where })
      break
    case 'tabs':
      for (const t of (widget.config as WidgetConfig<'tabs'>).tabs) {
        const b = tabBinding(t.target, `${where}: ${t.label}`)
        if (b) objects.push(b)
      }
      break
    case 'nav_bar':
      for (const { item, path } of menuLeaves((widget.config as WidgetConfig<'nav_bar'>).items)) {
        const b = leafBinding(item, `${where}: ${path}`)
        if (b.object) objects.push({ ...b.object, optional: true })
      }
      break
    case 'agent_chat': {
      const id = literalId(c.agent_id)
      if (id) objects.push({ kind: 'agent', id, need: 'use', action: true, where })
      break
    }
  }
  return { objects, sources }
}

/** The object a tab's direct target uses (optional: only that tab is hidden). */
export function tabBinding(t: TabTarget | null | undefined, where: string): BoundObject | null {
  if (!t) return null
  switch (t.kind) {
    case 'form': return { kind: 'form', id: t.form_id, need: 'submit', action: true, where, optional: true }
    case 'report': return { kind: 'report', id: t.report_id, need: 'view', action: false, where, optional: true }
    case 'table': return { kind: 'data_table', id: t.table_id, need: 'view', action: false, where, optional: true }
    default: return null
  }
}

/** Every leaf entry of a menu (groups and sub-groups flattened), with its path for messages. */
export function menuLeaves(menu: readonly AppMenuItem[]): Array<{ item: AppMenuLeaf; path: string }> {
  const out: Array<{ item: AppMenuLeaf; path: string }> = []
  const label = (m: { label?: string }) => m.label ?? ''
  for (const m of menu) {
    if (m.kind !== 'group') { out.push({ item: m, path: label(m) }); continue }
    for (const i of m.items) {
      if (i.kind !== 'group') { out.push({ item: i, path: `${m.label} › ${label(i)}` }); continue }
      for (const j of i.items) out.push({ item: j, path: `${m.label} › ${i.label} › ${label(j)}` })
    }
  }
  return out
}

/** The object a menu entry (app menu or nav bar) uses. */
export function leafBinding(item: AppMenuLeaf, where: string): { object?: BoundObject; source?: BoundSource } {
  switch (item.kind) {
    case 'form': return { object: { kind: 'form', id: item.form_id, need: 'submit', action: true, where } }
    case 'workflow': return { object: { kind: 'workflow', id: item.workflow_id, need: 'start', action: true, where } }
    case 'report': return { object: { kind: 'report', id: item.report_id, need: 'view', action: false, where } }
    case 'record': return { object: { kind: 'data_table', id: item.table_id, need: item.row_id ? 'view' : 'edit', action: !item.row_id, where } }
    case 'tasks': return { source: { source: 'tasks', where } }
    default: return {}
  }
}

export function menuBindings(menu: readonly AppMenuItem[], prefix = 'Menu'): BoundObject[] {
  return menuLeaves(menu).flatMap(({ item, path }) => { const b = leafBinding(item, `${prefix}: ${path}`); return b.object ? [b.object] : [] })
}

/**
 * The object an app rule action uses (null: none). Rule actions are
 * optional bindings: a viewer who can't use one gets that action replaced
 * by a no-op (presentRules), the rest of the rule still runs; the server
 * endpoint re-checks every server action anyway.
 */
export function ruleActionBinding(a: RuleAction, where: string): BoundObject | null {
  switch (a.type) {
    case 'open_target':
      switch (a.target.kind) {
        case 'form': return { kind: 'form', id: a.target.form_id, need: 'submit', action: true, where, optional: true }
        case 'workflow': return { kind: 'workflow', id: a.target.workflow_id, need: 'start', action: true, where, optional: true }
        case 'report': return { kind: 'report', id: a.target.report_id, need: 'view', action: false, where, optional: true }
        case 'record': return { kind: 'data_table', id: a.target.table_id, need: a.target.row_id ? 'view' : 'edit', action: !a.target.row_id, where, optional: true }
        default: return null
      }
    case 'download_report': return { kind: 'report', id: a.report_id, need: 'view', action: false, where, optional: true }
    case 'call_reference': return { kind: 'reference', id: a.reference_id, need: 'view', action: false, where, optional: true, viewersAllowed: a.allow_viewers }
    case 'table_lookup': return { kind: 'data_table', id: a.table_id, need: 'view', action: false, where, optional: true }
    case 'table_create': case 'table_update': return { kind: 'data_table', id: a.table_id, need: 'edit', action: true, where, optional: true }
    case 'start_workflow': return { kind: 'workflow', id: a.workflow_id, need: 'start', action: true, where, optional: true }
    default: return null
  }
}

/** Every object a list of rules uses. */
export function ruleBindings(rules: readonly AppRule[] | undefined, prefix: string): BoundObject[] {
  const out: BoundObject[] = []
  for (const r of rules ?? []) for (const { path, action } of ruleActions(r)) {
    const b = ruleActionBinding(action, `${prefix} › rule “${r.name || r.id}” (${path})`)
    if (b) out.push(b)
  }
  return out
}

/** May this viewer use this rule action? Viewers never get actions that submit, start or write. */
export function ruleActionAllowed(a: RuleAction, facts: ObjectFacts, role: 'editor' | AppRole): boolean {
  if (role === 'viewer' && WRITE_ACTIONS.has(a.type)) return false
  const b = ruleActionBinding(a, '')
  if (!b) return true
  if (b.action && role === 'viewer') return false
  return objectAllowed(facts, b.kind, b.id, b.need, { viewersAllowed: b.viewersAllowed }).allowed
}

/** Rules as this viewer may run them: actions they can't use become no-ops (positions kept, so the server finds actions by path). */
export function presentRules(rules: readonly AppRule[] | undefined, facts: ObjectFacts, role: 'editor' | AppRole): AppRule[] {
  const noop = { type: 'noop' as const, note: 'Not available to you' }
  const fix = <T extends RuleAction>(a: T): T => (ruleActionAllowed(a, facts, role) ? a : (noop as unknown as T))
  return (rules ?? []).map((r) => ({
    ...r,
    then: r.then.map((a) => (a.type === 'confirm' ? { ...a, then: a.then.map(fix), else: a.else.map(fix) } : fix(a))),
    on_error_actions: r.on_error_actions.map(fix),
  }))
}

/** Everything an app's pages, menu and rules point at. */
export function appBindings(pages: ReadonlyArray<{ title: string; layout: PageLayout }>, menu: readonly AppMenuItem[], appRules: readonly AppRule[] = []): { objects: BoundObject[]; sources: BoundSource[] } {
  const objects: BoundObject[] = [...menuBindings(menu), ...ruleBindings(appRules, 'App rules')]
  const sources: BoundSource[] = []
  for (const page of pages) {
    objects.push(...ruleBindings(page.layout.rules, page.title))
    for (const w of page.layout.widgets) {
      const b = widgetBindings(w, `${page.title} › ${w.title || w.type.replace(/_/g, ' ')}`)
      objects.push(...b.objects)
      sources.push(...b.sources)
    }
  }
  return { objects, sources }
}

/** What one person may do with the objects in question, from their permissions, grants and the objects' facts. */
export interface ObjectFacts {
  can: (permission: string) => boolean
  /** Forms with a View or Submit grant naming the person, a team of theirs or a role they hold. */
  formGrants: ReadonlySet<string>
  /** Objects that exist in the workspace, by kind (agent / reference: when the page uses any). */
  exists: Readonly<Record<'form' | 'workflow' | 'data_table' | 'report', ReadonlySet<string>>> & Partial<Record<'agent' | 'reference', ReadonlySet<string>>>
  /** Reports the person may read (shared, or created by them). */
  visibleReports: ReadonlySet<string>
  /** Object names by `<kind>:<id>` (entries with a placeholder label show their target's name). */
  names?: ReadonlyMap<string, string>
}

export type Denial =
  | { allowed: true }
  | { allowed: false; missing: 'permission'; permission: string }
  | { allowed: false; missing: 'grant' }
  | { allowed: false; missing: 'shared' }
  | { allowed: false; missing: 'object' }
  | { allowed: false; missing: 'viewers' }

/** May the person use this object as `need` says? (the existing rules, listed above) */
export function objectAllowed(facts: ObjectFacts, kind: ObjectKind, id: string, need: Need, opts: { viewersAllowed?: boolean } = {}): Denial {
  if (!facts.exists[kind]?.has(id)) return { allowed: false, missing: 'object' }
  const perm = (p: string): Denial => (facts.can(p) ? { allowed: true } : { allowed: false, missing: 'permission', permission: p })
  switch (kind) {
    case 'form': {
      if (facts.can('forms.edit')) return { allowed: true }
      if (!facts.can('forms.submit')) return { allowed: false, missing: 'permission', permission: 'forms.submit' }
      return facts.formGrants.has(id) ? { allowed: true } : { allowed: false, missing: 'grant' }
    }
    case 'workflow': {
      const view = perm('workflows.view')
      if (!view.allowed) return view
      return need === 'start' ? perm('workflows.activate') : view
    }
    case 'data_table': {
      const view = perm('data.view')
      if (!view.allowed) return view
      return need === 'edit' ? perm('data.manage_rows') : view
    }
    case 'report': {
      const view = perm('reports.view')
      if (!view.allowed) return view
      return facts.visibleReports.has(id) ? { allowed: true } : { allowed: false, missing: 'shared' }
    }
    case 'agent': {
      const view = perm('agents.view')
      if (!view.allowed) return view
      return need === 'use' ? perm('agents.test') : view
    }
    case 'reference':
      // Runs with the workspace's connection: people with integration access, or app viewers when a designer allowed it.
      if (facts.can('integrations.view')) return { allowed: true }
      return opts.viewersAllowed ? { allowed: true } : { allowed: false, missing: 'viewers' }
  }
}

export function sourceAllowed(facts: Pick<ObjectFacts, 'can'>, source: Source): Denial {
  if (source === 'tasks') return facts.can('tasks.view_own') || facts.can('tasks.view_all') ? { allowed: true } : { allowed: false, missing: 'permission', permission: 'tasks.view_own' }
  if (source === 'org') return facts.can('org.view') ? { allowed: true } : { allowed: false, missing: 'permission', permission: 'org.view' }
  return facts.can('forms.submit') || facts.can('forms.edit') ? { allowed: true } : { allowed: false, missing: 'permission', permission: 'forms.submit' }
}

/** The viewer's teams and roles, for per-button / per-entry visibility rules. */
export interface Who { teamIds: readonly string[]; roleIds: readonly string[] }

/** Does a visibility rule let this viewer see the item? (app roles, then teams / roles; empty lists = everyone) */
export function visibleTo(v: Visibility | null | undefined, role: 'editor' | AppRole, who?: Who): boolean {
  if (!v) return true
  if (v.app_roles.length && !v.app_roles.includes(role)) return false
  if (role === 'editor') return true
  if (!v.teams.length && !v.roles.length) return true
  if (!who) return false
  return v.teams.some((t) => who.teamIds.includes(t)) || v.roles.some((r) => who.roleIds.includes(r))
}

/** May this viewer use this action (button / tile)? Viewers never get actions that submit, start, claim or create. */
export function actionAllowed(a: AnyAction, facts: ObjectFacts, role: 'editor' | AppRole): boolean {
  const acts = role !== 'viewer'
  const b = actionBinding(a, '')
  if (b.source && (!acts || !sourceAllowed(facts, b.source.source).allowed)) return false
  if (!b.object) return true
  if (b.object.action && !acts) return false
  return objectAllowed(facts, b.object.kind, b.object.id, b.object.need).allowed
}

/**
 * The page as this viewer may see it: action buttons, tiles and menu forms
 * only for contributors / editors and only when the object allows; data
 * widgets only when their objects and sources allow; the Claim button,
 * Kanban drag and grid editing only for those who may act. Widgets left
 * with nothing to show are dropped; containers lose the children dropped.
 */
export function presentLayout(layout: PageLayout, facts: ObjectFacts, role: 'editor' | AppRole, who?: Who): PageLayout {
  const acts = role !== 'viewer'
  const widgets: AppWidget[] = []
  for (const widget of layout.widgets) {
    if (widget.type === 'actions') {
      const config = widget.config as WidgetConfig<'actions'>
      const buttons = config.buttons.filter((b) => visibleTo(b.visibility, role, who) && actionAllowed(b.action, facts, role))
        .map((b) => (isPlaceholderLabel(b.label) ? { ...b, label: displayActionLabel(b.label, b.action, labelContext(facts)) } : b))
      if (buttons.length) widgets.push({ ...widget, config: { ...config, buttons } })
      continue
    }
    if (widget.type === 'nav_bar') {
      const config = widget.config as WidgetConfig<'nav_bar'>
      widgets.push({ ...widget, config: { ...config, items: presentMenu(config.items, facts, role, who) } })
      continue
    }
    if (widget.type === 'tiles') {
      const config = widget.config as WidgetConfig<'tiles'>
      const tiles = config.tiles.filter((t) => actionAllowed(t.action, facts, role))
        .map((t) => (isPlaceholderLabel(t.label) ? { ...t, label: displayActionLabel(t.label, t.action, labelContext(facts)) } : t))
      if (tiles.length) widgets.push({ ...widget, config: { ...config, tiles } })
      continue
    }
    const { objects, sources } = widgetBindings(widget)
    const required = objects.filter((o) => !o.optional)
    if (required.some((o) => o.action && !acts)) {
      // Action-only widgets (form embed, start workflow, agent chat) for a viewer: hidden, or the form embed's notice.
      if (widget.type === 'form_embed' && (widget.config as WidgetConfig<'form_embed'>).unavailable === 'notice') widgets.push({ ...widget, config: { ...(widget.config as WidgetConfig<'form_embed'>), form_id: null } })
      continue
    }
    if (!required.every((o) => objectAllowed(facts, o.kind, o.id, o.need, { viewersAllowed: o.viewersAllowed }).allowed)) {
      if (widget.type === 'form_embed' && (widget.config as WidgetConfig<'form_embed'>).unavailable === 'notice') widgets.push({ ...widget, config: { ...(widget.config as WidgetConfig<'form_embed'>), form_id: null } })
      continue
    }
    if (!sources.every((s) => sourceAllowed(facts, s.source).allowed)) continue
    const optionalOk = (o: BoundObject) => acts && objectAllowed(facts, o.kind, o.id, o.need).allowed
    switch (widget.type) {
      case 'task_list':
        widgets.push(acts ? widget : { ...widget, config: { ...(widget.config as WidgetConfig<'task_list'>), show_claim: false } })
        continue
      case 'kanban': {
        const c = widget.config as WidgetConfig<'kanban'>
        const edit = objects.find((o) => o.need === 'edit')
        const may = c.source === 'table' ? !!edit && optionalOk(edit) : acts && facts.can('tasks.complete')
        widgets.push(may ? widget : { ...widget, config: { ...c, allow_drag: false } })
        continue
      }
      case 'data_grid': {
        const c = widget.config as WidgetConfig<'data_grid'>
        const edit = objects.find((o) => o.need === 'edit')
        // Editing cells and deleting rows need Manage rows on the table and an acting app role.
        const may = !!edit && optionalOk(edit)
        widgets.push((c.editable || c.allow_delete) && !may ? { ...widget, config: { ...c, ...(c.editable ? { editable: false } : {}), ...(c.allow_delete ? { allow_delete: false } : {}) } } : widget)
        continue
      }
      case 'tabs': {
        // Tabs whose target the viewer can't use are hidden; viewers get no form tabs.
        const c = widget.config as WidgetConfig<'tabs'>
        const tabs = c.tabs.filter((t) => { const b = tabBinding(t.target, ''); return !b || ((!b.action || acts) && objectAllowed(facts, b.kind, b.id, b.need).allowed) })
        if (tabs.length) widgets.push({ ...widget, config: { ...c, tabs } })
        continue
      }
      case 'card_view': {
        const c = widget.config as WidgetConfig<'card_view'>
        const actions = c.actions.filter((a) => {
          if (a.kind === 'start_workflow') return optionalOk({ kind: 'workflow', id: a.workflow_id, need: 'start', action: true, where: '' })
          if (a.kind === 'open_form') return optionalOk({ kind: 'form', id: a.form_id, need: 'submit', action: true, where: '' })
          return true
        })
        widgets.push({ ...widget, config: { ...c, actions } })
        continue
      }
    }
    widgets.push(widget)
  }
  // Containers keep only the children still on the page.
  const kept = new Set(widgets.map((w) => w.id))
  return {
    ...(layout.options ? { options: layout.options } : {}),
    ...(layout.params ? { params: layout.params } : {}),
    ...(layout.variables ? { variables: layout.variables } : {}),
    ...(layout.rules ? { rules: presentRules(layout.rules, facts, role) } : {}),
    widgets: widgets.map((w) => {
      if (w.type === 'tabs') {
        const c = w.config as WidgetConfig<'tabs'>
        return { ...w, config: { ...c, tabs: c.tabs.map((t) => ({ ...t, widgets: t.widgets.filter((id) => kept.has(id)) })) } }
      }
      if (w.type === 'section') {
        const c = w.config as WidgetConfig<'section'>
        return { ...w, config: { ...c, widgets: c.widgets.filter((id) => kept.has(id)) } }
      }
      return w
    }),
  }
}

/** The menu as this viewer may use it: entries whose object they can't use, or whose visibility rule excludes them, are dropped; empty groups, stray dividers and headings with nothing under them too. Shared by the app menu and the nav bar widget. */
export function presentMenu(menu: readonly AppMenuItem[], facts: ObjectFacts, role: 'editor' | AppRole, who?: Who): AppMenuItem[] {
  const leafOk = (m: AppMenuLeaf): boolean => {
    if (m.kind === 'divider' || m.kind === 'heading') return true
    if (!visibleTo(m.visibility, role, who)) return false
    const b = leafBinding(m, '')
    if (b.source && !sourceAllowed(facts, b.source.source).allowed) return false
    if (!b.object) return true
    if (b.object.action && role === 'viewer') return false
    return objectAllowed(facts, b.object.kind, b.object.id, b.object.need).allowed
  }
  const real = (items: ReadonlyArray<{ kind: string }>) => items.some((i) => i.kind !== 'divider' && i.kind !== 'heading')
  const tidy = <T extends { kind: string }>(items: T[]): T[] => {
    const out = items.filter((m, i, all) => m.kind !== 'divider' || (i > 0 && i < all.length - 1 && all[i - 1].kind !== 'divider'))
    // A heading followed by nothing (or another heading / divider) has nothing under it.
    return out.filter((m, i, all) => m.kind !== 'heading' || (i < all.length - 1 && all[i + 1].kind !== 'heading' && all[i + 1].kind !== 'divider'))
  }
  const out: AppMenuItem[] = []
  for (const m of menu) {
    if (m.kind === 'group') {
      if (!visibleTo(m.visibility, role, who)) continue
      type GroupItem = (typeof m.items)[number]
      const items = tidy(m.items.flatMap((i): GroupItem[] => {
        if (i.kind !== 'group') return leafOk(i) ? [i] : []
        if (!visibleTo(i.visibility, role, who)) return []
        const sub = tidy(i.items.filter(leafOk))
        return real(sub) ? [{ ...i, items: sub }] : []
      }))
      if (real(items)) out.push({ ...m, items })
      continue
    }
    if (leafOk(m)) out.push(m)
  }
  return resolveMenuLabels(tidy(out), labelContext(facts))
}

/** Names the viewer may see, for placeholder labels (lib/apps/labels.ts). */
function labelContext(facts: ObjectFacts): LabelContext {
  return { name: (kind, id) => facts.names?.get(`${kind}:${id}`) ?? null }
}

/** Every object id a layout and menu refer to, by kind (for loading facts). */
export function referencedIds(layouts: readonly PageLayout[], menu: readonly AppMenuItem[], appRules: readonly AppRule[] = []): Record<ObjectKind, string[]> {
  const out = Object.fromEntries(OBJECT_KINDS.map((k) => [k, new Set<string>()])) as Record<ObjectKind, Set<string>>
  for (const o of menuBindings(menu)) out[o.kind].add(o.id)
  for (const o of ruleBindings(appRules, '')) out[o.kind].add(o.id)
  for (const layout of layouts) for (const o of ruleBindings(layout.rules, '')) out[o.kind].add(o.id)
  for (const layout of layouts) for (const w of layout.widgets) for (const o of widgetBindings(w).objects) out[o.kind].add(o.id)
  return Object.fromEntries(OBJECT_KINDS.map((k) => [k, [...out[k]]])) as Record<ObjectKind, string[]>
}

/** Plain-language need and missing piece, for the access issues list. */
export const PERMISSION_LABELS: Record<string, string> = {
  'forms.submit': 'Submit forms', 'forms.edit': 'Edit forms', 'workflows.view': 'View workflows', 'workflows.activate': 'Start workflows',
  'data.view': 'View data', 'data.manage_rows': 'Manage rows', 'reports.view': 'View reports', 'tasks.view_own': 'View own tasks',
  'agents.view': 'View agents', 'agents.test': 'Run agents', 'integrations.view': 'View integrations', 'org.view': 'View org chart',
}
export const NEED_LABELS: Record<Need, string> = { submit: 'submit', start: 'start', view: 'see', edit: 'edit rows of', use: 'chat with' }

/** Every place an app hands parameters to a form (form widget, buttons, tiles, tab targets, card actions, menu / nav entries), for the builder's "required parameter not passed" warnings. */
export function formParamUses(pages: ReadonlyArray<{ title: string; layout: PageLayout }>, menu: readonly AppMenuItem[], appRules: readonly AppRule[] = []): Array<{ form: string; params: ParamMap | undefined; where: string }> {
  const out: Array<{ form: string; params: ParamMap | undefined; where: string }> = []
  const fromLeaves = (items: readonly AppMenuItem[], prefix: string) => {
    for (const { item, path } of menuLeaves(items)) if (item.kind === 'form') out.push({ form: item.form_id, params: item.params, where: `${prefix}: ${path}` })
  }
  fromLeaves(menu, 'Menu')
  const fromRules = (rules: readonly AppRule[] | undefined, prefix: string) => {
    for (const r of rules ?? []) for (const { path, action } of ruleActions(r)) if (action.type === 'open_target' && action.target.kind === 'form') out.push({ form: action.target.form_id, params: action.target.params, where: `${prefix} › rule “${r.name || r.id}” (${path})` })
  }
  fromRules(appRules, 'App rules')
  for (const page of pages) {
    fromRules(page.layout.rules, page.title)
    for (const w of page.layout.widgets) {
      const where = `${page.title} › ${w.title || w.type.replace(/_/g, ' ')}`
      const c = w.config as Record<string, any>
      if (w.type === 'form_embed' && literalId(c.form_id)) out.push({ form: c.form_id, params: c.params, where })
      if (w.type === 'actions') for (const b of c.buttons) if (b.action.kind === 'new_submission') out.push({ form: b.action.form_id, params: b.action.params, where: `${where}: ${b.label}` })
      if (w.type === 'tiles') for (const t of c.tiles) if (t.action.kind === 'new_submission') out.push({ form: t.action.form_id, params: t.action.params, where: `${where}: ${t.label}` })
      if (w.type === 'tabs') for (const t of c.tabs) if (t.target?.kind === 'form') out.push({ form: t.target.form_id, params: t.target.params, where: `${where}: ${t.label}` })
      if (w.type === 'card_view') for (const a of c.actions) if (a.kind === 'open_form') out.push({ form: a.form_id, params: { ...(a.params ?? {}), ...Object.fromEntries((a.prefill ?? []).map((p: { field: string; key: string }) => [p.field, { from: 'event', key: p.key }])) }, where: `${where}: ${a.label}` })
      if (w.type === 'nav_bar') fromLeaves(c.items, where)
    }
  }
  return out
}
