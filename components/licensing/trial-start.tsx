'use client'

/**
 * "Start a 30-day trial" (Settings → Extensions, instance admins, self-hosted).
 *
 *   1. Name, work email, company and the farm ID (pre-filled from farms this
 *      installation knows, or from ?farm= when the SharePoint add-in sent the
 *      admin here), terms accepted.
 *   2. Online: the server asks usertasks.com and installs the licence → done.
 *   3. Offline (usertasks.com unreachable): the request code to copy, a link
 *      to the website's trial form, and a box to paste the licence it returns.
 */

import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { installLicenceAction, startTrialAction, trialFarmsAction, trialRequestCodeAction } from '@/app/actions/licence'

type Step = { kind: 'form' } | { kind: 'done'; message: string } | { kind: 'offline'; code: string; url: string; reason: string }

export interface TrialStartProps {
  extensionId: string
  extensionName: string
  days: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Farm id handed over by a link (?farm=…). */
  initialFarmId?: string | null
  defaults?: { name?: string; email?: string }
  onStarted: () => void
}

const TERMS_URL = 'https://usertasks.com/sharepoint/trial#terms'

export function TrialStart({ extensionId, extensionName, days, open, onOpenChange, initialFarmId, defaults, onStarted }: TrialStartProps) {
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [name, setName] = useState(defaults?.name ?? '')
  const [email, setEmail] = useState(defaults?.email ?? '')
  const [company, setCompany] = useState('')
  const [farmId, setFarmId] = useState(initialFarmId ?? '')
  const [farms, setFarms] = useState<Array<{ id: string; label?: string }>>([])
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep({ kind: 'form' })
    setError(null)
    trialFarmsAction(extensionId).then((r) => {
      if (!r.ok) return
      setFarms(r.data)
      if (!initialFarmId && r.data.length === 1) setFarmId(r.data[0].id)
    }).catch(() => undefined)
  }, [open, extensionId, initialFarmId])

  async function start() {
    setBusy(true); setError(null)
    const result = await startTrialAction({ extensionId, farmId, name, email, company, acceptTerms: accept })
    setBusy(false)
    if (!result.ok) { setError({ message: result.error }); return }
    const r = result.data
    if (r.mode === 'online') { setStep({ kind: 'done', message: r.message }); onStarted(); return }
    if (r.mode === 'offline') { setStep({ kind: 'offline', code: r.requestCode, url: r.trialUrl, reason: r.reason }); return }
    setError({ message: r.message, field: r.field })
  }

  async function offlineNow() {
    setBusy(true); setError(null)
    const result = await trialRequestCodeAction({ extensionId, farmId })
    setBusy(false)
    if (!result.ok) { setError({ message: result.error, field: 'farm_id' }); return }
    setStep({ kind: 'offline', code: result.data.requestCode, url: 'https://usertasks.com/sharepoint/trial', reason: 'You chose to start the trial from another computer.' })
  }

  async function installPasted() {
    setBusy(true); setError(null)
    const result = await installLicenceAction(pasted)
    setBusy(false)
    if (!result.ok) { setError({ message: result.error }); return }
    setStep({ kind: 'done', message: `Trial licence ${result.data.licence.licenceId} installed.` })
    onStarted()
  }

  const fieldError = (f: string) => (error?.field === f ? error.message : undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={`Start a ${days}-day ${extensionName} trial`} description="Free, no card. One trial per farm and per company.">
        <DialogBody className="space-y-4">
          {error && !error.field && <InlineNotice tone="danger" message={error.message} />}
          {step.kind === 'form' && (
            <>
              <Field label="Your name" error={fieldError('name')}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
              <Field label="Work email" description="The licence is also emailed here. Personal addresses can't be used." error={fieldError('email')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
              <Field label="Company" error={fieldError('company')}><Input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" /></Field>
              <Field label="SharePoint farm ID" description={<>A GUID. In SharePoint Management Shell run <code className="font-mono">(Get-SPFarm).Id</code>.{farms.length > 1 ? ' Or pick a farm UserTasks already knows below.' : ''}</>} error={fieldError('farm_id')}>
                <Input value={farmId} onChange={(e) => setFarmId(e.target.value)} placeholder="3f2504e0-4f89-11d3-9a0c-0305e82c3301" className="font-mono" data-testid="trial-farm-id" />
              </Field>
              {farms.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {farms.map((f) => <Button key={f.id} size="sm" variant="secondary" onClick={() => setFarmId(f.id)}>{f.label ?? f.id}</Button>)}
                </div>
              )}
              <Checkbox checked={accept} onChange={(e) => setAccept(e.target.checked)} label={<>I accept the <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline">trial terms</a>.</>} />
              {fieldError('accept_terms') && <p className="text-xs text-danger">{fieldError('accept_terms')}</p>}
              <p className="text-xs text-fg-muted">UserTasks sends your name, work email, company, the farm ID and this installation's id and address to usertasks.com, and installs the licence it returns. When the trial ends, the extension stops 24 hours later: lists go back to SharePoint's own forms and SharePoint-triggered workflows pause. Nothing is deleted; a licence brings it all back.</p>
            </>
          )}
          {step.kind === 'done' && <InlineNotice tone="success" message={<>{step.message} Turn the extension on below if it isn't already, then connect a site of that farm.</>} />}
          {step.kind === 'offline' && (
            <div className="space-y-3 text-ui">
              <InlineNotice tone="info" message={<>{step.reason}. Start the trial from any computer that can reach usertasks.com, then paste the licence here.</>} />
              <ol className="list-decimal space-y-1 pl-5">
                <li>Copy this request code (it holds the farm ID and this installation's id — no secrets).</li>
                <li>Open <a href={step.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">{step.url.replace(/^https?:\/\//, '')}<ExternalLink className="size-3" aria-hidden /></a>, paste the code and fill in the form. The licence is shown and emailed to you.</li>
                <li>Paste the licence below.</li>
              </ol>
              <div className="flex items-start gap-2">
                <code className="block flex-1 rounded-sm bg-subtle p-2 font-mono text-xs break-all" data-testid="trial-request-code">{step.code}</code>
                <Button size="sm" variant="secondary" leadingIcon={copied ? <Check /> : <Copy />} onClick={() => navigator.clipboard?.writeText(step.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
              <Field label="Paste your trial licence">
                <Textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} className="font-mono text-xs" placeholder='{"format": 1, "kind": "usertasks.licence", …}' />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {step.kind === 'form' && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void offlineNow()}>This server is offline</Button>
              <Button loading={busy} disabled={busy || !name.trim() || !email.trim() || !company.trim() || !farmId.trim() || !accept} onClick={() => void start()} data-testid="trial-start-submit">Start trial</Button>
            </>
          )}
          {step.kind === 'offline' && <Button loading={busy} disabled={busy || !pasted.trim()} onClick={() => void installPasted()}>Install licence</Button>}
          {step.kind === 'done' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
