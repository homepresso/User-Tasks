'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- role rows come untyped from governance.settingsPage */

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { RolePermissionsGrid } from './role-permissions-grid'

interface Props {
  role?: any
  onSave: (data: { name: string; description: string; permissions: string[] }, roleId?: string) => Promise<void>
  onClose: () => void
}

export function RoleEditor({ role, onSave, onClose }: Props) {
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<Set<string>>(new Set(role?.permissions ?? []))
  const [saving, setSaving] = useState(false)
  // Synchronous guard: two clicks in one frame both see saving === false.
  const saveGuard = useSubmitGuard()
  const [error, setError] = useState('')

  async function handleSave() {
    await saveGuard.run(async () => {
      if (!name.trim()) return
      setSaving(true)
      setError('')
      try {
        await onSave({ name: name.trim(), description: description.trim(), permissions: [...permissions] }, role?.id)
      } catch (err: any) {
        setError(err.message)
      }
      setSaving(false)
    })
  }

  function togglePermission(key: string) {
    setPermissions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleGroup(keys: string[]) {
    setPermissions(prev => {
      const next = new Set(prev)
      const allSelected = keys.every(k => next.has(k))
      keys.forEach(k => { if (allSelected) next.delete(k); else next.add(k) })
      return next
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg" title={role ? `Edit ${role.name}` : 'New role'} description="A role is a named set of permissions you assign to people.">
        <DialogBody className="space-y-5">
          {error && <InlineNotice tone="danger" message={error} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" description={role?.is_system ? 'System role names can’t be changed; the description and permissions can.' : undefined}>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Approver" disabled={role?.is_system} />
            </Field>
            <Field label="Description" optional>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this role is for" />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-ui font-medium text-fg">
                Permissions <span className="num font-normal text-fg-muted">{permissions.size} selected</span>
              </p>
              <Button type="button" variant="link" size="sm" onClick={() => setPermissions(new Set())} disabled={permissions.size === 0}>Clear all</Button>
            </div>
            <RolePermissionsGrid
              selected={permissions}
              onToggle={togglePermission}
              onToggleGroup={toggleGroup}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} loading={saving}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
