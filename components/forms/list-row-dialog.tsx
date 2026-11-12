'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Expand, Eye, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogHeader, overlayClass } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { LIST_ROW_ERROR_KEY, coerceListRow, type ListColumn, type ListFieldConfig } from '@/lib/forms/list-field'
import { formatRowValue, rowFormBlocks, rowFormLayout, rowPositionText, type RowValueView } from '@/lib/forms/list-row-form'
import type { RowStyleResult } from '@/lib/forms/conditional-style'
import { ToneIcon, rowStyleAttrs, useRowStyles } from './conditional-style'
import { labelStyleProps, valueStyleProps } from '@/lib/forms/text-style'

/**
 * The List row pop-out (lib/forms/list-row-form.ts): a row shown as a form
 * in a dialog — editable (labels, inputs, help, errors; Save / Cancel; an
 * "unsaved changes" check) or read-only (values formatted for reading).
 * One column in a full-screen sheet below 768px, two columns in a centred
 * dialog from there (wide columns span both). Previous / Next walk the
 * rows ("Row 3 of 12"). The inputs and nested Lists come from the List
 * (components/forms/list-field.tsx) through render props.
 */

const SERVER_WIDTH = 1024
/** The window's width (px), live; the server's guess before hydration. */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb) },
    () => window.innerWidth,
    () => SERVER_WIDTH,
  )
}

/** A row's "Open row" (edit) / "View row" (read) icon. */
export function RowFormIcon({ index, mode, onOpen, id, label }: { index: number; mode: 'edit' | 'view'; onOpen: () => void; id?: string; label?: string }) {
  const name = `${mode === 'edit' ? 'Open' : 'View'} ${label ?? 'row'} ${index + 1}`
  return (
    <button id={id} type="button" aria-label={name} title={name} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); onOpen() }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg" data-row-form-open={mode} data-row-index={index}>
      {mode === 'edit' ? <SquarePen size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
    </button>
  )
}

/** A picture's thumbnail; pressing it shows it larger. */
function ImageThumb({ src, full, alt, name }: { src: string; full: string; alt: string; name?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative inline-block max-w-full text-left" aria-label={`Show ${alt} larger`} data-row-value-image>
        {/* eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin picture */}
        <img src={src} alt={alt} className="max-h-32 max-w-full rounded-md border border-border bg-subtle object-contain" />
        <span className="absolute right-1 top-1 rounded bg-elevated/80 p-0.5 text-fg-muted opacity-0 group-hover:opacity-100" aria-hidden><Expand size={12} /></span>
        {name && <span className="mt-1 block truncate text-2xs text-fg-muted">{name}</span>}
      </button>
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className={overlayClass} />
          <RadixDialog.Content className="ds-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(960px,calc(100vw-32px))] [transform:translate(-50%,-50%)] flex-col overflow-hidden rounded-xl bg-elevated text-fg shadow-elev-3 outline-none" aria-describedby={undefined} data-agent-no-host="">
            <DialogHeader title={name || alt} />
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin picture */}
              <img src={src} alt={alt} className="mx-auto max-h-[75dvh] max-w-full object-contain" />
            </div>
            <div className="border-t border-border-subtle px-4 py-3 text-right text-sm"><a href={full} target="_blank" rel="noopener noreferrer" className="text-primary-text underline">Open full size</a></div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  )
}

/** One value, formatted for reading (never an input). */
export function RowValue({ view }: { view: RowValueView }) {
  switch (view.kind) {
    case 'empty': return <span className="text-fg-muted" data-row-value="empty">—</span>
    case 'text': return <span className={cn('break-words', view.numeric && 'tabular-nums')} data-row-value="text">{view.text}</span>
    case 'multiline': return <p className="whitespace-pre-line break-words" data-row-value="multiline">{view.text}</p>
    case 'link': return <a href={view.href} {...(view.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="break-all text-primary-text underline" data-row-value="link">{view.text}</a>
    case 'image': return <ImageThumb src={view.src} full={view.full} alt={view.alt} name={view.name} />
    case 'signature':
      return (
        <div className="space-y-1" data-row-value="signature">
          {/* eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin signature image */}
          {view.src && <img src={view.src} alt={`Signature${view.signer ? ` of ${view.signer}` : ''}`} className="max-h-20 max-w-full rounded-md border border-border bg-white p-1" />}
          <p className="text-xs text-fg-muted">{view.text}</p>
        </div>
      )
    case 'rich': return <div className="task-description text-sm text-fg" data-row-value="rich" dangerouslySetInnerHTML={{ __html: view.html }} />
    case 'rows': return <span data-row-value="rows">{view.text}</span>
  }
}

/**
 * The row's fields as a form: section headings, then per column its label
 * (required marked), the control or — reading — the formatted value, help
 * and the error; wide columns span both columns; nested Lists as sections.
 */
export function RowFormFields({ mode, config, row, columns, errors = {}, idBase, renderInput, renderNested, styles }: {
  /** Conditional styling (list.row_styles): the whole row's style (the form) and each styled column's (its field). */
  styles?: RowStyleResult
  mode: 'edit' | 'view'
  config: ListFieldConfig
  row: Record<string, unknown>
  columns: 1 | 2
  errors?: Record<string, string>
  idBase: string
  renderInput?: ListRowDialogProps['renderInput']
  renderNested?: ListRowDialogProps['renderNested']
}) {
  const edit = mode === 'edit'
  const blocks = rowFormBlocks(config)
  const inputId = (key: string) => `${idBase}-f-${key}`
  // Reading: calculated columns worked out when the row doesn't carry them.
  const typed = edit ? null : coerceListRow(config, row)
  const cellStyle = (key: string) => styles?.cells[key] ?? null
  const boxAttrs = (key: string) => (cellStyle(key) ? { ...rowStyleAttrs(cellStyle(key)), 'data-cs-box': '' } : {})
  const icon = (key: string) => (cellStyle(key)?.icon ? <ToneIcon tone={cellStyle(key)!.tone ?? 'neutral'} size={12} className="mr-1 align-[-2px]" /> : null)
  const whole = styles?.row ?? null
  return (
    <div className={cn('grid gap-x-5 gap-y-4', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')} data-row-form-grid={columns} {...(whole ? { ...rowStyleAttrs(whole), 'data-cs-box': '' } : {})}>
      {whole?.icon && <p className={cn('flex items-center gap-1 text-xs font-medium', columns === 2 && 'col-span-2')} data-cs-row-icon><ToneIcon tone={whole.tone ?? 'neutral'} size={14} /></p>}
      {blocks.map((block, i) => {
        if (block.kind === 'section') {
          return <h3 key={`s${i}`} className={cn('border-b border-border-subtle pb-1 pt-2 text-sm font-semibold text-fg', columns === 2 && 'col-span-2')} data-row-form-section>{block.title}</h3>
        }
        const c = block.column
        // A cell rule hides this row's cell: the field is left out of the form.
        if (styles?.hidden[c.key]) return null
        const span = columns === 2 && block.wide ? 'col-span-2' : ''
        if (c.type === 'list') {
          return (
            <section key={c.key} className={cn('min-w-0', span)} aria-label={c.label} data-row-form-nested={c.key}>
              <h3 className="mb-1 text-xs font-semibold text-fg-muted" {...labelStyleProps(c)}>{c.label}{edit && c.required && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}</h3>
              {renderNested?.(c)}
              {edit && errors[c.key] && <p className="mt-1 text-2xs text-(--status-blocked)" role="alert">{errors[c.key]}</p>}
            </section>
          )
        }
        if (!edit) {
          return (
            <div key={c.key} role="group" aria-labelledby={`${inputId(c.key)}-label`} className={cn('min-w-0', span)} data-row-form-value={c.key} {...boxAttrs(c.key)}>
              <p id={`${inputId(c.key)}-label`} className="mb-0.5 text-xs font-medium text-fg-muted" {...labelStyleProps(c)}>{icon(c.key)}{c.label}</p>
              <div className="text-sm text-fg" {...valueStyleProps(c)}><RowValue view={formatRowValue(c, c.type === 'calculated' && (row[c.key] === null || row[c.key] === undefined) ? typed?.[c.key] : row[c.key], row)} /></div>
            </div>
          )
        }
        const id = inputId(c.key)
        const error = errors[c.key]
        const describedBy = [c.help_text ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
        return (
          <div key={c.key} className={cn('min-w-0', span)} data-row-form-field={c.key} {...boxAttrs(c.key)}>
            <label htmlFor={id} id={`${id}-label`} className="mb-1 block text-xs font-medium text-fg" {...labelStyleProps(c)}>
              {icon(c.key)}{c.label}{c.required && !styles?.locked[c.key] && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}{c.required && !styles?.locked[c.key] && <span className="sr-only"> (required)</span>}
            </label>
            <div {...valueStyleProps(c)}>{renderInput?.(c, id, error, describedBy)}</div>
            {c.help_text && <p id={`${id}-help`} className="mt-1 text-2xs text-fg-muted">{c.help_text}</p>}
            {error && <p id={`${id}-error`} className="mt-1 text-2xs text-(--status-blocked)" data-row-form-error={c.key}>{error}</p>}
          </div>
        )
      })}
    </div>
  )
}

export interface ListRowDialogProps {
  mode: 'edit' | 'view'
  config: ListFieldConfig
  /** The List's rows (the row shown is rows[index]). */
  rows: Record<string, unknown>[]
  index: number
  title: string
  /** A row the dialog added (no Previous / Next; Cancel removes it). */
  isNew?: boolean
  /** Where focus goes when the dialog closes (the row's icon); a fallback when it is gone. */
  returnFocusId?: string
  fallbackFocusId?: string
  /** Edit: the row's problems (column → message; LIST_ROW_ERROR_KEY for the row). */
  errors?: Record<string, string>
  /** Edit: changed since it opened (closing asks first). */
  dirty?: boolean
  /** Edit: a column's control (input, lookup, read-only value, calculated output). */
  renderInput?: (column: ListColumn, id: string, error: string | undefined, describedBy: string | undefined) => React.ReactNode
  /** A nested List column's rows (an editable table in edit mode, read-only rows in view mode). */
  renderNested?: (column: ListColumn) => React.ReactNode
  /** Previous / Next (edit: the row is saved first — false keeps it open). */
  onNavigate?: (index: number) => void
  /** Edit: Save (true: saved, the dialog closes). */
  onSave?: () => boolean
  /** Edit: Cancel / discard the changes. View: Close. */
  onClose: () => void
  /** Ids prefix for the inputs. */
  idBase: string
  /** A nested List's parent row (row styles reading parent.<column>). */
  parent?: Record<string, unknown> | null
}

/**
 * The dialog. Edit: Save checks and commits the row; Cancel, Esc, the close
 * button or a click outside put it back — after "Discard your changes?"
 * when something changed. View: Close / Esc.
 */
export function ListRowDialog({ mode, config, rows, index, title, isNew, returnFocusId, fallbackFocusId, errors = {}, dirty, renderInput, renderNested, onNavigate, onSave, onClose, idBase, parent }: ListRowDialogProps) {
  // The dialog covers the window (it is portalled): its layout follows the window's width, not the List's.
  const layout = rowFormLayout(useViewportWidth())
  const columns = layout.columns
  const [confirming, setConfirming] = useState(false)
  const keepRef = useRef<HTMLButtonElement>(null)
  const row = rows[index] ?? {}
  const total = rows.length
  const edit = mode === 'edit'
  const requestClose = () => {
    if (edit && dirty) { setConfirming(true); requestAnimationFrame(() => keepRef.current?.focus()); return }
    onClose()
  }
  const rowError = errors[LIST_ROW_ERROR_KEY]
  const canNavigate = Boolean(onNavigate) && !isNew && total > 1
  const go = (to: number) => { setConfirming(false); onNavigate?.(to) }

  // Conditional styling: the row's styles as it is (edit: as it is being typed).
  const styles = useRowStyles(config, [row], parent)(0)
  const body = <RowFormFields mode={mode} config={config} row={row} columns={columns} errors={errors} idBase={idBase} renderInput={renderInput} renderNested={renderNested} styles={styles} />

  return (
    <RadixDialog.Root open onOpenChange={(open) => { if (!open) requestClose() }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            'z-50 flex flex-col overflow-hidden bg-elevated text-fg outline-none',
            layout.sheet
              ? 'fixed inset-0 h-dvh w-full pb-[env(safe-area-inset-bottom)]'
              : 'ds-dialog fixed left-1/2 top-1/2 max-h-[calc(100dvh-48px)] w-[min(780px,calc(100vw-32px))] [transform:translate(-50%,-50%)] rounded-xl shadow-elev-3',
          )}
          // A row's form is a short task: the Agent's in-dialog button would cover its footer (it stays on the page).
          data-agent-no-host="" data-row-form={mode} data-row-form-layout={layout.sheet ? 'sheet' : 'dialog'}
          onEscapeKeyDown={(e) => {
            // Escape in an open dropdown (a choice column's AutocompleteSelect, a lookup) closes that, not the row's form:
            // the floating layer marks it handled (components/ui/floating-layer.tsx).
            if (e.defaultPrevented) return
            if (edit && dirty) { e.preventDefault(); requestClose() }
          }}
          onInteractOutside={(e) => { if (edit) { e.preventDefault(); if (dirty) requestClose() } }}
          onCloseAutoFocus={(e) => {
            const target = (returnFocusId && document.getElementById(returnFocusId)) || (fallbackFocusId && document.getElementById(fallbackFocusId))
            if (target) { e.preventDefault(); target.focus() }
          }}
        >
          <DialogHeader title={title} description={isNew ? 'Not saved yet' : rowPositionText(index, total)} className="border-b border-border-subtle pb-3" />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-md:px-4" data-row-form-body>
            {edit && rowError && <p role="alert" className="mb-3 rounded-md border border-(--status-blocked) px-3 py-2 text-sm text-(--status-blocked)" data-row-form-row-error>{rowError}</p>}
            {body}
          </div>
          {confirming && (
            <div role="alertdialog" aria-labelledby={`${idBase}-confirm`} className="flex flex-wrap items-center gap-2 border-t border-border-subtle bg-subtle px-6 py-3 max-md:px-4" data-row-form-confirm>
              <p id={`${idBase}-confirm`} className="mr-auto text-sm font-medium">Discard your changes to this row?</p>
              <Button ref={keepRef} variant="secondary" size="sm" onClick={() => setConfirming(false)}>Keep editing</Button>
              <Button variant="danger" size="sm" onClick={() => { setConfirming(false); onClose() }} data-row-form-discard>Discard changes</Button>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle px-6 py-3 max-md:px-4">
            {canNavigate && (
              <div className="mr-auto flex items-center gap-1" data-row-form-nav>
                <Button variant="ghost" size="sm" disabled={index <= 0} onClick={() => go(index - 1)} leadingIcon={<ChevronLeft />} aria-label="Previous row">Previous</Button>
                <span className="text-xs tabular-nums text-fg-muted" aria-live="polite">{rowPositionText(index, total)}</span>
                <Button variant="ghost" size="sm" disabled={index >= total - 1} onClick={() => go(index + 1)} trailingIcon={<ChevronRight />} aria-label="Next row">Next</Button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {edit ? (
                <>
                  <Button variant="secondary" onClick={() => (dirty ? requestClose() : onClose())} data-row-form-cancel>Cancel</Button>
                  <Button onClick={() => onSave?.()} data-row-form-save>Save</Button>
                </>
              ) : (
                <RadixDialog.Close asChild><Button variant="secondary" data-row-form-close>Close</Button></RadixDialog.Close>
              )}
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
