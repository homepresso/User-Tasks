'use client'

import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Plus, Upload, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { createDecisionTable, createDecisionTableFromImport } from '@/app/actions/business-rules'

export function CreateDecisionTableDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)

  async function handleCreate() {
    if (!name.trim()) return
    setSubmitting(true)
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
    setSubmitting(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Plus size={14} className="mr-1" /> New Business Rule
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          {notice && (
            <div className="mb-4">
              <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
            </div>
          )}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <Dialog.Title className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                Create Business Rule
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Create a decision table with custom inputs, outputs, and rule rows.
              </Dialog.Description>
            </div>
            <Dialog.Close className="hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Expense Approval Matrix" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                placeholder="Optional context for admins and workflow designers"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </Dialog.Close>
            <Button onClick={handleCreate} disabled={!name.trim() || submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
      <Button size="sm" variant="outline" onClick={() => importRef.current?.click()} disabled={importing}>
        <Upload size={14} className="mr-1" /> {importing ? 'Importing…' : 'Import Decision Table'}
      </Button>
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
    </>
  )
}
