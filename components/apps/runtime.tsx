"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { serverQuery } from "@/lib/server-read"
import { runAppRuleActionAction } from "@/app/actions/apps"
import { encodeEventValue, type AppEvent } from "@/lib/apps/events"
import { resolveParams } from "@/lib/apps/params"
import { decodeFilterValue, filterParam, type FilterValues } from "@/lib/apps/widgets"
import { APP_RULE_LIMITS, listens as rulesListen, runRules, timerRules, type AppRule, type DebugEntry, type LeafAction, type RuleAction, type RuleEvent, type RuleTrigger } from "@/lib/apps/rules"
import {
  coerceValue, encodeValue, initialVariables, isTemplate, paramsFromQuery, resolveParamValues, resolveTemplate, systemVariables, templateText, urlVariablesFromQuery, varKey,
  type AppScope, type ParamProblem, type TypedValue, type Viewer,
} from "@/lib/apps/variables"
import type { AppDetail, AppPage, OpenMode, PageFilter } from "@/lib/apps/schema"
import type { PanelTarget } from "@/lib/apps/panels"
import { useOpenTarget, type OpenHooks } from "./panels"
import { downloadReportCsv } from "./widgets/kit"
import { previewArgsOf } from "@/lib/apps/versions"

/**
 * The page runtime of app parameters, variables, system variables and app
 * rules (lib/apps/variables.ts, lib/apps/rules.ts):
 *
 *  - parameters: the app's and the page's, from the URL (?p.<name>=) — or,
 *    for a page opened in a panel, from the opener — typed and validated;
 *  - variables: app variables live for the session (sessionStorage, across
 *    pages); page variables in memory, or in the URL (?v.<name>=) when
 *    declared `url`;
 *  - system variables: the viewer (apps.viewer), dates in their timezone,
 *    workspace, app, page, URL, device, app role;
 *  - widget state: hidden widgets, disabled buttons, last clicked row / card /
 *    segment / tab per widget ({{widget.<id>.selected}}, .tab, .value);
 *  - rules: app rules then page rules, run for every event a widget raises
 *    (useAppDispatch), for filter / parameter / variable changes, page load,
 *    timers (only while the page is visible), forms submitted and panels
 *    closed from targets the app opened; browser actions run here, server
 *    actions through the app actions endpoint (server action
 *    runAppRuleActionAction → lib/services/app-rule-actions.ts);
 *  - a debug log (the builder's rule debug panel).
 */

export interface AppRuntime {
  scope: AppScope
  getScope: () => AppScope
  /** Filter values with template defaults resolved. */
  filters: FilterValues
  hidden: ReadonlySet<string>
  disabled: ReadonlyMap<string, ReadonlySet<number> | "all">
  listens: (type: RuleTrigger, widget?: string | null) => boolean
  /** A widget event (after the widget's own actions ran). */
  raiseWidgetEvent: (event: AppEvent) => void
  raise: (event: RuleEvent) => Promise<void>
  /** Set a variable from outside rules (widgets); raises "variable changed". */
  setVariable: (name: string, value: unknown) => string | null
  /** Hooks for targets the app opens (form submitted / panel closed rules). */
  openHooks: OpenHooks
  debug: DebugEntry[]
  clearDebug: () => void
  problems: ParamProblem[]
  rules: AppRule[]
}

const RuntimeContext = createContext<AppRuntime | null>(null)
export const useAppRuntime = () => useContext(RuntimeContext)

const appVarStore = new Map<string, Record<string, TypedValue>>()
const storeKey = (app: string) => `ut:apps:vars:${app}`
function loadAppVars(app: string): Record<string, TypedValue> | null {
  if (appVarStore.has(app)) return appVarStore.get(app)!
  try { const raw = window.sessionStorage.getItem(storeKey(app)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function saveAppVars(app: string, v: Record<string, TypedValue>) {
  appVarStore.set(app, v)
  try { window.sessionStorage.setItem(storeKey(app), JSON.stringify(v)) } catch { /* storage unavailable */ }
}

function useMobile(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const q = window.matchMedia("(max-width: 640px)")
    const u = () => setM(q.matches)
    u(); q.addEventListener("change", u)
    return () => q.removeEventListener("change", u)
  }, [])
  return m
}

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))
const stringRecord = (o: unknown): Record<string, string> => Object.fromEntries(Object.entries((o && typeof o === "object" ? o : {}) as Record<string, unknown>).map(([k, v]) => [k, text(v)]))

/** An app event (lib/apps/events.ts) → the rule event it triggers. */
export function ruleEventOf(e: AppEvent): RuleEvent {
  switch (e.type) {
    case "row_click": return { type: "row_click", widget: e.widget, payload: { widget: e.widget, value: e.value === null ? null : encodeEventValue(e.value), row: e.row ?? {} } }
    case "card_click": return { type: "card_click", widget: e.widget, payload: { widget: e.widget, value: e.value === null ? null : encodeEventValue(e.value), card: e.card ?? {}, row: e.card ?? {} } }
    case "segment_click": return { type: "segment_click", widget: e.widget, payload: { widget: e.widget, value: e.value === null ? null : encodeEventValue(e.value) } }
    case "button_click": return { type: "button_click", widget: e.widget, button: e.index, payload: { widget: e.widget, index: e.index, label: e.label } }
    case "form_submitted": return { type: "form_submitted", widget: e.widget, form_id: e.form, payload: { widget: e.widget, form_id: e.form, submission_id: e.submission_id ?? null, values: e.values ?? {} } }
    case "tab_changed": return { type: "tab_changed", widget: e.widget, payload: { widget: e.widget, tab: e.tab } }
    case "filter_changed": return { type: "filter_changed", filter: e.filter, payload: { filter: e.filter, value: e.value === null ? null : encodeEventValue(e.value) } }
  }
}

export function AppRuntimeProvider({ app, page, values, setValue, preview = false, given, embed = false, base = "/apps", children }: {
  app: AppDetail
  page: AppPage
  values: FilterValues
  setValue?: (id: string, v: FilterValues[string]) => void
  preview?: boolean
  /** A page opened in a panel: its parameters from the opener (else the URL's ?p.<name>=). */
  given?: Record<string, string> | null
  embed?: boolean
  base?: string
  children: (rt: AppRuntime) => ReactNode
}) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const client = useQueryClient()
  const opener = useOpenTarget()
  const mobile = useMobile()
  const inPanel = !!given
  const appParams = useMemo(() => app.params ?? [], [app.params])
  const pageParams = useMemo(() => page.layout.params ?? [], [page.layout.params])
  const pageVarDecls = useMemo(() => page.layout.variables ?? [], [page.layout.variables])
  const appVarDecls = useMemo(() => app.variables ?? [], [app.variables])
  const rules = useMemo(() => [...(app.rules ?? []), ...(page.layout.rules ?? [])], [app.rules, page.layout.rules])
  const pageRuleIds = useMemo(() => new Set((page.layout.rules ?? []).map((r) => r.id)), [page.layout.rules])

  const viewerQ = useQuery({
    queryKey: ["apps", "viewer", app.id],
    queryFn: async () => (await serverQuery("apps.viewer", { app: app.id })) as { user: Viewer; workspace: { id: string; name: string | null } },
    staleTime: 300_000, retry: false,
  })
  const query = useMemo(() => Object.fromEntries([...sp.entries()].filter(([k]) => !k.startsWith("f.") && !k.startsWith("v.") && k !== "panel" && k !== "edit").map(([k, v]) => [k, v.slice(0, 400)])), [sp])
  const sys = useMemo(() => systemVariables({
    user: viewerQ.data?.user ?? null, workspace: viewerQ.data?.workspace ?? null,
    app: { id: app.id, slug: app.slug, name: app.name }, page: { id: page.id, slug: page.slug, name: page.title },
    query, mobile, app_role: app.app_role,
  }), [viewerQ.data, app.id, app.slug, app.name, page.id, page.slug, page.title, query, mobile, app.app_role])

  // Parameters: declared names only, typed.
  const givenParams = useMemo(() => (given ? { ...given } : paramsFromQuery([...appParams, ...pageParams], (k) => sp.get(k))), [given, sp, appParams, pageParams])
  const baseScope = useMemo<AppScope>(() => ({ param: {}, var: {}, sys, filter: {} }), [sys])
  const { values: paramValues, problems } = useMemo(() => resolveParamValues([...appParams, ...pageParams], givenParams, baseScope), [appParams, pageParams, givenParams, baseScope])

  // Variables.
  const [appVars, setAppVars] = useState<Record<string, TypedValue>>(() => ({ ...initialVariables(appVarDecls, baseScope), ...(typeof window !== "undefined" ? loadAppVars(app.id) ?? {} : {}) }))
  const [pageVars, setPageVars] = useState<Record<string, TypedValue>>(() => ({ ...initialVariables(pageVarDecls, { ...baseScope, param: paramValues }), ...(inPanel ? {} : urlVariablesFromQuery(pageVarDecls, (k) => sp.get(k))) }))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [disabled, setDisabled] = useState<Map<string, Set<number> | "all">>(new Map())
  const [widgetState, setWidgetState] = useState<Record<string, Record<string, unknown>>>({})
  const [debug, setDebug] = useState<DebugEntry[]>([])
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; resolve: (ok: boolean) => void } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: string } | null>(null)

  // Filters: template defaults resolved against params / variables / system.
  const filters = useMemo<FilterValues>(() => {
    const s: AppScope = { param: paramValues, var: { ...appVars, ...pageVars }, sys, filter: {} }
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, isTemplate(v) ? (templateText(v, s) || null) : v]))
  }, [values, paramValues, appVars, pageVars, sys])

  const scope = useMemo<AppScope>(() => ({ param: paramValues, var: { ...appVars, ...pageVars }, sys, filter: filters as Record<string, unknown>, widget: widgetState }), [paramValues, appVars, pageVars, sys, filters, widgetState])
  const scopeRef = useRef(scope)
  const varsRef = useRef({ app: appVars, page: pageVars })
  useEffect(() => { scopeRef.current = scope; varsRef.current = { app: appVars, page: pageVars } })
  const getScope = useCallback(() => scopeRef.current, [])

  const log = useCallback((e: DebugEntry) => setDebug((d) => [...d, e].slice(-APP_RULE_LIMITS.debug)), [])

  /** Set a variable synchronously in the ref (later actions read it) and in state. */
  const assign = useCallback((name: string, value: unknown): { changed: boolean; previous?: unknown; error?: string } => {
    const pageDecl = pageVarDecls.find((d) => d.name === name)
    const decl = pageDecl ?? appVarDecls.find((d) => d.name === name)
    if (!decl) return { changed: false, error: `Unknown variable “${name}” (declare it on the page or the app)` }
    const typed = coerceValue(decl.type, value)
    if (typed === undefined) return { changed: false, error: `“${text(value).slice(0, 40)}” is not a valid ${decl.type} for ${name}` }
    const cur = varsRef.current
    const previous = pageDecl ? cur.page[name] : cur.app[name]
    if (JSON.stringify(previous ?? null) === JSON.stringify(typed ?? null)) return { changed: false, previous }
    if (pageDecl) {
      const next = { ...cur.page, [name]: typed }
      varsRef.current = { ...cur, page: next }
      setPageVars(next)
    } else {
      const next = { ...cur.app, [name]: typed }
      varsRef.current = { ...cur, app: next }
      setAppVars(next)
      saveAppVars(app.id, next)
    }
    scopeRef.current = { ...scopeRef.current, var: { ...varsRef.current.app, ...varsRef.current.page } }
    return { changed: true, previous }
  }, [pageVarDecls, appVarDecls, app.id])

  // URL-persisted page variables.
  useEffect(() => {
    if (inPanel || preview) return
    const shared = pageVarDecls.filter((d) => d.url)
    if (!shared.length) return
    const next = new URLSearchParams(sp.toString())
    let changed = false
    for (const d of shared) {
      const v = encodeValue(pageVars[d.name])
      if ((next.get(varKey(d.name)) ?? "") !== v) { changed = true; if (v) next.set(varKey(d.name), v.slice(0, 2000)); else next.delete(varKey(d.name)) }
    }
    if (changed) router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [pageVars]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hooks for targets the app opens: stable, calling the latest raise (set in an effect below).
  const raiseRef = useRef<(e: RuleEvent) => Promise<void>>(async () => {})
  const openHooks = useMemo<OpenHooks>(() => ({
    onSubmitted: (r) => { void raiseRef.current({ type: "form_submitted", form_id: r.form_id, payload: { form_id: r.form_id, submission_id: r.submission_id, values: r.values } }) },
    onClosed: (t) => { void raiseRef.current({ type: "panel_closed", payload: { kind: t.t, id: t.t === "page" ? t.slug : t.t === "record" ? t.table : t.id } }) },
  }), [])
  const runClient = useCallback(async (action: LeafAction | Extract<RuleAction, { type: "confirm" }>, s: AppScope): Promise<unknown> => {
    const tpl = (t: string | null | undefined) => (t ? resolveTemplate(t, s) : null)
    const ctxFor = () => ({ filters: s.filter as Record<string, unknown>, scope: s, event: stringRecord((s.event as Record<string, unknown> | undefined)?.row ?? (s.event as Record<string, unknown> | undefined)?.card ?? {}) })
    switch (action.type) {
      case "noop": return null
      case "set_filter": {
        const def = page.filters.find((f) => f.id === action.filter) as PageFilter | undefined
        if (!def) throw new Error(`No filter ${action.filter} on this page`)
        const v = decodeFilterValue(def.kind, text(tpl(action.value)))
        setValue?.(action.filter, v)
        return v
      }
      case "clear_filters":
        for (const f of page.filters) if (!action.filters.length || action.filters.includes(f.id)) setValue?.(f.id, null)
        return null
      case "open_target": {
        const t = action.target
        let target: PanelTarget
        const mode: OpenMode = (action.open_mode as OpenMode | null | undefined) ?? { mode: t.kind === "page" ? "navigate" : t.kind === "report" || t.kind === "record" ? "panel_right" : "modal", width: "md", motion: "auto" }
        if (t.kind === "url") {
          const url = text(tpl(t.url))
          if (!/^(https:\/\/|mailto:|\/(?!\/))/i.test(url)) throw new Error("Only https://, mailto: or /paths can be opened")
          if (mode.mode === "navigate" && url.startsWith("/")) router.push(url); else window.open(url, "_blank", "noopener,noreferrer")
          return url
        }
        if (t.kind === "form") target = { t: "form", id: t.form_id, params: resolveParams(t.params, ctxFor()) }
        else if (t.kind === "page") {
          const f = Object.fromEntries(Object.entries(t.filters ?? {}).map(([k, v]) => [k, text(tpl(v))]).filter(([, v]) => v))
          const p = resolveParams(t.params, ctxFor())
          target = { t: "page", slug: t.page_slug, ...(Object.keys(f).length ? { filters: f } : {}), ...(Object.keys(p).length ? { params: p } : {}) }
        } else if (t.kind === "report") target = { t: "report", id: t.report_id }
        else if (t.kind === "record") target = { t: "record", table: t.table_id, row: t.row_id ? text(tpl(t.row_id)) || null : null }
        else target = { t: "workflow", id: t.workflow_id }
        const m = embed && mode.mode === "navigate" ? { ...mode, mode: "tab" as const } : mode
        opener?.open(target, m, action.title ? text(tpl(action.title)) : undefined, openHooks)
        return target.t === "form" ? { form_id: target.id, params: target.params ?? {} } : target
      }
      case "close_panel": opener?.close?.(action.all); return null
      case "navigate": {
        const qs = new URLSearchParams([
          ...Object.entries(action.filters ?? {}).map(([k, v]) => [filterParam(k), text(tpl(v))] as [string, string]).filter(([, v]) => v),
          ...Object.entries(resolveParams(action.params, ctxFor())).map(([k, v]) => [`p.${k}`, v] as [string, string]),
        ]).toString()
        router.push(`${base}/${app.slug}/${action.page_slug}${qs ? `?${qs}` : ""}`)
        return null
      }
      case "refresh":
        if (!action.widgets.length) await client.invalidateQueries({ queryKey: ["apps", "widget", app.id] })
        else await Promise.all(action.widgets.map((w) => client.invalidateQueries({ predicate: (q) => q.queryKey[0] === "apps" && q.queryKey[1] === "widget" && q.queryKey[4] === w })))
        return null
      case "set_visibility":
        setHidden((h) => { const n = new Set(h); for (const w of action.widgets) { const hide = action.visible === "hide" || (action.visible === "toggle" && !n.has(w)); if (hide) n.add(w); else n.delete(w) } return n })
        return null
      case "set_enabled":
        setDisabled((d) => {
          const n = new Map(d)
          const cur = n.get(action.widget)
          if (action.button === null || action.button === undefined) { if (action.enabled) n.delete(action.widget); else n.set(action.widget, "all"); return n }
          const set = new Set(cur === "all" || !cur ? [] : cur)
          if (action.enabled) set.delete(action.button); else set.add(action.button)
          if (set.size) n.set(action.widget, set); else n.delete(action.widget)
          return n
        })
        return null
      case "message": {
        const msg = templateText(action.text, s)
        setToast({ text: msg, tone: action.tone })
        return msg
      }
      case "confirm":
        return new Promise<boolean>((resolve) => setConfirm({ title: templateText(action.title, s), message: templateText(action.message, s), label: action.confirm_label || "Continue", resolve }))
      case "copy": {
        const t = templateText(action.text, s)
        try { await navigator.clipboard?.writeText(t) } catch { /* clipboard permission */ }
        setToast({ text: "Copied.", tone: "success" })
        return t
      }
      case "download_report": await downloadReportCsv(action.report_id, "report"); return null
      default: throw new Error(`${action.type} runs on the server`)
    }
  }, [page.filters, setValue, router, opener, embed, base, app.slug, app.id, client, openHooks])

  const runServer = useCallback(async (rule: AppRule, path: string, slots: Record<string, string>): Promise<unknown> => {
    if (preview) throw new Error("Server actions run from the saved page — save, then try it on the page")
    const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    // Editors previewing the draft run the draft's rule; everyone else the published one.
    const args = previewArgsOf(app)
    const r = await runAppRuleActionAction(app.id, { page: pageRuleIds.has(rule.id) ? page.id : null, rule_id: rule.id, path, values: slots, idempotency_key: key, ...(args.draft || args.as_role ? { preview: args } : {}) })
    if (!r.ok) throw new Error(r.error)
    return (r.data as { result: unknown }).result
  }, [preview, app, page.id, pageRuleIds])

  const env = useMemo(() => ({ scope: getScope, setVariable: assign, runClient, runServer, log }), [getScope, assign, runClient, runServer, log])
  const raise = useCallback(async (event: RuleEvent) => { await runRules(rules, event, env) }, [rules, env])

  useEffect(() => { raiseRef.current = raise }, [raise])

  const raiseWidgetEvent = useCallback((e: AppEvent) => {
    if (e.type === "row_click" || e.type === "card_click" || e.type === "segment_click" || e.type === "tab_changed") {
      const v = e.type === "tab_changed" ? { tab: e.tab } : { value: e.value === null ? null : encodeEventValue(e.value), selected: e.type === "row_click" ? e.row ?? null : e.type === "card_click" ? e.card ?? null : null }
      setWidgetState((w) => ({ ...w, [e.widget]: { ...(w[e.widget] ?? {}), ...v } }))
      scopeRef.current = { ...scopeRef.current, widget: { ...(scopeRef.current.widget ?? {}), [e.widget]: { ...(scopeRef.current.widget?.[e.widget] ?? {}), ...v } } }
    }
    if (e.type === "filter_changed") return // raised from the filter values themselves
    void raise(ruleEventOf(e))
  }, [raise])

  const setVariable = useCallback((name: string, value: unknown) => {
    const r = assign(name, value)
    if (r.changed) void raise({ type: "variable_changed", variable: `var.${name}`, payload: { name, value, previous: r.previous ?? null } })
    return r.error ?? null
  }, [assign, raise])

  // Filter and parameter changes.
  const prevFilters = useRef<FilterValues | null>(null)
  useEffect(() => {
    const prev = prevFilters.current
    prevFilters.current = filters
    if (!prev) return
    for (const k of new Set([...Object.keys(prev), ...Object.keys(filters)])) {
      if (JSON.stringify(prev[k] ?? null) === JSON.stringify(filters[k] ?? null)) continue
      const enc = (v: FilterValues[string]) => (v === null || v === undefined ? null : encodeEventValue(v))
      void raise({ type: "filter_changed", filter: k, payload: { filter: k, value: enc(filters[k]), previous: enc(prev[k]) } })
    }
  }, [filters, raise])
  const prevParams = useRef<Record<string, TypedValue> | null>(null)
  useEffect(() => {
    const prev = prevParams.current
    prevParams.current = paramValues
    if (!prev) return
    for (const k of Object.keys(paramValues)) {
      if (JSON.stringify(prev[k] ?? null) === JSON.stringify(paramValues[k] ?? null)) continue
      void raise({ type: "variable_changed", variable: `param.${k}`, payload: { name: k, value: paramValues[k], previous: prev[k] ?? null } })
    }
  }, [paramValues, raise])

  // Page loaded: once, after the viewer's profile (system variables) settles.
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current || viewerQ.isPending) return
    loaded.current = true
    void raise({ type: "page_loaded", payload: { page: page.slug } })
  }, [viewerQ.isPending, raise, page.slug])

  // Timers: bounded, only while the page is visible.
  useEffect(() => {
    const timers = timerRules(rules).map(({ rule, ms }) => setInterval(() => {
      if (document.visibilityState !== "visible") return
      void runRules([rule], { type: "timer", payload: { at: new Date().toISOString() } }, env)
    }, ms))
    return () => timers.forEach(clearInterval)
  }, [rules, env])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  const rt = useMemo<AppRuntime>(() => ({
    scope, getScope, filters, hidden, disabled, listens: (type, widget) => rulesListen(rules, type, widget), raiseWidgetEvent, raise, setVariable,
    openHooks, debug, clearDebug: () => setDebug([]), problems, rules,
  }), [scope, getScope, filters, hidden, disabled, rules, raiseWidgetEvent, raise, setVariable, openHooks, debug, problems])

  return (
    <RuntimeContext.Provider value={rt}>
      {problems.length > 0 && !preview && (
        <p role="alert" className="rounded-md border border-warning bg-warning-wash px-3 py-1.5 text-xs text-warning" data-param-problems>{problems.map((p) => p.message).join(" · ")}</p>
      )}
      {/* eslint-disable-next-line react-hooks/refs -- rt.getScope reads a ref, but only in event handlers and rule runs, never while rendering */}
      {children(rt)}
      {toast && (
        <div role="status" aria-live="polite" data-app-toast={toast.tone}
          className={`fixed bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-elev-3 ${toast.tone === "danger" ? "border-danger bg-danger-wash text-danger" : toast.tone === "warning" ? "border-warning bg-warning-wash text-warning" : toast.tone === "success" ? "border-success bg-success-wash text-success" : "border-border bg-elevated text-fg"}`}>
          {toast.text}
        </div>
      )}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => { if (!o && confirm) { confirm.resolve(false); setConfirm(null) } }}
        title={confirm?.title ?? ""} description={confirm?.message ?? ""} confirmLabel={confirm?.label ?? "Continue"}
        onConfirm={() => { confirm?.resolve(true); setConfirm(null) }} />
    </RuntimeContext.Provider>
  )
}
