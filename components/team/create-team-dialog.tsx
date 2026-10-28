'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createTeam } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, X } from 'lucide-react'

interface CreateTeamDialogProps {
  teams: { id: string; name: string }[] // for parent picker
}

export function CreateTeamDialog({ teams }: CreateTeamDialogProps) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    await createTeam(formData)
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm"><Plus size={16} className="mr-1" /> Create Team</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900 dark:text-white">Create Team</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600"><X size={18} /></Dialog.Close>
          </div>
          <form action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <Input name="name" required placeholder="e.g. Engineering" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea name="description" rows={2}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                placeholder="Optional description" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Parent Team</label>
              <select name="parent_id"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                <option value="">None (top-level)</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
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
