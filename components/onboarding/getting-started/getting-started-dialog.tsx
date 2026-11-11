'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight, Bell, BookOpen, Check, CheckSquare, ChevronDown, ClipboardPen, FileInput, FlaskConical, KeyRound,
  LayoutGrid, MessageSquareHeart, Palette, PartyPopper, PlayCircle, Sparkles, UserPlus, type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { openAgentForProcess, openAgentWithPrompt, setAgentOpen } from '@/components/assistants/agent-store'
import { tourById, tourSteps } from '@/lib/onboarding/tours'
import { welcomeCopy, WELCOME_QUICK_STARTS, type GuideView, type OnboardingIcon } from '@/lib/onboarding/model'
import { useOnboarding, type GuideItem } from './onboarding-provider'
import { ProgressRing } from './progress-ring'

/**
 * The getting-started guide (a Dialog: a bottom sheet on phones). Three
 * screens: the welcome (first), the checklist and the celebration. Closing
 * it any other way than the footer choices is "Dismiss" (this session).
 */

export const ITEM_ICONS: Record<OnboardingIcon, LucideIcon> = {
  gallery: LayoutGrid, palette: Palette, users: UserPlus, key: KeyRound, sparkles: Sparkles, build: ClipboardPen,
  flask: FlaskConical, book: BookOpen, tasks: CheckSquare, form: FileInput, bell: Bell,
}

export type CloseHow = 'dismiss' | 'snooze' | 'never' | 'done'

export function GettingStartedDialog({ view, onViewChange, onClose }: {
  view: GuideView
  onViewChange: (view: GuideView) => void
  onClose: (how: CloseHow) => void
}) {
  const { state, items, progress, choose, openFeedback, startTour } = useOnboarding()
  const isMobile = useIsMobile()
  const router = useRouter()
  if (!state) return null
  const copy = welcomeCopy(state.beta, state.audience)

  const runItem = (item: GuideItem, which: 'primary' | 'agent' = 'primary') => {
    if (item.action.run === 'tour' && which === 'primary') {
      // Phones have no spotlight: the checklist row lists the steps instead.
      if (isMobile || !item.tour) onViewChange('checklist')
      else startTour(item.tour)
      return
    }
    onClose('dismiss')
    if (which === 'agent' || item.action.run === 'agent-process') { openAgentForProcess(); return }
    if (item.action.run === 'agent') {
      setAgentOpen(true)
      void choose({ kind: 'visit', item: item.id })
      return
    }
    if (!item.action.href) return
    if (item.action.href.startsWith('/docs')) {
      window.open(item.action.href, '_blank', 'noopener,noreferrer')
      void choose({ kind: 'visit', item: item.id })
      return
    }
    router.push(item.action.href)
  }

  const footer = (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-6 py-3 max-sm:px-4">
      {state.stored.status === 'never' ? (
        <Button variant="ghost" size="sm" onClick={() => { void choose({ kind: 'resume' }) }} data-guide-resume>
          Show it automatically again
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => { void choose({ kind: 'never' }); onClose('never') }} data-guide-never>
          Don&apos;t show again
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => { void choose({ kind: 'snooze' }); onClose('snooze') }} data-guide-snooze>
          Remind me later
        </Button>
      </div>
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose('dismiss') }}>
      <DialogContent size="lg" className="gap-0" data-getting-started={view}>
        {view === 'welcome' && (
          <WelcomeScreen
            heading={copy.heading}
            body={copy.body}
            beta={copy.beta}
            quickStarts={state.audience === 'admin'
              ? WELCOME_QUICK_STARTS.flatMap((id) => items.filter((i) => i.id === id))
              : items.slice(0, 2)}
            onQuickStart={(item) => { void choose({ kind: 'welcomed' }); runItem(item) }}
            onContinue={() => { void choose({ kind: 'welcomed' }); onViewChange('checklist') }}
            onFeedback={state.feedback_available ? () => { onClose('dismiss'); openFeedback() } : null}
          />
        )}
        {view === 'checklist' && (
          <ChecklistScreen
            items={items}
            done={progress.done}
            total={progress.total}
            percent={progress.percent}
            agentAvailable={state.agent_available}
            beta={copy.beta}
            onRun={runItem}
            onWelcome={() => onViewChange('welcome')}
            onFeedback={state.feedback_available ? () => { onClose('dismiss'); openFeedback() } : null}
            onAskAgent={() => {
              const open = items.filter((i) => !i.done && !i.optional).map((i) => i.title.toLowerCase())
              onClose('dismiss')
              openAgentWithPrompt(open.length
                ? `Help me finish setting up this workspace. Still to do: ${open.join('; ')}. Start with the first one and tell me what you need from me.`
                : 'Help me get more out of this workspace. Suggest what to set up next.')
            }}
          />
        )}
        {view === 'celebrate' && (
          <CelebrateScreen
            audience={state.audience}
            onDone={() => { void choose({ kind: 'complete' }); onClose('done') }}
          />
        )}
        {view !== 'celebrate' && footer}
      </DialogContent>
    </Dialog>
  )
}

/* ── Welcome ── */

function WelcomeScreen({ heading, body, beta, quickStarts, onQuickStart, onContinue, onFeedback }: {
  heading: string
  body: string | null
  beta: boolean
  quickStarts: GuideItem[]
  onQuickStart: (item: GuideItem) => void
  onContinue: () => void
  onFeedback: (() => void) | null
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-guide-welcome>
      <div className="guide-hero relative overflow-hidden px-6 pb-6 pt-8 max-sm:px-4 max-sm:pt-6">
        <span aria-hidden className="guide-hero-glow" />
        <div className="relative flex items-center gap-2">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-elev-2" aria-hidden>
            <Sparkles className="size-5" />
          </span>
          {beta && <Badge tone="brand" data-guide-beta>Beta</Badge>}
        </div>
        <DialogTitle className="relative mt-4 text-xl font-semibold tracking-tight text-fg max-sm:text-lg">{heading}</DialogTitle>
        {body && <DialogDescription className="relative mt-1.5 max-w-prose text-sm text-fg-muted">{body}</DialogDescription>}
      </div>

      {quickStarts.length > 0 && (
        <div className="px-6 pb-2 max-sm:px-4">
          <p className="mb-2 text-xs font-medium text-fg-muted">Quick starts</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {quickStarts.map((item) => {
              const Icon = ITEM_ICONS[item.icon]
              return (
                <li key={item.id} className="flex flex-col rounded-xl border border-border bg-panel p-4 shadow-elev-1" data-guide-quickstart={item.id}>
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-wash text-primary-text" aria-hidden><Icon className="size-4" /></span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-ui font-semibold text-fg">
                        {item.title}
                        {item.done && <Check className="size-3.5 text-success" aria-label="Done" />}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">{item.description}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" className="mt-3 self-start" trailingIcon={<ArrowRight />} onClick={() => onQuickStart(item)}>
                    {item.id === 'agent' ? 'Set up the Agent' : item.id === 'gallery' ? 'Browse the Gallery' : item.action.label}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-6 pb-5 pt-4 max-sm:px-4">
        <Button onClick={onContinue} trailingIcon={<ArrowRight />} data-guide-continue autoFocus>See the checklist</Button>
        {onFeedback && (
          <Button variant="ghost" leadingIcon={<MessageSquareHeart />} onClick={onFeedback} data-guide-feedback>Send feedback</Button>
        )}
      </div>
    </div>
  )
}

/* ── Checklist ── */

function ChecklistScreen({ items, done, total, percent, agentAvailable, beta, onRun, onWelcome, onFeedback, onAskAgent }: {
  items: GuideItem[]
  done: number
  total: number
  percent: number
  agentAvailable: boolean
  beta: boolean
  onRun: (item: GuideItem, which?: 'primary' | 'agent') => void
  onWelcome: () => void
  onFeedback: (() => void) | null
  onAskAgent: () => void
}) {
  const { startTour } = useOnboarding()
  const isMobile = useIsMobile()
  const required = items.filter((i) => !i.optional)
  const optional = items.filter((i) => i.optional)
  const status = `${done} of ${total} done`
  return (
    <>
      <div className="flex items-center gap-4 border-b border-border-subtle px-6 pb-4 pt-5 max-sm:px-4">
        <ProgressRing percent={percent} size={48} label={status} />
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base font-semibold text-fg">Getting started</DialogTitle>
          <DialogDescription className="mt-0.5 text-ui text-fg-muted">
            <span data-guide-progress>{status}</span>
            <span aria-hidden> · </span>
            <button type="button" onClick={onWelcome} className="text-primary-text underline-offset-2 hover:underline">{beta ? 'Welcome & beta notes' : 'Welcome'}</button>
          </DialogDescription>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-sm:px-4" data-guide-checklist>
        <ul className="space-y-2">
          {required.map((item) => <ChecklistRow key={item.id} item={item} isMobile={isMobile} agentAvailable={agentAvailable} onRun={onRun} onTour={startTour} />)}
        </ul>
        {optional.length > 0 && (
          <>
            <p className="mb-2 mt-5 text-xs font-medium text-fg-muted">Optional</p>
            <ul className="space-y-2">
              {optional.map((item) => <ChecklistRow key={item.id} item={item} isMobile={isMobile} agentAvailable={agentAvailable} onRun={onRun} onTour={startTour} />)}
            </ul>
          </>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui">
          {agentAvailable && (
            <button type="button" onClick={onAskAgent} className="inline-flex items-center gap-1.5 font-medium text-primary-text hover:underline" data-guide-ask-agent>
              <Sparkles className="size-4" aria-hidden /> Ask the Agent to set this up for you
            </button>
          )}
          {onFeedback && (
            <button type="button" onClick={onFeedback} className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg" data-guide-feedback>
              <MessageSquareHeart className="size-4" aria-hidden /> Send feedback
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function ChecklistRow({ item, isMobile, agentAvailable, onRun, onTour }: {
  item: GuideItem
  isMobile: boolean
  agentAvailable: boolean
  onRun: (item: GuideItem, which?: 'primary' | 'agent') => void
  onTour: (tourId: string) => void
}) {
  const [stepsOpen, setStepsOpen] = useState(false)
  const stepsId = useId()
  const Icon = ITEM_ICONS[item.icon]
  const tour = tourById(item.tour)
  const steps = tour ? tourSteps(tour, { agentAvailable }) : []
  return (
    <li
      className={cn(
        'rounded-xl border p-3.5 transition-colors duration-[var(--ds-dur-fast)]',
        item.done ? 'border-border-subtle bg-subtle' : 'border-border bg-panel hover:border-border-strong',
      )}
      data-guide-item={item.id}
      data-done={item.done || undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg', item.done ? 'bg-success-wash text-success' : 'bg-primary-wash text-primary-text')}
          aria-hidden
        >
          {item.done ? <Check className="size-4" /> : <Icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-ui font-semibold', item.done ? 'text-fg-muted line-through decoration-fg-subtle' : 'text-fg')}>
            {item.title}
            <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{item.description}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant={item.done ? 'secondary' : 'primary'} onClick={() => (item.action.run === 'tour' && isMobile ? setStepsOpen((v) => !v) : onRun(item))} trailingIcon={item.action.href?.startsWith('/docs') ? undefined : <ArrowRight />}>
              {item.action.label}
            </Button>
            {item.agentAction && agentAvailable && (
              <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} onClick={() => onRun(item, 'agent')}>{item.agentAction.label}</Button>
            )}
            {steps.length > 0 && item.action.run !== 'tour' && (isMobile ? (
              <Button size="sm" variant="ghost" aria-expanded={stepsOpen} aria-controls={stepsId} trailingIcon={<ChevronDown className={cn('transition-transform', stepsOpen && 'rotate-180')} />} onClick={() => setStepsOpen((v) => !v)}>
                How to
              </Button>
            ) : (
              <Button size="sm" variant="ghost" leadingIcon={<PlayCircle />} onClick={() => onTour(tour!.id)} data-guide-tour={tour!.id}>Show me</Button>
            ))}
          </div>
          {isMobile && stepsOpen && (
            <ol id={stepsId} className="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-fg-muted" data-guide-steps={item.id}>
              {steps.filter((s) => !s.hint).map((s, i) => <li key={i}><span className="font-medium text-fg">{s.title}.</span> {s.body}</li>)}
            </ol>
          )}
        </div>
      </div>
    </li>
  )
}

/* ── Celebration ── */

function CelebrateScreen({ audience, onDone }: { audience: 'admin' | 'member'; onDone: () => void }) {
  return (
    <div className="relative overflow-hidden px-6 pb-6 pt-10 text-center max-sm:px-4" data-guide-celebrate>
      <div aria-hidden className="guide-confetti">
        {Array.from({ length: 18 }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}
      </div>
      <span className="relative mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-success-wash text-success" aria-hidden>
        <PartyPopper className="size-7" />
      </span>
      <DialogTitle className="relative mt-4 text-xl font-semibold text-fg">You&apos;re all set</DialogTitle>
      <DialogDescription className="relative mx-auto mt-1.5 max-w-sm text-sm text-fg-muted">
        {audience === 'admin'
          ? 'Your workspace is ready for your team. The guide stays in Help → Getting started if you want it again.'
          : 'You know your way around. The guide stays in Help → Getting started if you want it again.'}
      </DialogDescription>
      <Button className="relative mt-6" onClick={onDone} autoFocus data-guide-done>Done</Button>
    </div>
  )
}
