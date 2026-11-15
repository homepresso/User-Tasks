'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, Check, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cn } from '@/lib/utils'
import { setupWizardStep } from '@/app/actions/setup-wizard'
import { WIZARD_STEPS, stepAfter, stepBefore, type WizardStepId } from '@/lib/setup/wizard-model'
import type { WizardPageData } from '@/lib/setup/wizard-data'
import { DoneStep, OrganisationStep, ServicesStep } from './steps'
import { SignInStep } from './sign-in-step'
import { EmailStep } from './email-step'
import { TeamStep } from './team-step'

/**
 * The setup wizard (/settings/setup): a step rail on the left, one step at
 * a time on the right. Every step can be skipped and opened again later
 * from the rail; nothing here is required to use UserTasks.
 */

export function stepHref(step: WizardStepId, extra = ''): string {
  return `/settings/setup?step=${step}${extra}`
}

/** Footer of every step: Back, Skip for now, and the step's own primary action (or Continue). */
export function StepFooter({ step, primary, canSkip = true }: { step: WizardStepId; primary?: React.ReactNode; canSkip?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const go = (status: 'done' | 'skipped') => start(async () => {
    setError(null)
    const res = await setupWizardStep(step, status)
    if (!res.ok) { setError(res.error); return }
    router.push(stepHref(stepAfter(step)))
  })
  return (
    <div className="space-y-2 border-t border-border-subtle pt-4">
      {error && <InlineNotice tone="danger" message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        {step !== 'organisation' && (
          <Button variant="ghost" asChild>
            <Link href={stepHref(stepBefore(step))}><ArrowLeft className="size-4" aria-hidden /> Back</Link>
          </Button>
        )}
        <span className="flex-1" />
        {canSkip && step !== 'done' && (
          <Button variant="ghost" disabled={pending} onClick={() => go('skipped')}>Skip for now</Button>
        )}
        {primary ?? (
          <Button disabled={pending} trailingIcon={<ArrowRight />} onClick={() => go('done')}>Continue</Button>
        )}
      </div>
    </div>
  )
}

export function SetupWizard({ data }: { data: WizardPageData }) {
  const current = WIZARD_STEPS.find((s) => s.id === data.step)!
  const index = WIZARD_STEPS.findIndex((s) => s.id === data.step)
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-1">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Setup wizard · step {index + 1} of {WIZARD_STEPS.length}</p>
        <h1 className="text-2xl font-semibold text-fg">{current.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{current.summary} Skip anything you don&apos;t need yet: you can come back here, and Settings → Infrastructure has the same controls.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Setup steps">
          <ol className="space-y-1">
            {WIZARD_STEPS.map((s, i) => {
              const status = s.id === 'account' ? 'done' : data.progress.steps[s.id]
              const active = s.id === data.step
              const body = (
                <>
                  <span className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                    status === 'done' ? 'bg-primary text-primary-fg' : active ? 'bg-primary-wash text-primary-text ring-1 ring-primary' : 'bg-muted text-fg-muted',
                  )}>
                    {status === 'done' ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{s.title}</span>
                    {status === 'skipped' && <span className="block text-xs text-fg-muted">Skipped</span>}
                  </span>
                  <span className="sr-only">{status === 'done' ? ', done' : status === 'skipped' ? ', skipped' : ''}</span>
                </>
              )
              const cls = cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', active ? 'bg-subtle font-medium text-fg' : 'text-fg-muted')
              return (
                <li key={s.id}>
                  {s.id === 'account'
                    ? <span className={cls}>{body}</span>
                    : <Link href={stepHref(s.id)} className={cn(cls, 'hover:bg-subtle hover:text-fg')} aria-current={active ? 'step' : undefined}>{body}</Link>}
                </li>
              )
            })}
          </ol>
          <Link href="/settings/infrastructure" className="mt-4 flex items-center gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"><Server className="size-3.5" aria-hidden /> Settings → Infrastructure</Link>
        </nav>
        <section aria-labelledby="wizard-step-title" className="min-w-0 space-y-5 rounded-xl border border-border bg-panel p-5">
          <h2 id="wizard-step-title" className="sr-only">{current.title}</h2>
          {data.step === 'organisation' && <OrganisationStep data={data} />}
          {data.step === 'services' && <ServicesStep data={data} />}
          {data.step === 'sign-in' && <SignInStep data={data} />}
          {data.step === 'email' && <EmailStep data={data} />}
          {data.step === 'team' && <TeamStep data={data} />}
          {data.step === 'done' && <DoneStep data={data} />}
        </section>
      </div>
    </div>
  )
}
