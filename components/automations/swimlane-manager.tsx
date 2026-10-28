'use client'

import { useState } from 'react'
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
        className="flex items-center gap-1.5 w-full text-left mb-2"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={14} style={{ color: 'var(--theme-primary-text)' }} />
        <span className="text-xs font-semibold flex-1">Swimlanes</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
        >
          {swimlanes.length}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--theme-muted-text)' }}>
            Add horizontal lanes to organize workflow phases. Lanes are visual guides — nodes can be placed anywhere.
          </p>

          {swimlanes.sort((a, b) => a.y - b.y).map((lane) => (
            <div
              key={lane.id}
              className="rounded-lg border p-2.5 space-y-1.5"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
            >
              {/* Label + color */}
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm shrink-0 border"
                  style={{ backgroundColor: lane.color, borderColor: lane.color }}
                />
                <Input
                  value={lane.label}
                  onChange={(e) => updateLane(lane.id, 'label', e.target.value)}
                  placeholder="Lane name"
                  className="!text-xs !h-7 flex-1"
                />
                <button
                  onClick={() => removeLane(lane.id)}
                  className="p-1 rounded hover:text-red-500 shrink-0"
                  style={{ color: 'var(--theme-muted-text)' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Color picker */}
              <div className="flex gap-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => updateLane(lane.id, 'color', c)}
                    className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: lane.color === c ? `2px solid ${c}` : 'none',
                      outlineOffset: '1px',
                    }}
                  />
                ))}
              </div>

              {/* Position + Height */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                    Y Position
                  </label>
                  <Input
                    type="number"
                    value={lane.y}
                    onChange={(e) => updateLane(lane.id, 'y', Math.max(0, parseInt(e.target.value) || 0))}
                    className="!text-xs !h-6 font-mono"
                    step={20}
                  />
                </div>
                <div>
                  <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                    Height
                  </label>
                  <Input
                    type="number"
                    value={lane.height}
                    onChange={(e) => updateLane(lane.id, 'height', Math.max(60, parseInt(e.target.value) || 100))}
                    className="!text-xs !h-6 font-mono"
                    step={20}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            onClick={addSwimlane}
            className="w-full !text-xs !h-7"
          >
            <Plus size={12} className="mr-1" /> Add Swimlane
          </Button>
        </div>
      )}
    </div>
  )
}
