'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { acceptFrameMessage, clampFrameHeight, hostMessage, newChannelId } from '@/lib/forms/custom-controls/bridge'
import { BRIDGE_LIMITS, CONTROL_EVENTS, REQUEST_CAPABILITY, THEME_TOKENS, type ControlCapability, type ControlRequestKind, type ControlState, type ControlTheme, type FrameMessage, type ThemeToken } from '@/lib/forms/custom-controls/contract'
import { bundleUrl, frameUrl } from '@/lib/forms/custom-controls/frame'
import { controlReportId, readableFileIds, setCustomControlValidity } from '@/lib/forms/custom-controls/field'
import { nativeCustomValue } from '@/lib/forms/custom-controls/output'
import { attachmentPath, trackAttachmentUpload, type AttachmentFile } from '@/lib/forms/attachments'
import { isDarkColor, parseColor } from '@/lib/theme/colors'
import { consistentThemeTokens, heightMemoryId, rememberHeight, rememberedHeight, reservedHeight } from '@/lib/forms/custom-controls/loading'
import { ControlSkeleton, useControlReady } from './control-ready'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isAnonymousSource, useFormLookupSource } from './lookup-field'

/**
 * A custom form control (web component) on a form. By default it runs in a
 * sandboxed iframe (`sandbox="allow-scripts"`, opaque origin, its own CSP —
 * lib/forms/custom-controls/frame.ts) and talks to the form only through the
 * typed postMessage bridge (lib/forms/custom-controls/bridge.ts): every
 * message is checked for source window, origin, channel, shape, size and
 * capability before it touches the form. Controls an instance admin marked
 * trusted render inline (Shadow DOM in the page) with the same contract.
 *
 * Native feel: the frame resizes to the control, Tab moves into and out of
 * it like any field, clicking the label focuses it, the field's label and
 * help text are its accessible name / description (frame title +
 * aria-describedby, and the `label` / `description` properties), and the
 * form theme's colours arrive as `--ut-*` tokens (re-sent when the theme or
 * light / dark mode changes).
 */

/** App CSS variables → control theme tokens (first one set wins): the same variables native inputs use. */
const TOKEN_SOURCES: Partial<Record<ThemeToken, string[]>> = {
  'ut-primary': ['--theme-primary'],
  'ut-on-primary': ['--theme-on-primary'],
  'ut-primary-text': ['--theme-primary-text'],
  'ut-primary-light': ['--theme-primary-light'],
  'ut-text': ['--theme-card-text'],
  'ut-muted-text': ['--theme-muted-text'],
  'ut-surface': ['--theme-surface'],
  'ut-card': ['--theme-card-bg'],
  'ut-border': ['--theme-input-border', '--theme-surface-border'],
  'ut-input-bg': ['--theme-input-bg', '--theme-topbar'],
  'ut-input-text': ['--theme-topbar-text', '--theme-card-text'],
  'ut-focus-ring': ['--theme-primary'],
  'ut-error': ['--status-blocked'],
  'ut-success': ['--status-done'],
  'ut-radius': ['--theme-input-radius', '--theme-border-radius'],
}

/** The frame's inner padding (lib/forms/custom-controls/frame.ts #ut-root). */
const FRAME_INSET = 4

function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function readTheme(el: HTMLElement | null): ControlTheme {
  const tokens: ControlTheme['tokens'] = {}
  if (!el || typeof window === 'undefined') return { mode: 'light', tokens }
  const style = getComputedStyle(el)
  for (const token of THEME_TOKENS) {
    for (const source of TOKEN_SOURCES[token] ?? []) {
      const value = style.getPropertyValue(source).trim()
      if (value) { tokens[token] = value; break }
    }
  }
  tokens['ut-radius'] ??= '8px'
  tokens['ut-font-family'] = style.fontFamily
  tokens['ut-font-size'] = '14px'
  const card = tokens['ut-card'] ?? ''
  const mode = card ? (isDarkColor(card) ? 'dark' : 'light') : (style.colorScheme === 'dark' ? 'dark' : 'light')
  // A dark form card in a light workspace (or the reverse): drop the workspace colours that contradict it.
  return consistentThemeTokens({ mode, tokens }, (c) => (parseColor(c) ? isDarkColor(c) : null))
}

/** Trusted (inline) flags of the controls on screen, one batched read per page. */
function useTrusted(tag: string): boolean {
  // Public form links (anonymous visitors) always use the sandboxed frame, never inline code.
  const anonymous = isAnonymousSource(useFormLookupSource())
  const { data } = useQuery({
    queryKey: ['form-control-runtime', tag],
    enabled: !anonymous,
    staleTime: 60_000,
    queryFn: async () => (await serverRead('forms.controlRuntime', { tags: [tag] })).data ?? [],
  })
  return !anonymous && Boolean(data?.find((r) => r.tag === tag)?.trusted)
}

export interface CustomControlFieldProps {
  field: TaskFieldDef
  value: unknown
  onChange: (value: unknown) => void
  /** Other form values (the control's declared context). */
  values: Record<string, unknown>
  id: string
  describedBy?: string
  invalid: boolean
  error?: string | null
  disabled?: boolean
  readOnly?: boolean
}

export function CustomControlField(props: CustomControlFieldProps) {
  const { field } = props
  const config = field.custom
  const trusted = useTrusted(config?.tag ?? '')
  if (!config) {
    return <ControlProblem message="This custom control is not configured — choose a control in the form designer." />
  }
  // A stored form holds the control's OUTPUT under its key (the value under `<key>_raw`): the
  // control is always given its own value (lib/forms/custom-controls/output.ts).
  const value = config.output ? nativeCustomValue(config, field.key, { ...props.values, [field.key]: props.value }) : props.value
  const given = value === props.value ? props : { ...props, value }
  return trusted ? <InlineControl {...given} /> : <FramedControl {...given} />
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]'

/** Move focus to the next / previous tab stop of the page after `from` (focus leaving a control frame). */
function focusBeside(from: HTMLElement, direction: 'forward' | 'backward') {
  const stops = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE))
    .filter((el) => el === from || (el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert],[aria-hidden="true"]')))
  const i = stops.indexOf(from)
  const target = i < 0 ? null : stops[direction === 'forward' ? i + 1 : i - 1]
  if (target) target.focus()
  else from.blur()
}

function ControlProblem({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs border-(--status-blocked) text-fg" role="alert">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-(--status-blocked)" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

/** Everything the control is told: value, flags, props, theme, context. */
function useControlState(props: CustomControlFieldProps, theme: ControlTheme): ControlState {
  const { field, value, values, invalid, error, disabled, readOnly } = props
  const config = field.custom!
  const source = useFormLookupSource()
  const contextFields = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const [name, key] of Object.entries(config.context_map ?? {})) out[name] = values[key] ?? null
    return out
  }, [config.context_map, values])
  const capabilities = useMemo<ControlCapability[]>(() => {
    // Public form links: no capabilities at all (no lookups, files, reports or network) for anonymous visitors.
    if (isAnonymousSource(source)) return []
    const caps = config.capabilities ?? []
    // Lookups need a configured source; uploads a place to upload to (not the designer preview); reports a chosen report.
    return caps.filter((c) => (c === 'lookup' ? Boolean(field.lookup) : c === 'files' ? Boolean(source && source.kind !== 'preview') : c === 'reports' ? Boolean(controlReportId(config)) : c === 'network'))
  }, [config, field.lookup, source])
  return useMemo(() => ({
    value: value ?? null,
    disabled: Boolean(disabled),
    readonly: Boolean(readOnly),
    required: Boolean(field.required),
    invalid,
    error: error ?? null,
    props: config.props ?? {},
    theme,
    locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
    context: {
      fields: contextFields,
      field_key: field.key,
      task_id: source?.kind === 'task' ? source.taskId : null,
      form_id: source?.kind === 'form' && !source.anonymous ? source.formId : null,
      workflow_id: null,
    },
    label: field.label,
    description: field.help_text ?? null,
    capabilities,
  }), [value, disabled, readOnly, field.required, field.key, field.label, field.help_text, invalid, error, config.props, theme, contextFields, source, capabilities])
}

/** The theme where the control sits, refreshed when the form's theme / mode changes. */
function useTheme(anchor: React.RefObject<HTMLElement | null>): ControlTheme {
  const [theme, setTheme] = useState<ControlTheme>({ mode: 'light', tokens: {} })
  // Layout effect: the first theme is read before the first paint (and before the frame is created).
  useLayoutEffect(() => {
    const update = () => setTheme((prev) => {
      const next = readTheme(anchor.current)
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
    })
    update()
    // Theme changes: the workspace theme / mode (root attributes) or a scope's variables (an ancestor's style).
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    let node = anchor.current?.parentElement ?? null
    for (let i = 0; node && i < 12; i++, node = node.parentElement) observer.observe(node, { attributes: true, attributeFilter: ['style', 'class'] })
    const timer = window.setInterval(update, 2000)
    return () => { observer.disconnect(); window.clearInterval(timer) }
  }, [anchor])
  return theme
}

/** Host services a control may request (capability-checked by the bridge first). */
function useRequestHandler(field: TaskFieldDef, values: Record<string, unknown>, value: unknown) {
  const source = useFormLookupSource()
  return useCallback(async (kind: ControlRequestKind, payload: unknown): Promise<unknown> => {
    if (kind === 'file') {
      // Only files the form already gave the control (its value, its context), fetched with the user's own session.
      const id = String((payload as { id?: string })?.id ?? '')
      const contextFields: Record<string, unknown> = {}
      for (const [name, key] of Object.entries(field.custom?.context_map ?? {})) contextFields[name] = values[key]
      if (!readableFileIds(value, contextFields).has(id)) throw new Error('That file is not available to this control')
      const res = await fetch(attachmentPath(id), { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) throw new Error(res.status === 404 ? 'The file was not found' : 'The file could not be read')
      const bytes = await res.arrayBuffer()
      if (bytes.byteLength > BRIDGE_LIMITS.uploadBytes) throw new Error('The file is too large to show here')
      const known = [value, ...Object.values(contextFields)].flatMap((v) => (Array.isArray(v) ? v : [])).find((f) => f && typeof f === 'object' && (f as { id?: unknown }).id === id) as { name?: string; mime_type?: string; type?: string } | undefined
      return { id, name: String(known?.name ?? 'file'), type: res.headers.get('content-type')?.split(';')[0] || known?.mime_type || known?.type || 'application/octet-stream', size: bytes.byteLength, bytes }
    }
    if (kind === 'tile') {
      // Map tiles through the server (public tile servers refuse the frame's referrer-less requests).
      const { z, x, y } = payload as { z: number; x: number; y: number }
      const qs = source?.kind === 'task' ? `?task=${encodeURIComponent(source.taskId)}` : ''
      const res = await fetch(`/form-controls/tiles/${encodeURIComponent(field.custom?.tag ?? '')}/${z}/${x}/${y}.png${qs}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(res.status === 403 ? 'Map tiles are not approved for this control' : 'The map tile is not available')
      return { type: res.headers.get('content-type')?.split(';')[0] || 'image/png', bytes: await res.arrayBuffer() }
    }
    if (kind === 'report') {
      // The server reads the report id from the stored form (task / form page); the control can't pick another one.
      const limit = (payload as { limit?: number })?.limit
      const body = source?.kind === 'task' ? { task_id: source.taskId, field_key: field.key, limit }
        : source?.kind === 'form' ? { form_id: source.formId, field_key: field.key, limit }
          : { field, limit }
      const res = await fetch('/api/internal/forms/report', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? 'The report is not available right now')
      return json
    }
    if (kind === 'lookup') {
      const query = String((payload as { query?: string })?.query ?? '')
      if (!source) throw new Error('Lookups are available on the task')
      const body = source.kind === 'task' ? { task_id: source.taskId, field_key: field.key, query, values }
        : source.kind === 'form' ? { form_id: source.formId, field_key: field.key, query, values }
          : { field, query, values }
      const res = await fetch('/api/internal/forms/lookup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null) as { items?: unknown[]; truncated?: boolean; error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? 'The lookup is not available right now')
      return { items: Array.isArray(json?.items) ? json!.items : [], truncated: Boolean(json?.truncated) }
    }
    // upload: one file through the Attachments pipeline (same checks as the Attachments field).
    const file = payload as { name: string; type: string; bytes: ArrayBuffer }
    if (!source || source.kind === 'preview') throw new Error('Files upload on the real form, not in the preview')
    const context: Record<string, string> = source.kind === 'task' ? { task_id: source.taskId } : { form_id: source.formId }
    trackAttachmentUpload(field.key, 1)
    try {
      const init = await fetch('/api/internal/forms/files/init', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_key: field.key, name: file.name, size: file.bytes.byteLength, ...context }),
      })
      const plan = await init.json().catch(() => null) as { mode?: string; file_id?: string; upload?: { url: string; method: string; headers: Record<string, string> }; error?: string } | null
      if (!init.ok) throw new Error(plan?.error ?? 'The upload was refused')
      let stored: AttachmentFile | null = null
      if (plan?.mode === 'direct' && plan.file_id && plan.upload) {
        const put = await fetch(plan.upload.url, { method: plan.upload.method, headers: plan.upload.headers, body: new Blob([file.bytes], { type: file.type }) })
        if (!put.ok) throw new Error('The storage service refused the upload')
        const done = await fetch('/api/internal/forms/files/complete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: plan.file_id }) })
        const result = await done.json().catch(() => null) as { file?: AttachmentFile; error?: string } | null
        if (!done.ok || !result?.file) throw new Error(result?.error ?? 'The upload could not be completed')
        stored = result.file
      } else {
        const form = new FormData()
        form.append('file', new Blob([file.bytes], { type: file.type }), file.name)
        form.append('field_key', field.key)
        form.append('size', String(file.bytes.byteLength))
        for (const [k, v] of Object.entries(context)) form.append(k, v)
        const res = await fetch('/api/internal/forms/files', { method: 'POST', credentials: 'same-origin', body: form })
        const body = await res.json().catch(() => null) as { file?: AttachmentFile; error?: string } | null
        if (!res.ok || !body?.file) throw new Error(body?.error ?? 'The upload failed')
        stored = body.file
      }
      return { id: stored.id, name: stored.name, size: stored.size, type: stored.mime_type, file: stored }
    } finally {
      trackAttachmentUpload(field.key, -1)
    }
  }, [source, field, values, value])
}

function FramedControl(props: CustomControlFieldProps) {
  const { field, onChange, id, describedBy } = props
  const config = field.custom!
  const source = useFormLookupSource()
  const anchor = useRef<HTMLDivElement>(null)
  const iframe = useRef<HTMLIFrameElement>(null)
  const channel = useMemo(() => newChannelId(), [])
  const theme = useTheme(anchor)
  const state = useControlState(props, theme)
  const handleRequest = useRequestHandler(field, props.values, props.value)
  // connected: the init state went out (the frame asked with `hello`); ready: the control has painted.
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // The frame document did not run the bridge (an error page from the server): show it as it is.
  const [plainDocument, setPlainDocument] = useState(false)
  const [height, setHeight] = useState(() => reservedHeight(config.size, null))
  const memoryId = useRef<string | null>(null)
  const sent = useRef<string>('')
  // Values the control reported recently: never echoed back (a slower render must not undo a newer keystroke).
  const fromControl = useRef<Array<{ json: string; at: number }>>([])
  const loads = useRef(0)
  const pending = useRef(0)
  const greeted = useRef(false)
  const stateRef = useRef(state)
  const onChangeRef = useRef(onChange)
  useEffect(() => { stateRef.current = state; onChangeRef.current = onChange })
  const { late } = useControlReady(channel, ready || Boolean(failure) || plainDocument)

  // Before the first paint: the theme is known (the iframe is only created now, with the right mode in
  // its URL and colour scheme) and the height this field had last time is reserved.
  const [srcMode, setSrcMode] = useState<'light' | 'dark' | null>(null)
  useLayoutEffect(() => {
    const width = anchor.current?.getBoundingClientRect().width ?? 0
    memoryId.current = heightMemoryId(config.tag, config.version, field.key, width)
    const remembered = rememberedHeight(safeLocalStorage(), memoryId.current)
    if (remembered !== null) setHeight(reservedHeight(config.size, remembered))
    setSrcMode((prev) => prev ?? readTheme(anchor.current).mode)
  }, [config.tag, config.version, config.size, field.key])
  const src = srcMode ? `${frameUrl(config.tag, config.version, { task: source?.kind === 'task' ? source.taskId : null, anonymous: source?.kind === 'form' ? source.anonymous?.token ?? null : null })}#c=${channel}&m=${srcMode}` : null

  const post = useCallback((message: Parameters<typeof hostMessage>[1]) => {
    // Opaque-origin frame: the target origin can only be '*'; the frame checks the source and channel.
    iframe.current?.contentWindow?.postMessage(hostMessage(channel, message), '*')
  }, [channel])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const result = acceptFrameMessage({ source: event.source, origin: event.origin, data: event.data }, { frameWindow: iframe.current?.contentWindow, channel, capabilities: stateRef.current.capabilities })
      if (!result.ok) {
        if (result.reason === 'capability' || result.reason === 'size') console.warn(`[custom control ${config.tag}] message refused: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`)
        return
      }
      handle(result.message)
    }
    function sendInit() {
      greeted.current = true
      if (sent.current) return
      sent.current = JSON.stringify(stateRef.current)
      post({ type: 'init', state: stateRef.current })
      setConnected(true)
    }
    function handle(message: FrameMessage) {
      switch (message.type) {
        case 'hello':
          // The runtime asks before the element exists: value, theme and props arrive with its first render.
          sendInit()
          break
        case 'ready':
          // (A frame document cached from before `hello` asks here instead.)
          sendInit()
          setReady(true)
          setFailure(null)
          break
        case 'change':
          fromControl.current = [...fromControl.current.filter((r) => Date.now() - r.at < 1500).slice(-9), { json: JSON.stringify(message.value), at: Date.now() }]
          onChangeRef.current(message.value)
          break
        case 'validity':
          setCustomControlValidity(field.key, message.valid ? null : (message.message || 'Check this value'))
          break
        case 'resize': {
          const next = clampFrameHeight(message.height, config.size)
          setHeight(next)
          if (memoryId.current) rememberHeight(safeLocalStorage(), memoryId.current, next)
          break
        }
        case 'error':
          setFailure(message.message)
          break
        case 'focus-exit':
          if (iframe.current) focusBeside(iframe.current, message.direction)
          break
        case 'request': {
          if (pending.current >= BRIDGE_LIMITS.maxPendingRequests) {
            post({ type: 'response', request_id: message.request_id, ok: false, error: 'Too many requests in flight' })
            break
          }
          pending.current += 1
          handleRequest(message.kind, message.payload)
            .then((result) => post({ type: 'response', request_id: message.request_id, ok: true, result }))
            .catch((error: unknown) => post({ type: 'response', request_id: message.request_id, ok: false, error: error instanceof Error ? error.message : 'Request failed' }))
            .finally(() => { pending.current -= 1 })
          break
        }
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [channel, config.tag, config.size, field.key, post, handleRequest])

  // State changes after the init: send what changed (not the control's own value back).
  useEffect(() => {
    if (!connected) return
    const json = JSON.stringify(state)
    if (json === sent.current) return
    const before = JSON.parse(sent.current || '{}') as Record<string, unknown>
    const changed: Partial<ControlState> = {}
    for (const [key, value] of Object.entries(state) as Array<[keyof ControlState, unknown]>) {
      if (JSON.stringify(before[key]) === JSON.stringify(value)) continue
      if (key === 'value' && fromControl.current.some((r) => r.json === JSON.stringify(value) && Date.now() - r.at < 1500)) continue
      ;(changed as Record<string, unknown>)[key] = value
    }
    sent.current = json
    if (Object.keys(changed).length) post({ type: 'update', state: changed })
  }, [state, connected, post])

  // Clicking the field's label focuses the control.
  useEffect(() => {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    if (!label) return
    const onClick = (e: MouseEvent) => { e.preventDefault(); iframe.current?.focus(); post({ type: 'focus', from: 'start' }) }
    label.addEventListener('click', onClick)
    return () => label.removeEventListener('click', onClick)
  }, [id, post])

  useEffect(() => () => setCustomControlValidity(field.key, null), [field.key])

  const shown = ready || plainDocument
  const boxHeight = Math.max(BRIDGE_LIMITS.minHeight, height - FRAME_INSET * 2)
  return (
    <div ref={anchor} className="relative" style={{ minHeight: boxHeight }} data-custom-control={config.tag} data-control-version={config.version} data-control-ready={ready ? 'true' : 'false'}>
      {late && !shown && !failure && <ControlSkeleton height={boxHeight} />}
      {src && <iframe
        ref={iframe}
        id={id}
        src={src}
        title={field.label || config.name || config.tag}
        aria-describedby={describedBy}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow=""
        className="relative block rounded-lg"
        // The frame's 4px inner padding (room for focus rings) sits outside the field's box, so the
        // control's borders line up with the native inputs above and below it.
        style={{ height, width: `calc(100% + ${FRAME_INSET * 2}px)`, margin: -FRAME_INSET, border: 0, colorScheme: theme.mode, background: 'transparent', opacity: shown ? 1 : 0, transition: 'opacity var(--fm-gate-dur, 100ms) var(--ds-ease-out)' }}
        onLoad={() => {
          loads.current += 1
          // A second load is the control navigating its own frame away: stop talking to it.
          if (loads.current > 1) {
            setReady(false)
            setFailure('The control tried to navigate away and was stopped')
            if (iframe.current) iframe.current.src = 'about:blank'
            return
          }
          // No bridge in the document (the server answered with an error page): show that page.
          window.setTimeout(() => { if (!greeted.current) setPlainDocument(true) }, 400)
        }}
      />}
      {failure && <div className="mt-1"><ControlProblem message={`${config.name ?? config.tag}: ${failure}`} /></div>}
    </div>
  )
}

/** Trusted controls: the module loads into the page and the element lives in a shadow root here. */
function InlineControl(props: CustomControlFieldProps) {
  const { field, onChange, id, describedBy } = props
  const config = field.custom!
  const host = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLElement & Record<string, unknown> | null>(null)
  const theme = useTheme(host)
  const state = useControlState(props, theme)
  const handleRequest = useRequestHandler(field, props.values, props.value)
  const [failure, setFailure] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useControlReady(`inline:${id}`, mounted || Boolean(failure))
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  const lastFromControl = useRef<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const url = bundleUrl(config.tag, config.version)
    if (!document.querySelector(`script[data-form-control="${CSS.escape(url)}"]`) && !customElements.get(config.tag)) {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = url
      script.dataset.formControl = url
      script.onerror = () => setFailure('The control could not be loaded')
      document.head.appendChild(script)
    }
    const timer = window.setTimeout(() => { if (!customElements.get(config.tag)) setFailure(`The control did not define <${config.tag}>`) }, 8000)
    customElements.whenDefined(config.tag).then(() => {
      if (cancelled || !host.current) return
      window.clearTimeout(timer)
      const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open', delegatesFocus: true })
      const el = document.createElement(config.tag) as HTMLElement & Record<string, unknown>
      el.id = `${id}-control`
      el.addEventListener(CONTROL_EVENTS.change, (e) => {
        const detail = (e as CustomEvent).detail
        const value = detail && typeof detail === 'object' && 'value' in detail ? detail.value : el.value
        lastFromControl.current = JSON.stringify(value)
        onChangeRef.current(value)
      })
      el.addEventListener(CONTROL_EVENTS.validity, (e) => {
        const detail = (e as CustomEvent).detail ?? {}
        setCustomControlValidity(field.key, detail.valid === false ? String(detail.message ?? 'Check this value').slice(0, 500) : null)
      })
      el.addEventListener(CONTROL_EVENTS.request, (e) => {
        const detail = (e as CustomEvent).detail ?? {}
        const kind = detail.kind as ControlRequestKind
        if (typeof detail.resolve !== 'function' || typeof detail.reject !== 'function') return
        if (!(kind in REQUEST_CAPABILITY) || !state.capabilities.includes(REQUEST_CAPABILITY[kind])) { detail.reject(new Error('Not allowed')); return }
        handleRequest(kind, detail.payload).then(detail.resolve, detail.reject)
      })
      root.replaceChildren(el)
      element.current = el
      setMounted(true)
    })
    return () => { cancelled = true; window.clearTimeout(timer) }
    // Mount once per control version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tag, config.version])

  useEffect(() => {
    const el = element.current
    if (!el) return
    for (const [key, value] of Object.entries(state)) {
      if (key === 'value' && JSON.stringify(value) === lastFromControl.current && el.value !== undefined) continue
      try { el[key] = value } catch { /* read-only property */ }
    }
    for (const [key, value] of Object.entries(state.props)) { try { el[key] = value } catch { /* ignore */ } }
    for (const [token, value] of Object.entries(state.theme.tokens)) host.current?.style.setProperty(`--${token}`, String(value))
    el.setAttribute('aria-label', state.label)
  })

  useEffect(() => () => setCustomControlValidity(field.key, null), [field.key])

  return (
    <div>
      <div ref={host} id={id} aria-describedby={describedBy} data-custom-control={config.tag} data-control-trusted="true" />
      {failure && <div className="mt-1"><ControlProblem message={`${config.name ?? config.tag}: ${failure}`} /></div>}
    </div>
  )
}
