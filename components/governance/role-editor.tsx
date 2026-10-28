'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
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
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      await onSave({ name: name.trim(), description: description.trim(), permissions: [...permissions] }, role?.id)
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  function togglePermission(key: string) {
    setPermissions(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleGroup(keys: string[]) {
    setPermissions(prev => {
      const next = new Set(prev)
      const allSelected = keys.every(k => next.has(k))
      keys.forEach(k => allSelected ? next.delete(k) : next.add(k))
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8" onClick={onClose}>
      <Card
        className="w-full max-w-3xl p-6 space-y-5"
        style={{ backgroundColor: 'var(--theme-card-bg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {role ? `Edit ${role.name}` : 'Create Role'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
            <X size={16} style={{ color: 'var(--theme-muted-text)' }} />
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Role Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Approver" disabled={role?.is_system} />
            {role?.is_system && <p className="text-[10px] mt-1" style={{ color: '#94a3b8' }}>System role names cannot be changed. You can edit the description and permissions.</p>}
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this role is for" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-muted-text)' }}>
              Permissions ({permissions.size} selected)
            </label>
            <div className="flex gap-2">
              <button onClick={() => setPermissions(new Set())} className="text-[10px] text-[color:var(--theme-card-text)] hover:underline">Clear all</button>
            </div>
          </div>
          <RolePermissionsGrid
            selected={permissions}
            onToggle={togglePermission}
            onToggleGroup={toggleGroup}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
