'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Clock, MessageCircleQuestion, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatItem } from '@/lib/assistants/history'
import type { ChoiceOption } from '@/lib/assistants/types'
import { answerChoice } from './agent-store'

/**
 * A question with answer buttons (ask_user, ask_where_to_build). Open: one
 * click answers (the click becomes the person's reply bubble); multi: toggle
 * options, then Send; allow_other: "Other…" opens a text box. Answered: the
 * answer, no buttons. Expired (the person moved on): says so. All native
 * buttons (Tab / Enter / Space), touch-sized, wrapping on narrow screens.
 */
export function ChoiceCard({ item, status, busy }: { item: Extract<ChatItem, { kind: 'choice' }>; status: 'answered' | 'open' | 'expired'; busy: boolean }) {
  const qid = useId()
  const [picked, setPicked] = useState<ChoiceOption[]>([])
  const [otherOpen, setOtherOpen] = useState(false)
  const [other, setOther] = useState('')
  const otherRef = useRef<HTMLInputElement>(null)
  const open = status === 'open'
  const tiles = item.options.some((o) => o.description)

  const send = (choice: ChoiceOption[], typed?: string) => answerChoice(item.id, choice, typed ?? null)
  const toggle = (o: ChoiceOption) => setPicked((p) => (p.some((x) => x.label === o.label) ? p.filter((x) => x.label !== o.label) : [...p, o]))
  const submitMulti = () => send(picked, otherOpen ? other : undefined)
  const onOtherKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (other.trim()) send(item.multi ? picked : [], other) }
    if (e.key === 'Escape') { e.stopPropagation(); setOtherOpen(false); setOther('') }
  }

  return (
    <div
      role="group"
      aria-labelledby={qid}
      className={cn('rounded-lg border bg-panel p-3', open ? 'border-primary' : 'border-border')}
      data-assistant-item="choice"
      data-choice-status={status}
    >
      <p id={qid} className="flex items-start gap-1.5 text-xs font-medium">
        <MessageCircleQuestion className="mt-px size-3.5 shrink-0 text-primary-text" aria-hidden="true" />
        <span>{item.question}</span>
      </p>

      {status === 'answered' && (
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-fg-muted" data-testid="agent-choice-answer">
          <Check className="size-3 text-success" aria-hidden="true" />You answered: <span className="font-medium text-fg">{item.answered}</span>
        </p>
      )}
      {status === 'expired' && (
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-fg-muted" data-testid="agent-choice-expired">
          <Clock className="size-3" aria-hidden="true" />Expired — not answered
        </p>
      )}

      {open && (
        <>
          <div className={cn('mt-2', tiles ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-2')}>
            {item.options.map((o, i) => {
              const selected = picked.some((x) => x.label === o.label)
              const onClick = () => (item.multi ? toggle(o) : send([o]))
              if (tiles) {
                return (
                  <button
                    key={o.label}
                    type="button"
                    disabled={busy}
                    onClick={onClick}
                    aria-pressed={item.multi ? selected : undefined}
                    className={cn(
                      'flex min-h-[var(--ds-touch-min)] w-full flex-col items-start rounded-md border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50',
                      selected ? 'border-primary bg-primary/10' : 'border-border bg-panel hover:border-border-strong hover:bg-subtle',
                    )}
                    data-testid="agent-choice-option"
                  >
                    <span className="flex items-center gap-1.5 font-medium">{item.multi && <Check className={cn('size-3', selected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />}{o.label}</span>
                    {o.description && <span className="text-2xs text-fg-muted">{o.description}</span>}
                  </button>
                )
              }
              return (
                <Button
                  key={o.label}
                  size="sm"
                  variant={item.multi ? (selected ? 'primary' : 'secondary') : i === 0 ? 'primary' : 'secondary'}
                  disabled={busy}
                  onClick={onClick}
                  aria-pressed={item.multi ? selected : undefined}
                  leadingIcon={item.multi && selected ? <Check /> : undefined}
                  className="h-auto min-h-[max(var(--ds-control-h-sm),var(--ds-touch-min))] max-w-full whitespace-normal py-1 text-left"
                  data-testid="agent-choice-option"
                >
                  {o.label}
                </Button>
              )
            })}
            {item.allow_other && !otherOpen && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setOtherOpen(true); setTimeout(() => otherRef.current?.focus(), 0) }} aria-expanded={false} data-testid="agent-choice-other">Other…</Button>
            )}
          </div>
          {item.allow_other && otherOpen && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor={`${qid}-other`} className="sr-only">Your answer</label>
              <input
                id={`${qid}-other`}
                ref={otherRef}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={onOtherKey}
                maxLength={1000}
                placeholder="Type your answer"
                className="min-h-[var(--ds-touch-min)] min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none"
                data-testid="agent-choice-other-input"
              />
              {!item.multi && <Button size="sm" leadingIcon={<Send />} disabled={busy || !other.trim()} onClick={() => send([], other)} data-testid="agent-choice-other-send">Send</Button>}
            </div>
          )}
          {item.multi && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" leadingIcon={<Send />} disabled={busy || (!picked.length && !other.trim())} onClick={submitMulti} data-testid="agent-choice-send">Send{picked.length ? ` (${picked.length + (other.trim() ? 1 : 0)})` : ''}</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
