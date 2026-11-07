'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { serverRead } from '@/lib/server-read'
import { customConfigFromManifest } from '@/lib/forms/custom-controls/field'
import { setPendingCustomControl } from '@/lib/forms/custom-controls/palette'
import type { FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { ControlIcon } from './control-icon'
import { DRAG_NEW_TYPE, paletteGroupClass, paletteItemClass } from './field-icons'

/**
 * The palette's "Custom" group: the workspace's enabled custom form
 * controls (Extensibility → Form controls), each placed at its latest
 * version like any field — click / Enter, or drag onto the grid.
 */

export function useFormControls(enabled = true) {
  return useQuery({
    queryKey: ['form-controls-palette'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => (await serverRead('forms.controls')).data ?? [],
  })
}

export function CustomControlsPalette({ onAdd, filter = '' }: { onAdd: () => void; /** The palette search (lower case). */ filter?: string }) {
  const { data: controls = [], isLoading } = useFormControls()
  const usable = controls.filter((c) => c.enabled && c.manifest && (!filter || c.name.toLowerCase().includes(filter)))
  if (filter && !usable.length) return null
  return (
    <div className="mb-2" data-palette-group="custom">
      <p className={paletteGroupClass}>Custom</p>
      {isLoading ? (
        <p className="px-2 text-2xs text-fg-muted">Loading…</p>
      ) : usable.length === 0 ? (
        <p className="px-2 text-2xs text-fg-muted">
          No custom controls yet. Add web components in <Link href="/extensibility?tab=form-controls" className="text-primary-text underline">Extensibility → Form controls</Link>.
        </p>
      ) : (
        <div>
          {usable.map((control) => {
            const manifest = control.manifest as FormControlManifest
            const pick = () => setPendingCustomControl(customConfigFromManifest(manifest))
            return (
              <button
                key={control.id}
                type="button"
                draggable
                onDragStart={(e) => { pick(); e.dataTransfer.setData(DRAG_NEW_TYPE, 'custom'); e.dataTransfer.effectAllowed = 'copy' }}
                onDragEnd={() => setTimeout(() => setPendingCustomControl(null), 0)}
                onClick={() => { pick(); onAdd() }}
                className={paletteItemClass}
                title={`${control.description ?? control.name} (<${control.tag}> ${control.latest_version})`}
                data-palette-type="custom"
                data-palette-control={control.tag}
              >
                <ControlIcon className="shrink-0 text-fg-muted" icon={control.icon} />
                <span className="min-w-0 flex-1 truncate">{control.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
