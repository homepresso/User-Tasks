'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { SearchableEntityPicker } from '@/components/ui/searchable-entity-picker'
import { Button } from '@/components/ui/button'
import { assignRetentionPolicy } from '@/app/actions/retention-policies'
import type { RetentionPolicy } from '@/lib/retention-policies'

interface Props {
  targetType: 'data_table' | 'data_row' | 'role'
  targetId: string
  currentPolicyId?: string | null
  allowedScope: 'data_tables' | 'data_rows' | 'roles'
  compact?: boolean
}

function describePolicy(policy: Partial<RetentionPolicy> & { name?: string | null; description?: string | null }) {
  if (policy.description?.trim()) return policy.description.trim()
  const mode = String(policy.policy_mode ?? '').trim()
  if (mode) return `${mode.replace(/_/g, ' ')} policy`
  return 'Retention policy'
}

export function RetentionPolicyAssignment({
  targetType,
  targetId,
  currentPolicyId = null,
  allowedScope,
  compact = false,
}: Props) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(currentPolicyId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: policies = [] } = useQuery({
    queryKey: ['retention-policies', allowedScope],
    // Filtered to the scope server-side.
    queryFn: async () => (await serverQuery('governance.retentionPolicies', { scope: allowedScope })) as RetentionPolicy[],
  })

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await assignRetentionPolicy({
        targetType,
        targetId,
        retentionPolicyId: selectedId || null,
      })
      queryClient.invalidateQueries({ queryKey: ['custom-table', targetId] })
      queryClient.invalidateQueries({ queryKey: ['custom-table-rows'] })
      queryClient.invalidateQueries({ queryKey: ['governance'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save retention policy')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && (
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Applied Retention Policy</h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            Assign a centrally governed retention policy to this asset.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="w-full">
          <SearchableEntityPicker
            items={policies.map((policy) => ({
              id: policy.id,
              name: policy.name,
              subtitle: describePolicy(policy),
            }))}
            selectedId={selectedId}
            placeholder="Search retention policies..."
            emptyLabel="No matching retention policies found"
            onSelect={(id) => setSelectedId(id)}
          />
        </div>
        <Button type="button" variant="outline" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Apply'}
        </Button>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--theme-danger, #DC2626)' }}>{error}</p>}
    </div>
  )
}
