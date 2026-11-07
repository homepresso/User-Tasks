'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUpRight, CircleCheck, CircleX, Loader2, Undo2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'
import { formatTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import {
  backHref, completionScreenText, resolveTaskCompletion, runViewHref, taskCompletedOverride,
  type CompletionScreenText, type CompletionTone, type TaskNextStep,
} from '@/lib/tasks/completion-screen'

/**
 * The Task completed screen (lib/tasks/completion-screen.ts): what replaces
 * the task's tabs after the person actions it. Icon and tone follow the
 * outcome; "What you chose" (outcome, time) and "What happens next" (who
 * has it now, process complete, waiting on…); Next task, Back, Process view.
 * The heading takes focus and the texts are announced (role="status");
 * Esc goes Back. The entrance reuses the Submitted page's animation classes
 * (app/globals.css), which honour reduced motion.
 */

const TONE_CLASS: Record<CompletionTone, string> = {
  success: 'bg-success-wash text-success',
  warning: 'bg-warning-wash text-warning',
  neutral: 'bg-muted text-fg-muted',
}

function toneIcon(text: Pick<CompletionScreenText, 'kind'>): LucideIcon {
  if (text.kind === 'reject') return CircleX
  if (text.kind === 'return') return Undo2
  return CircleCheck
}

export interface TaskCompletedViewProps {
  text: CompletionScreenText
  completedAt: Date | string | null
  /** Buttons: a handler (or href) shows it. */
  onNextTask?: (() => void) | null
  onBack?: (() => void) | null
  onViewFlow?: (() => void) | null
  /** Compact: a row-sized version (no subheading card). */
  compact?: boolean
  /** Move focus to the heading when shown (off in previews). */
  autoFocus?: boolean
  /** Esc goes Back (off in previews). */
  escToBack?: boolean
  className?: string
}

export function TaskCompletedView({ text, completedAt, onNextTask, onBack, onViewFlow, compact = false, autoFocus = true, escToBack = true, className }: TaskCompletedViewProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (autoFocus) headingRef.current?.focus() }, [autoFocus])
  useEffect(() => {
    if (!escToBack || !onBack) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // A dialog / menu open on the page handles its own Esc.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escToBack, onBack])
  const Icon = toneIcon(text)
  const time = completedAt ? formatTime(completedAt) : ''

  return (
    <section
      aria-labelledby={headingId}
      className={cn('submitted-page-enter mx-auto flex w-full flex-col items-center text-center', compact ? 'max-w-full gap-2 py-3' : 'max-w-lg gap-4 py-8 sm:py-12', className)}
      data-task-completed={text.tone}
      data-outcome-kind={text.kind}
    >
      <span className={cn('submitted-page-icon flex items-center justify-center rounded-full', compact ? 'size-10' : 'size-16', TONE_CLASS[text.tone])} aria-hidden data-task-completed-icon={text.tone}>
        <Icon className={compact ? 'size-5' : 'size-8'} strokeWidth={2} />
      </span>
      <div role="status" aria-live="polite" className="space-y-1.5">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={cn('font-semibold text-fg outline-none', compact ? 'text-base' : 'text-title')} data-task-completed-heading>
          {text.heading}
        </h2>
        {text.subheading && !compact && <p className="text-sm text-fg-muted" data-task-completed-subheading>{text.subheading}</p>}
      </div>

      <dl className={cn('w-full divide-y divide-border-subtle rounded-lg border border-border bg-panel text-left text-ui', compact && 'text-xs')} data-task-completed-summary>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
          <dt className="text-fg-muted">What you chose</dt>
          <dd className="font-medium text-fg" data-task-completed-choice>
            {text.outcome}{time && <span className="ml-2 font-normal text-fg-muted num">{time}</span>}
          </dd>
        </div>
        {text.next_line && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
            <dt className="text-fg-muted">What happens next</dt>
            <dd className="flex items-center gap-1.5 font-medium text-fg" aria-live="polite" aria-busy={text.next_pending || undefined} data-task-completed-next>
              {text.next_pending && <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />}
              {text.next_line}
            </dd>
          </div>
        )}
      </dl>

      {(onNextTask || onBack || onViewFlow) && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 max-sm:flex-col max-sm:[&>*]:w-full" data-task-completed-actions>
          {onNextTask && (
            <Button size={compact ? 'sm' : 'md'} onClick={onNextTask} trailingIcon={<ArrowRight />} data-task-completed-button="next_task">
              {text.next_task_label}
            </Button>
          )}
          {onBack && (
            <Button size={compact ? 'sm' : 'md'} variant={onNextTask ? 'secondary' : 'primary'} onClick={onBack} data-task-completed-button="back">
              {text.back_label}
            </Button>
          )}
          {onViewFlow && (
            <Button size={compact ? 'sm' : 'md'} variant="ghost" onClick={onViewFlow} trailingIcon={<ArrowUpRight />} data-task-completed-button="view_flow">
              {text.view_flow_label}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/** How long the screen keeps asking while the queue processes the resume (then a neutral line). */
const POLL_MS = 1000
const POLL_LIMIT = 12

export interface TaskCompletedEvent {
  outcome: string
  at: Date
}

/**
 * The live screen for a task that was just actioned: reads the workspace
 * settings, what happens next and the next task (tasks.completedScreen),
 * asking again while the run is still processing (bounded), and applies
 * the task form's override (layout.task_completed).
 */
export function TaskCompletedScreen({ taskId, taskTitle, completed, formLayout, compact, onDone }: {
  taskId: string
  taskTitle: string
  completed: TaskCompletedEvent
  formLayout?: unknown
  compact?: boolean
  /** Called before navigating away (e.g. to clear page state). */
  onDone?: () => void
}) {
  const router = useRouter()
  const [polls, setPolls] = useState(0)
  const { data } = useQuery({
    queryKey: ['task-completed-screen', taskId, completed.at.getTime()],
    queryFn: async () => {
      setPolls((n) => n + 1)
      return (await serverRead('tasks.completedScreen', { taskId })).data ?? null
    },
    refetchInterval: (query) => (query.state.data?.next?.state === 'processing' && polls < POLL_LIMIT ? POLL_MS : false),
    staleTime: 0,
  })

  const text = useMemo(() => {
    if (!data) return null
    // Gave up waiting on the queue: a neutral line instead of a spinner.
    const next: TaskNextStep = data.next.state === 'processing' && polls >= POLL_LIMIT ? { ...data.next, state: 'unknown' } : data.next
    const settings = resolveTaskCompletion(data.settings, taskCompletedOverride(formLayout), completed.outcome)
    return {
      settings,
      next,
      text: completionScreenText(settings, {
        task_title: data.task.title || taskTitle, outcome: completed.outcome, user_name: data.user.name,
        process_name: next.process?.name ?? null, next, available_outcomes: data.task.available_outcomes,
      }),
    }
  }, [data, polls, formLayout, completed.outcome, taskTitle])

  if (!text || !data) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-12" role="status" aria-live="polite" data-task-completed="loading">
        <span className="ds-skeleton size-16 rounded-full" aria-hidden />
        <span className="ds-skeleton h-7 w-64 rounded" aria-hidden />
        <span className="sr-only">Task completed. Loading what happens next…</span>
      </div>
    )
  }
  const { settings } = text
  const go = (href: string) => { onDone?.(); router.push(href) }
  const flow = settings.show_view_flow ? runViewHref(text.next) : null
  return (
    <TaskCompletedView
      text={text.text}
      completedAt={completed.at}
      compact={compact}
      onNextTask={settings.show_next_task && data.next_task ? () => go(`/tasks/${data.next_task!.id}`) : null}
      onBack={settings.show_back ? () => go(backHref(settings.back_target)) : null}
      onViewFlow={flow ? () => go(flow) : null}
      escToBack={settings.show_back}
    />
  )
}
