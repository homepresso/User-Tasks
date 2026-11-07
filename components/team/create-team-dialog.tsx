'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createTeam } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { SubmitButton } from '@/components/ui/submit-button'
import { TeamDetailsFields } from './team-details-fields'

interface CreateTeamDialogProps {
  teams: { id: string; name: string }[] // for parent picker
}

export function CreateTeamDialog({ teams }: CreateTeamDialogProps) {
  const [open, setOpen] = useState(false)
  // Synchronous guard: React 19 renders state set inside a form action only
  // when it ends, so a second click could otherwise submit again.
  const { run } = useSubmitGuard()
  const queryClient = useQueryClient()

  async function handleSubmit(formData: FormData) {
    await run(async () => {
      await createTeam(formData)
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['teams'] })
      await queryClient.invalidateQueries({ queryKey: ['org'] })
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button leadingIcon={<Plus />}>Create team</Button>
      </DialogTrigger>
      <DialogContent size="md" title="Create team">
        <form action={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Name">
              <Input name="name" required placeholder="e.g. Engineering" />
            </Field>
            <Field label="Description" optional>
              <Textarea name="description" rows={2} placeholder="What this team does" />
            </Field>
            <Field label="Parent team" optional>
              <Select name="parent_id" defaultValue="">
                <option value="">None (top level)</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <TeamDetailsFields />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
            <SubmitButton pendingLabel="Creating…">Create team</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
