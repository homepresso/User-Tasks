'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createCustomTable } from '@/app/actions/data-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { ImportWizard } from './import-wizard'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { SubmitButton } from '@/components/ui/submit-button'

export function CreateTableDialog() {
  const searchParams = useSearchParams()
  // "+ New › Data table" and Cmd-K link to /data?new=1: start open, then drop the param.
  const wantsNew = searchParams.get('new') === '1'
  const [open, setOpen] = useState(wantsNew)
  // Also when already on /data (the component stays mounted): adjust during render.
  const [seenNew, setSeenNew] = useState(wantsNew)
  if (wantsNew !== seenNew) {
    setSeenNew(wantsNew)
    if (wantsNew) setOpen(true)
  }
  // Synchronous guard: React 19 renders state set inside a form action only
  // when it ends, so a second click could otherwise submit again.
  const { run } = useSubmitGuard()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!wantsNew) return
    const rest = new URLSearchParams(searchParams.toString())
    rest.delete('new')
    const qs = rest.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [wantsNew, searchParams, pathname, router])

  const [clash, setClash] = useState<{ name: string; suggestion: string; description: string } | null>(null)
  // Create from file: the import wizard infers the columns, creates the table and imports the rows.
  const [fromFile, setFromFile] = useState<{ name: string } | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  async function create(formData: FormData) {
    const created = await createCustomTable(formData)
    if (created && 'exists' in created && created.exists) {
      setClash({ name: created.name, suggestion: created.suggestion, description: String(formData.get('description') ?? '') })
      return
    }
    setClash(null)
    setOpen(false)
    // Straight to the new table's schema so columns can be added.
    if (created && 'id' in created && created.id) router.push(`/data/${created.id}?tab=schema`)
  }

  async function handleSubmit(formData: FormData) {
    await run(() => create(formData))
  }

  async function acceptSuggestion() {
    if (!clash) return
    const formData = new FormData()
    formData.set('name', clash.suggestion)
    formData.set('description', clash.description)
    await run(() => create(formData))
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setClash(null) }}>
      <DialogTrigger asChild>
        <Button leadingIcon={<Plus />}>New table</Button>
      </DialogTrigger>
      <DialogContent size="sm" title="New table" description="Name the table; you add its columns next.">
        <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <Field label="Name">
              <Input ref={nameRef} name="name" required placeholder="e.g. Clients" autoFocus />
            </Field>
            <Field label="Description" optional>
              <Input name="description" placeholder="What the table holds" />
            </Field>
            {clash && (
              <div data-testid="table-name-exists"><InlineNotice tone="warning">
                <p>A table named <strong>{clash.name}</strong> already exists. Create <strong>{clash.suggestion}</strong> instead?</p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" onClick={() => void acceptSuggestion()}>Create “{clash.suggestion}”</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setClash(null)}>Choose another name</Button>
                </div>
              </InlineNotice></div>
            )}
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              leadingIcon={<FileSpreadsheet />}
              data-testid="create-table-from-file"
              onClick={() => { setFromFile({ name: nameRef.current?.value.trim() ?? '' }); setOpen(false); setClash(null) }}
            >
              Create from file
            </Button>
            <div className="flex gap-2">
              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
              <SubmitButton pendingLabel="Creating…">Create table</SubmitButton>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {fromFile && <ImportWizard open onOpenChange={(next) => { if (!next) setFromFile(null) }} createName={fromFile.name} />}
    </>
  )
}
