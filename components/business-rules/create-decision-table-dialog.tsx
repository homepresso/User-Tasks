'use client'

import { useRef, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { createDecisionTable, createDecisionTableFromImport } from '@/app/actions/business-rules'
import { useSubmitGuard } from '@/hooks/use-submit-guard'

export function CreateDecisionTableDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const { pending: submitting, run } = useSubmitGuard()
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)

  async function handleCreate() {
    if (!name.trim()) return
    await run(async () => {
      try {
        const formData = new FormData()
        formData.set('name', name)
        formData.set('description', description)
        const created = await createDecisionTable(formData)
        setOpen(false)
        setName('')
        setDescription('')
        router.push(`/automations/rules/${created.id}`)
        router.refresh()
      } catch (err: any) {
        setNotice({ tone: 'error', message: err.message ?? 'Failed to create business rule' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" leadingIcon={<Plus />}>New decision table</Button>
      </DialogTrigger>
      <DialogContent size="sm" title="New decision table" description="Create a decision table with custom inputs, outputs and rule rows.">
        <DialogBody className="space-y-4">
          {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Expense approval matrix" />
          </Field>
          <Field label="Description" optional>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
              placeholder="Context for admins and workflow designers"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={handleCreate} disabled={!name.trim() || submitting} loading={submitting}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ImportDecisionTableButton() {
  const router = useRouter()
  const importRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      setImporting(true)
      try {
        const parsed = JSON.parse(reader.result as string)
        const imported = parsed.decisionTable ?? parsed.decision_table ?? parsed
        if (!Array.isArray(imported.inputs) || !Array.isArray(imported.outputs) || !Array.isArray(imported.rules)) {
          setNotice({ tone: 'error', message: 'Invalid decision table file. Expected inputs, outputs, and rules arrays.' })
          return
        }
        const created = await createDecisionTableFromImport({
          name: imported.name ?? file.name.replace(/\.json$/, ''),
          description: imported.description ?? '',
          inputs: imported.inputs,
          outputs: imported.outputs,
          rules: imported.rules,
        })
        router.push(`/automations/rules/${created.id}`)
        router.refresh()
      } catch (err: any) {
        setNotice({ tone: 'error', message: err?.message ?? 'Failed to import decision table JSON' })
      } finally {
        setImporting(false)
        e.target.value = ''
      }
    }
    reader.readAsText(file)
  }

  return (
    <>
      {notice && (
        <div className="mb-3">
          <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
        </div>
      )}
      <Button size="sm" variant="secondary" leadingIcon={<Upload />} onClick={() => importRef.current?.click()} disabled={importing}>
        {importing ? 'Importing…' : 'Import decision table'}
      </Button>
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
    </>
  )
}
