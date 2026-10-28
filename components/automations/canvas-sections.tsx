"use client"

import type { WorkflowNode } from "@/lib/workflow-schema"
import { getSectionDimensions, SECTION_COLLAPSED_WIDTH, SECTION_HEADER_HEIGHT } from "@/lib/workflow-sections"

export const TRIGGER_ZONE_HEIGHT = 100

function rgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16) || 0,
    g: parseInt(hex.slice(3, 5), 16) || 0,
    b: parseInt(hex.slice(5, 7), 16) || 0,
  }
}

interface Lane { id: string; label: string; color: string; y: number; height: number }

/** Trigger band and swimlanes behind the steps — the same on the designer and the viewers. */
export function CanvasBands({ showTriggerZone, swimlanes }: { showTriggerZone: boolean; swimlanes: Lane[] }) {
  return (
    <>
      {showTriggerZone && (
        <div
          className="absolute top-0 left-0 pointer-events-none rounded-t-lg"
          style={{
            width: "100%",
            height: `${TRIGGER_ZONE_HEIGHT}px`,
            backgroundColor: "rgba(34, 197, 94, 0.04)",
            borderBottom: "1px dashed rgba(34, 197, 94, 0.2)",
          }}
          data-trigger-zone=""
        >
          <span className="absolute top-2 left-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--theme-success)" }}>
            Triggers
          </span>
        </div>
      )}
      {swimlanes.map((lane) => {
        const { r, g, b } = rgb(lane.color)
        return (
          <div
            key={lane.id}
            className="absolute left-0 pointer-events-none"
            style={{
              top: `${lane.y}px`,
              width: "100%",
              height: `${lane.height}px`,
              backgroundColor: `rgba(${r}, ${g}, ${b}, 0.04)`,
              borderTop: `1px dashed rgba(${r}, ${g}, ${b}, 0.25)`,
              borderBottom: `1px dashed rgba(${r}, ${g}, ${b}, 0.25)`,
            }}
          >
            <span className="absolute top-2 left-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: `rgba(${r}, ${g}, ${b}, 0.5)` }}>
              {lane.label}
            </span>
          </div>
        )
      })}
    </>
  )
}

interface SectionFrameProps {
  section: WorkflowNode
  collapsed: boolean
  nodeCount: number
  onToggle: () => void
  /** Designer: an editable title input; viewers: the label. */
  title?: React.ReactNode
  /** Runtime tint of the count badge (a step inside failed / all completed). */
  tone?: 'danger' | 'success'
  /** Designer: wraps the header in its drag handle. */
  wrapHeader?: (header: React.ReactNode) => React.ReactNode
  /** Designer: resize handle (expanded only). */
  resizeHandle?: React.ReactNode
  interactive?: boolean
}

/** A section_group container: frame + header (toggle, title, step count). */
export function SectionFrame({ section, collapsed, nodeCount, onToggle, title, tone, wrapHeader, resizeHandle, interactive = false }: SectionFrameProps) {
  const { width, height, color } = getSectionDimensions(section)
  const { r, g, b } = rgb(color)
  const header = (
    <div
      className="flex items-center gap-2 px-3 rounded-t-[10px] select-none pointer-events-auto"
      style={{
        height: SECTION_HEADER_HEIGHT,
        cursor: interactive ? "grab" : "pointer",
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)`,
        borderBottom: collapsed ? 'none' : `1px solid rgba(${r}, ${g}, ${b}, 0.15)`,
      }}
      onDoubleClick={interactive ? onToggle : undefined}
      onClick={interactive ? undefined : onToggle}
    >
      <button
        type="button"
        className="text-[10px] w-5 h-5 flex items-center justify-center rounded hover:opacity-70 shrink-0"
        style={{ color }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand section ${section.label}` : `Collapse section ${section.label}`}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
      >
        {collapsed ? '▶' : '▼'}
      </button>
      {title ?? <span className="text-xs font-semibold flex-1 min-w-0 truncate" style={{ color }}>{section.label}</span>}
      <span className="text-[9px] font-medium shrink-0 px-1.5 py-0.5 rounded-full"
        style={{
          backgroundColor: tone === 'danger' ? 'var(--status-danger-bg)' : tone === 'success' ? 'var(--status-success-bg)' : `rgba(${r}, ${g}, ${b}, 0.15)`,
          color: tone === 'danger' ? 'var(--theme-danger)' : tone === 'success' ? 'var(--theme-success)' : color,
        }}>
        {nodeCount} node{nodeCount !== 1 ? 's' : ''}
      </span>
    </div>
  )
  return (
    <div
      className="absolute rounded-xl border-2 transition-all pointer-events-none"
      data-section-id={section.id}
      style={{
        left: section.position.x,
        top: section.position.y,
        width: collapsed ? SECTION_COLLAPSED_WIDTH : width,
        height: collapsed ? SECTION_HEADER_HEIGHT : height,
        borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
        backgroundColor: collapsed ? `rgba(${r}, ${g}, ${b}, 0.08)` : `rgba(${r}, ${g}, ${b}, 0.03)`,
        zIndex: 0,
      }}
    >
      {wrapHeader ? wrapHeader(header) : header}
      {!collapsed && resizeHandle}
    </div>
  )
}

/** Frame colour of a section (for the designer's resize handle). */
export function sectionRgb(section: WorkflowNode) {
  return rgb(getSectionDimensions(section).color)
}
