'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createCustomTable } from '@/app/actions/data-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, X } from 'lucide-react'

export function CreateTableDialog() {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    await createCustomTable(formData)
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm"><Plus size={16} className="mr-1" /> New Table</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-lg p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Create Table</Dialog.Title>
            <Dialog.Close className="hover:opacity-70"><X size={18} /></Dialog.Close>
          </div>
          <form action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Table Name</label>
              <Input name="name" required placeholder="e.g. Clients" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Input name="description" placeholder="Optional description" />
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline">Cancel</Button></Dialog.Close>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
