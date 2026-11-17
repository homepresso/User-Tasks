'use client'

/**
 * The form's button bar on the designer canvas, drawn with the same
 * component and theme placement as the form pages (BarButton), so what the
 * designer shows is what people get: order, style, size, colour, icon,
 * placement (theme: left / right / full width, sticky).
 *
 * A click picks a button (its editor opens in the Header tab, highlighted);
 * dragging one onto another reorders the bar (Alt+Arrow keys too). Hidden
 * buttons and buttons shown only under a rule stay on the canvas, marked, so
 * they can still be picked.
 */

import { useState } from 'react'
import { EyeOff, GitBranch } from 'lucide-react'
import { BarButton } from '@/components/forms/form-shell'
import type { ButtonPlacement, FormButton } from '@/lib/forms/buttons'
import { cn } from '@/lib/utils'

export function moveButton(buttons: FormButton[], from: number, to: number): FormButton[] {
  if (from === to || from < 0 || to < 0 || from >= buttons.length || to >= buttons.length) return buttons
  const next = [...buttons]
  const [b] = next.splice(from, 1)
  next.splice(to, 0, b)
  return next
}

export function CanvasButtonBar({ buttons, placement = 'right', sticky = false, selectedId, onSelect, onReorder, announce }: {
  buttons: FormButton[]
  placement?: ButtonPlacement
  sticky?: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onReorder: (next: FormButton[]) => void
  announce?: (text: string) => void
}) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  if (!buttons.length) return null
  const move = (from: number, to: number) => {
    const next = moveButton(buttons, from, to)
    if (next === buttons) return
    onReorder(next)
    announce?.(`${buttons[from].label} moved to position ${to + 1} of ${buttons.length}`)
  }
  return (
    <div
      className={cn('mt-5 flex flex-wrap gap-2 rounded-md border border-dashed border-border p-2', placement === 'left' && 'justify-start', placement === 'right' && 'justify-end', placement === 'full' && 'flex-col sm:flex-row', sticky && 'border-t-2')}
      role="listbox"
      aria-label="Form buttons — pick one to edit it, drag to reorder"
      data-canvas-buttons={placement}
      data-canvas-buttons-sticky={sticky || undefined}
    >
      {buttons.map((button, i) => {
        const muted = button.hidden === true
        return (
          <div
            key={button.id}
            role="option"
            aria-selected={selectedId === button.id}
            tabIndex={0}
            draggable
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', button.id) }}
            onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); setOver(i) } }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (dragging !== null) move(dragging, i); setDragging(null); setOver(null) }}
            onDragEnd={() => { setDragging(null); setOver(null) }}
            onClick={() => onSelect(button.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(button.id) }
              if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); move(i, i - 1) }
              if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, i + 1) }
            }}
            className={cn('relative cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary', placement === 'full' && 'w-full sm:flex-1',
              selectedId === button.id && 'ring-2 ring-primary ring-offset-2', over === i && dragging !== i && 'ring-2 ring-dashed ring-primary/60', dragging === i && 'opacity-50')}
            data-canvas-button={button.id}
            title={muted ? 'Hidden — not shown on the form' : button.visible_when ? 'Shown only when its rule holds' : undefined}
          >
            {/* The real button (pointer events off: a click picks it, never runs it). */}
            <BarButton button={button} placement={placement} tabIndex={-1} aria-hidden className={cn('pointer-events-none', muted && 'opacity-40')} />
            {(muted || button.visible_when) && (
              <span className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-surface-sunken text-fg-muted shadow" aria-hidden>
                {muted ? <EyeOff size={10} /> : <GitBranch size={10} />}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
