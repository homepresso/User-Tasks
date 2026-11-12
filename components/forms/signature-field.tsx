'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Eraser, Loader2, PenLine, Redo2, Type as TypeIcon, Undo2 } from 'lucide-react'
import { attachmentPath } from '@/lib/forms/attachments'
import {
  describeSignature, normalizeSignatureValue, SIGNATURE_DISCLAIMER, signatureMethods, type SignatureMethod, type SignatureValue,
} from '@/lib/forms/media-fields'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useAttachmentSource } from './attachments-field'
import { removeFieldFile, uploadFieldFile } from './form-file-upload'
import { cn } from '@/lib/utils'

/** Script faces most systems have; `cursive` is the generic fallback (no font is fetched). */
export const SIGNATURE_FONT = '"Segoe Script", "Bradley Hand", "Snell Roundhand", "Brush Script MT", "Apple Chancery", "URW Chancery L", cursive'
const INK = '#111827'
const PAD_HEIGHT = 160

type Point = { x: number; y: number }

/** Strokes with quadratic smoothing (midpoints as anchors, the samples as control points). */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], scale = 1, offset: Point = { x: 0, y: 0 }) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 2.4 * scale
  const p = (pt: Point) => ({ x: (pt.x - offset.x) * scale, y: (pt.y - offset.y) * scale })
  for (const stroke of strokes) {
    if (!stroke.length) continue
    if (stroke.length === 1) {
      const a = p(stroke[0])
      ctx.beginPath(); ctx.arc(a.x, a.y, 1.4 * scale, 0, Math.PI * 2); ctx.fill()
      continue
    }
    ctx.beginPath()
    const first = p(stroke[0])
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < stroke.length - 1; i++) {
      const c = p(stroke[i])
      const n = p(stroke[i + 1])
      ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2)
    }
    const last = p(stroke[stroke.length - 1])
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The signature could not be saved'))), 'image/png'))
}

/** The drawn strokes as a cropped PNG (2× for sharpness, transparent background). */
async function strokesPng(strokes: Point[][]): Promise<Blob> {
  const pts = strokes.flat()
  const pad = 8
  const minX = Math.min(...pts.map((p) => p.x)) - pad
  const minY = Math.min(...pts.map((p) => p.y)) - pad
  const width = Math.max(...pts.map((p) => p.x)) - minX + pad
  const height = Math.max(...pts.map((p) => p.y)) - minY + pad
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * 2)
  canvas.height = Math.ceil(height * 2)
  drawStrokes(canvas.getContext('2d')!, strokes, 2, { x: minX, y: minY })
  return canvasBlob(canvas)
}

/** A typed name rendered in a script face as a PNG. */
async function typedPng(name: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `96px ${SIGNATURE_FONT}`
  ctx.font = font
  const width = Math.ceil(ctx.measureText(name).width) + 48
  canvas.width = Math.min(Math.max(width, 120), 2400)
  canvas.height = 160
  ctx.font = font
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 24, 82, canvas.width - 48)
  return canvasBlob(canvas)
}

/** Read-only: the signature image and "Signed by … on …". */
export function SignatureView({ value, preview }: { value: unknown; preview?: string | null }) {
  const sig = normalizeSignatureValue(value)
  if (!sig) return <p className="text-sm text-fg">—</p>
  return (
    <div className="space-y-1" data-signature-value>
      {sig.file.id && (
        // eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin signature image
        <img src={preview ?? `${attachmentPath(sig.file.id)}?inline=1`} alt={`Signature${sig.user_name || sig.typed_name ? ` of ${sig.user_name || sig.typed_name}` : ''}`} className="max-h-24 max-w-full rounded-md border bg-white p-1 border-border" />
      )}
      <p className="text-sm text-fg">{describeSignature(sig)}</p>
    </div>
  )
}

/**
 * The Signature control: a pad (pointer / touch / pen, smoothed strokes,
 * Undo / Redo / Clear) and / or "Type instead" (the name rendered in a
 * script face — the keyboard way to sign). "Use this signature" turns it
 * into a PNG uploaded through the Attachments pipeline; the server records
 * who signed and when on submit. With `resign_on_change`, changing another
 * answer after signing (in this visit) clears the signature.
 */
export function SignatureField({ field, value, onChange, id, describedBy, invalid, disabled, watch }: {
  field: TaskFieldDef
  value: unknown
  onChange: (value: SignatureValue | null) => void
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  /** The other answers (JSON) — a change clears the signature when the field asks to re-sign. */
  watch?: string
}) {
  const source = useAttachmentSource()
  const sig = normalizeSignatureValue(value)
  const methods = signatureMethods(field.signature)
  const [method, setMethod] = useState<SignatureMethod>(methods[0])
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [redo, setRedo] = useState<Point[][]>([])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawing = useRef<Point[] | null>(null)
  const signedWith = useRef<string | null>(null)
  const sessionFile = useRef<string | null>(null)
  const [localPng, setLocalPng] = useState<{ id: string; url: string } | null>(null)
  const statementId = useId()
  const helpId = useId()
  const canSign = !disabled && Boolean(source) && source!.kind !== 'preview'
  const strokesRef = useRef(strokes)

  const redraw = useCallback((list: Point[][]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawStrokes(ctx, list)
  }, [])

  // Size the canvas to its box (crisp on high-density screens).
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || sig || method !== 'draw') return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const width = wrap.clientWidth
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(PAD_HEIGHT * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${PAD_HEIGHT}px`
      redraw(strokesRef.current)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [sig, method, redraw])


  useEffect(() => { strokesRef.current = strokes; redraw(strokes) }, [strokes, redraw])

  // Re-sign on change: another answer changed after signing in this visit.
  useEffect(() => {
    if (!field.signature?.resign_on_change || !sig || signedWith.current === null || watch === undefined) return
    if (watch !== signedWith.current) {
      signedWith.current = null
      onChange(null)
      setNotice('Your answers changed after you signed — please sign again.')
    }
  }, [watch, sig, field.signature?.resign_on_change, onChange])

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: Math.round((e.clientX - rect.left) * 10) / 10, y: Math.round((e.clientY - rect.top) * 10) / 10 }
  }

  async function adopt() {
    if (!source || !canSign) return
    setError(null)
    if (method === 'draw' && !strokes.some((s) => s.length)) { setError('Draw your signature in the box first'); return }
    if (method === 'type' && !typed.trim()) { setError('Type your name first'); return }
    setBusy(true)
    try {
      const blob = method === 'draw' ? await strokesPng(strokes) : await typedPng(typed.trim())
      const file = await uploadFieldFile(source, field.key, blob, 'signature.png')
      sessionFile.current = file.id
      setLocalPng((old) => { if (old) URL.revokeObjectURL(old.url); return { id: file.id, url: URL.createObjectURL(blob) } })
      signedWith.current = watch ?? null
      setNotice(null)
      onChange({ file, method, ...(method === 'type' ? { typed_name: typed.trim().slice(0, 200) } : {}), signed_at: new Date().toISOString() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The signature could not be saved')
    } finally {
      setBusy(false)
    }
  }

  function clearSigned() {
    if (sig && source && sessionFile.current === sig.file.id) { void removeFieldFile(source, sig.file.id); sessionFile.current = null }
    signedWith.current = null
    setStrokes([]); setRedo([])
    onChange(null)
  }

  const statement = field.signature?.statement
  const preview = !source || source.kind === 'preview'

  if (sig) {
    return (
      <div id={id} role="group" aria-labelledby={`${id}-label`} aria-describedby={[describedBy, helpId].filter(Boolean).join(' ')} className="space-y-2" data-signature-field={field.key}>
        {statement && <p className="text-sm text-fg">{statement}</p>}
        <SignatureView value={sig.file.id ? sig : null} preview={localPng?.id === sig.file.id ? localPng.url : null} />
        {!sig.user_id && <p className="text-2xs text-fg-muted">Your name and the time are recorded when the form is submitted.</p>}
        {!disabled && (
          <button type="button" onClick={clearSigned} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium border-border text-fg" data-signature-clear>
            <Eraser size={14} aria-hidden /> Clear signature
          </button>
        )}
        <p id={helpId} className="text-2xs text-fg-muted">{SIGNATURE_DISCLAIMER}</p>
      </div>
    )
  }

  return (
    <div id={id} role="group" aria-labelledby={`${id}-label`} aria-describedby={[statement ? statementId : '', describedBy, helpId].filter(Boolean).join(' ')} className="space-y-2" data-signature-field={field.key}>
      {statement && <p id={statementId} className="text-sm text-fg">{statement}</p>}
      {notice && <p className="text-2xs text-warning" role="status">{notice}</p>}
      {methods.length > 1 && (
        <div role="tablist" aria-label="How to sign" className="inline-flex rounded-md border p-0.5 border-border">
          {methods.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setError(null) }}
              className={cn('inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-sm', method === m ? 'bg-primary-wash text-primary-text font-medium' : 'text-fg')} data-signature-tab={m}>
              {m === 'draw' ? <PenLine size={14} aria-hidden /> : <TypeIcon size={14} aria-hidden />} {m === 'draw' ? 'Draw' : 'Type instead'}
            </button>
          ))}
        </div>
      )}
      {method === 'draw' ? (
        <div className="space-y-1.5">
          <div ref={wrapRef} className={cn('relative w-full overflow-hidden rounded-lg border-2 border-dashed bg-white', invalid ? 'border-(--status-blocked)' : 'border-border', (disabled || preview) && 'opacity-70')}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={strokes.length ? `Signature pad: ${strokes.length} stroke${strokes.length === 1 ? '' : 's'} drawn` : 'Signature pad: draw your signature with a mouse, finger or pen (or use Type instead)'}
              className="block touch-none select-none"
              style={{ height: PAD_HEIGHT, cursor: canSign ? 'crosshair' : 'default' }}
              onPointerDown={(e) => {
                if (!canSign || (e.pointerType === 'mouse' && e.button !== 0)) return
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                drawing.current = [point(e)]
                setStrokes((list) => [...list, drawing.current!])
                setRedo([])
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return
                const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
                const rect = e.currentTarget.getBoundingClientRect()
                const pts = events.length ? events.map((ev) => ({ x: Math.round((ev.clientX - rect.left) * 10) / 10, y: Math.round((ev.clientY - rect.top) * 10) / 10 })) : [point(e)]
                drawing.current.push(...pts)
                setStrokes((list) => [...list.slice(0, -1), [...drawing.current!]])
              }}
              onPointerUp={() => { drawing.current = null }}
              onPointerCancel={() => { drawing.current = null }}
              data-signature-pad
            />
            <span className="pointer-events-none absolute inset-x-4 bottom-8 border-b border-gray-300" aria-hidden />
            {!strokes.length && <span className="pointer-events-none absolute left-4 bottom-2 text-2xs text-gray-500" aria-hidden>{preview ? 'Signatures are made when the form is filled in' : 'Sign above the line'}</span>}
          </div>
          {canSign && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!strokes.length} onClick={() => { setRedo((r) => [...r, strokes[strokes.length - 1]]); setStrokes((s) => s.slice(0, -1)) }} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 text-sm border-border disabled:opacity-40" data-signature-undo>
                <Undo2 size={14} aria-hidden /> Undo
              </button>
              <button type="button" disabled={!redo.length} onClick={() => { setStrokes((s) => [...s, redo[redo.length - 1]]); setRedo((r) => r.slice(0, -1)) }} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 text-sm border-border disabled:opacity-40">
                <Redo2 size={14} aria-hidden /> Redo
              </button>
              <button type="button" disabled={!strokes.length} onClick={() => { setStrokes([]); setRedo([]) }} className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 text-sm border-border disabled:opacity-40" data-signature-reset>
                <Eraser size={14} aria-hidden /> Clear
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-typed`} className="block text-2xs font-medium text-fg-muted">Type your full name</label>
          <input id={`${id}-typed`} value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 200))} disabled={!canSign} autoComplete="name"
            className="h-10 w-full rounded-md border px-3 text-sm border-border bg-transparent" data-signature-typed />
          <div className="flex min-h-20 items-center overflow-hidden rounded-lg border-2 border-dashed bg-white px-4 border-border" aria-hidden>
            <span className="truncate text-4xl text-gray-900" style={{ fontFamily: SIGNATURE_FONT }}>{typed || ' '}</span>
          </div>
        </div>
      )}
      {canSign && (
        <button type="button" disabled={busy} onClick={() => void adopt()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium bg-primary text-primary-fg disabled:opacity-50" data-signature-adopt>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />} Use this signature
        </button>
      )}
      {error && <p className="text-2xs text-(--status-blocked)" role="alert">{error}</p>}
      <p id={helpId} className="text-2xs text-fg-muted">{SIGNATURE_DISCLAIMER}</p>
    </div>
  )
}
