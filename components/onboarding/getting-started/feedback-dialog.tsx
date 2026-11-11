'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CheckCircle2, Star } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { InlineNotice } from '@/components/ui/inline-notice'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { cn } from '@/lib/utils'
import { sendFeedback } from '@/app/actions/onboarding'

/**
 * "Send feedback" (the welcome, the checklist and the Help menu): a message,
 * an optional category and rating, and whether to include the page they're
 * on. The server attaches the workspace and the person and sends it through
 * the contact pipeline (lib/services/feedback.ts); nothing else is captured
 * (no screenshot).
 */

type Category = 'idea' | 'problem' | 'praise' | 'other'
const CATEGORIES: Array<{ value: Category; text: string }> = [
  { value: 'idea', text: 'Idea' }, { value: 'problem', text: 'Problem' }, { value: 'praise', text: 'Praise' }, { value: 'other', text: 'Other' },
]

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<Category>('idea')
  const [rating, setRating] = useState<number | null>(null)
  const [includePage, setIncludePage] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const guard = useSubmitGuard()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void guard.run(async () => {
      if (message.trim().length < 5) { setError('Tell us a little more (at least 5 characters).'); return }
      setBusy(true); setError(null)
      const page = includePage ? `${pathname}${search ? `?${search}` : ''}`.slice(0, 300) : undefined
      const result = await sendFeedback({ message: message.trim(), category, ...(rating ? { rating } : {}), ...(page ? { page } : {}) })
      setBusy(false)
      if (result.ok) setSent(true)
      else setError(result.error)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="md" title={sent ? 'Thank you' : 'Send feedback'} description={sent ? undefined : 'What works, what doesn’t, what you’d like next. It goes straight to the UserTasks team.'} data-feedback-dialog>
        {sent ? (
          <>
            <DialogBody>
              <div className="flex items-start gap-3" role="status" data-feedback-sent>
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <p className="text-sm text-fg">Your feedback is on its way. We read every message.</p>
              </div>
            </DialogBody>
            <DialogFooter><Button onClick={onClose} autoFocus>Close</Button></DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              <SegmentedControl aria-label="Kind of feedback" options={CATEGORIES} value={category} onValueChange={setCategory} size="sm" />
              <Field label="Your feedback">
                <Textarea rows={5} value={message} onChange={(e) => { setMessage(e.target.value); setError(null) }} maxLength={5000} autoFocus data-feedback-message />
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-ui font-medium text-fg">How is it going? <span className="font-normal text-fg-muted">Optional</span></legend>
                <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`}
                      onClick={() => setRating(rating === n ? null : n)}
                      className="inline-flex size-8 items-center justify-center rounded-md hover:bg-subtle" data-feedback-rating={n}>
                      <Star className={cn('size-5', rating !== null && n <= rating ? 'fill-[color:var(--color-warning)] text-warning' : 'text-fg-subtle')} aria-hidden />
                    </button>
                  ))}
                </div>
              </fieldset>
              <Checkbox checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} label="Include the page I’m on" data-feedback-page />
              <p className="text-xs text-fg-muted">Your name, email and workspace are sent with it, so we can reply.</p>
              {error && <InlineNotice tone="error" message={error} />}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={busy} data-feedback-send>Send feedback</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
