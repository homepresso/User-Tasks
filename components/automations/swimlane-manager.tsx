'use client'

import { useState } from 'react'
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { CountBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Swimlane } from './workflow-builder'

const PRESET_COLORS = [
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#22C55E', // green
  '#F97316', // orange
]

interface SwimlaneManagerProps {
  swimlanes: Swimlane[]
  onChange: (swimlanes: Swimlane[]) => void
}

export function SwimlaneManager({ swimlanes, onChange }: SwimlaneManagerProps) {
  const [expanded, setExpanded] = useState(true)

  function addSwimlane() {
    // Calculate default y position below existing swimlanes and trigger zone
    const maxBottom = swimlanes.reduce((max, l) => Math.max(max, l.y + l.height), 120)
    const colorIdx = swimlanes.length % PRESET_COLORS.length
    const newLane: Swimlane = {
      id: crypto.randomUUID(),
      label: `Phase ${swimlanes.length + 1}`,
      color: PRESET_COLORS[colorIdx],
      y: maxBottom + 20,
      height: 200,
    }
    onChange([...swimlanes, newLane])
  }

  function updateLane(id: string, field: keyof Swimlane, value: string | number) {
    onChange(swimlanes.map(l => l.id === id ? { ...l, [field]: value } : l))
  }

  function removeLane(id: string) {
    onChange(swimlanes.filter(l => l.id !== id))
  }

  function moveLane(id: string, direction: 'up' | 'down') {
    const idx = swimlanes.findIndex(l => l.id === id)
    if (idx < 0) return
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === swimlanes.length - 1) return

    const sorted = [...swimlanes].sort((a, b) => a.y - b.y)
    const sortedIdx = sorted.findIndex(l => l.id === id)
    const swapIdx = direction === 'up' ? sortedIdx - 1 : sortedIdx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    // Swap y positions
    const tempY = sorted[sortedIdx].y
    sorted[sortedIdx] = { ...sorted[sortedIdx], y: sorted[swapIdx].y }
    sorted[swapIdx] = { ...sorted[swapIdx], y: tempY }
    onChange(sorted)
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="mb-2 flex w-full items-center gap-1.5 rounded-sm text-left text-fg-muted hover:text-fg"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Layers size={14} aria-hidden="true" />
        <span className="flex-1 text-xs font-medium">Swimlanes</span>
        <CountBadge count={swimlanes.length} />
      </button>

      {expanded && (
        <div className="space-y-2">
          <p className="text-xs text-fg-muted">
            Add horizontal lanes to organize workflow phases. Lanes are visual guides — nodes can be placed anywhere.
          </p>

          {swimlanes.sort((a, b) => a.y - b.y).map((lane) => (
            <Card
              key={lane.id}
              variant="inset"
              padding="sm"
              className="space-y-2"
            >
              {/* Label + color */}
              <div className="flex items-center gap-1.5">
                <div
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: lane.color }}
                  aria-hidden="true"
                />
                <Input
                  value={lane.label}
                  onChange={(e) => updateLane(lane.id, 'label', e.target.value)}
                  placeholder="Lane name"
                  size="sm"
                  className="flex-1"
                />
                <IconButton
                  size="sm"
                  variant="danger-ghost"
                  label="Remove lane"
                  icon={<Trash2 />}
                  onClick={() => removeLane(lane.id)}
                />
              </div>

              {/* Color picker */}
              <div className="flex gap-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => updateLane(lane.id, 'color', c)}
                    aria-label={`Lane colour ${c}`}
                    aria-pressed={lane.color === c}
                    className={cn('size-4 rounded-full transition-transform hover:scale-110', lane.color === c && 'ring-2 ring-border-strong ring-offset-1 ring-offset-panel')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>

              {/* Position + Height */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">
                    Y position
                  </label>
                  <Input
                    type="number"
                    value={lane.y}
                    onChange={(e) => updateLane(lane.id, 'y', Math.max(0, parseInt(e.target.value) || 0))}
                    size="sm"
                    className="num font-mono"
                    step={20}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">
                    Height
                  </label>
                  <Input
                    type="number"
                    value={lane.height}
                    onChange={(e) => updateLane(lane.id, 'height', Math.max(60, parseInt(e.target.value) || 100))}
                    size="sm"
                    className="num font-mono"
                    step={20}
                  />
                </div>
              </div>
            </Card>
          ))}

          <Button
            size="sm"
            variant="secondary"
            onClick={addSwimlane}
            className="w-full"
            leadingIcon={<Plus />}
          >
            Add swimlane
          </Button>
        </div>
      )}
    </div>
  )
}
