'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import {
  AAD_GROUP_MODE_HELP,
  AAD_GROUP_MODE_LABELS,
  AAD_GROUP_MODES,
  AAD_NOT_CONFIGURED_MESSAGE,
  aadGroupConfigOf,
  assignmentOptions,
  type DirectoryCapabilities,
} from '@/lib/tasks/aad-group-assignment'

/**
 * User Task "AAD Group" assignment (lib/tasks/aad-group-assignment.ts): the
 * Assignment segments (AAD Group only when Entra ID is configured, or when
 * the node already uses it) and the group picker / mode settings.
 */

/** The workspace's directory capabilities (directory.capabilities); null while loading or on error. */
export function useDirectoryCapabilities(): DirectoryCapabilities | null {
  const { data } = useQuery({
    queryKey: ['directory-capabilities'],
    queryFn: async () => (await serverRead('directory.capabilities')).data ?? null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return (data as DirectoryCapabilities | null | undefined) ?? null
}

export function AssignmentSegments({ value, capabilities, onChange }: {
  value: string | null | undefined
  capabilities: Pick<DirectoryCapabilities, 'entraGroups'> | null
  onChange: (value: string) => void
}) {
  const current = value ?? 'individual'
  return (
    <div className="flex gap-0.5 rounded-md bg-muted p-0.5 mb-2" role="group" aria-label="Assignment" data-assignment-segments>
      {assignmentOptions(capabilities, current).map((o) => (
        <button key={o.val} type="button"
          onClick={() => onChange(o.val)}
          aria-pressed={current === o.val}
          data-assignment-option={o.val}
          className={`flex-1 text-xs font-medium py-1 rounded transition-colors ${current === o.val ? 'bg-panel text-fg shadow-elev-1' : 'text-fg-muted hover:text-fg'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface GroupOption { id: string; name: string; description: string | null; team_id: string | null }

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function EntraGroupPicker({ selectedId, selectedName, onSelect }: {
  selectedId: string
  selectedName: string
  onSelect: (id: string, name: string) => void
}) {
  const [open, setOpen] = useState(!selectedId)
  const [search, setSearch] = useState('')
  const [extra, setExtra] = useState<{ groups: GroupOption[]; cursor: string | null } | null>(null)
  const debounced = useDebounced(search.trim(), 300)
  const { data, isFetching, error } = useQuery({
    queryKey: ['entra-groups', debounced],
    queryFn: async () => {
      const result = await serverRead('directory.entraGroups', { search: debounced || undefined })
      if (result.error) throw new Error(result.error.message)
      return result.data as { groups: GroupOption[]; next_cursor: string | null; source: string }
    },
    enabled: open,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  useEffect(() => { setExtra(null) }, [debounced])
  const groups = [...(data?.groups ?? []), ...(extra?.groups ?? [])]
  const nextCursor = extra ? extra.cursor : data?.next_cursor ?? null

  const loadMore = async () => {
    if (!nextCursor) return
    const result = await serverRead('directory.entraGroups', { search: debounced || undefined, cursor: nextCursor })
    const page = result.data as { groups: GroupOption[]; next_cursor: string | null } | null
    if (page) setExtra({ groups: [...(extra?.groups ?? []), ...page.groups], cursor: page.next_cursor })
  }

  if (selectedId && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs border-primary bg-primary-wash" data-aad-group-selected>
        <span className="min-w-0 flex-1 text-primary-text">
          <span className="block truncate">{selectedName || selectedId}</span>
          <span className="block truncate text-2xs text-fg-muted">Entra ID group · {selectedId}</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="text-2xs underline text-fg-muted">Change</button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search Entra ID groups…"
        aria-label="Search Entra ID groups"
        className="w-full rounded-md border px-3 py-2 text-xs outline-none bg-panel border-border text-fg"
      />
      <div className="max-h-52 overflow-y-auto rounded-lg border bg-panel border-border" role="listbox" aria-label="Entra ID groups">
        {error ? (
          <p className="px-3 py-2 text-xs text-danger">{error instanceof Error ? error.message : 'Group search failed'}</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-muted">{isFetching ? 'Searching…' : 'No groups found'}</p>
        ) : (
          groups.map((group) => (
            <button key={group.id} type="button" role="option" aria-selected={group.id === selectedId}
              onClick={() => { onSelect(group.id, group.name); setOpen(false); setSearch('') }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted">
              <span className="block truncate text-fg">{group.name}</span>
              {group.description ? <span className="block truncate text-2xs text-fg-muted">{group.description}</span> : null}
            </button>
          ))
        )}
        {nextCursor && !error ? (
          <button type="button" onClick={() => void loadMore()} className="block w-full px-3 py-1.5 text-left text-2xs underline text-fg-muted">Load more</button>
        ) : null}
      </div>
      {selectedId ? (
        <button type="button" onClick={() => setOpen(false)} className="text-2xs underline text-fg-muted">Keep {selectedName || 'the current group'}</button>
      ) : null}
    </div>
  )
}

/** The AAD Group settings shown under the Assignment segments. */
export function AadGroupAssignmentConfig({ config, capabilities, onUpdate, onBatchUpdate }: {
  config: Record<string, any>
  capabilities: DirectoryCapabilities | null
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
}) {
  const c = aadGroupConfigOf(config)
  // Capability known and false: the saved config stays, with a warning (it runs unassigned).
  const unavailable = capabilities !== null && !capabilities.entraGroups
  return (
    <div className="space-y-2" data-aad-group-config>
      {unavailable ? (
        <div data-aad-group-warning>
          <InlineNotice tone="warning" title="Entra ID is not configured">
            <p className="text-xs">{AAD_NOT_CONFIGURED_MESSAGE}. Until it is reconnected this task is created unassigned.</p>
            {c.groupId ? <p className="mt-1 text-2xs text-fg-muted">Saved group: {c.groupName || c.groupId}</p> : null}
          </InlineNotice>
        </div>
      ) : (
        <EntraGroupPicker
          selectedId={c.groupId}
          selectedName={c.groupName}
          onSelect={(id, name) => onBatchUpdate({ aad_group_id: id || undefined, aad_group_name: name || undefined })}
        />
      )}

      <div className="space-y-1.5 rounded-lg p-2.5 bg-subtle" role="radiogroup" aria-label="Who gets the task">
        {AAD_GROUP_MODES.map((mode) => (
          <label key={mode} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="aad_group_mode" className="mt-0.5" checked={c.mode === mode}
              onChange={() => onUpdate('aad_group_mode', mode)} data-aad-group-mode={mode} />
            <span>
              <span className="block text-xs text-fg">{AAD_GROUP_MODE_LABELS[mode]}</span>
              <span className="block text-2xs text-fg-muted">{AAD_GROUP_MODE_HELP[mode]}</span>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-2 cursor-pointer pt-1">
          <Checkbox checked={c.includeNested} onChange={(e) => onUpdate('aad_include_nested', e.target.checked)} className="mt-0.5" />
          <span>
            <span className="block text-xs text-fg">Include members of nested groups</span>
            <span className="block text-2xs text-fg-muted">Off: only the group&apos;s direct members get the task.</span>
          </span>
        </label>
      </div>
      <p className="text-2xs text-fg-muted">
        Members are looked up in Entra ID when the step runs; people without a UserTasks account in this workspace are skipped (noted in the run log).
      </p>
    </div>
  )
}
