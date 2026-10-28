import type { CSSProperties } from "react"
import type { DiagramItem, UseCaseDiagram } from "@/lib/use-cases"

/**
 * Inline SVG architecture sketch for a use case: inputs → UserTasks → outputs.
 * Colours come from the --theme-* variables (light marketing defaults as
 * fallbacks), so the same diagram reads correctly on a dark docs theme. The
 * SVG carries its own <title>/<desc> for screen readers.
 */

const WIDTH = 960
const TOP = 44
const SIDE_W = 232
const SIDE_H = 64
const SIDE_GAP = 16
const LEFT_X = 16
const CENTER_X = 328
const CENTER_W = 304
const RIGHT_X = WIDTH - 16 - SIDE_W
const CHIP_H = 40
const CHIP_GAP = 10
const CENTER_HEAD = 44

const C = {
  card: "var(--theme-card-bg, #FFFFFF)",
  text: "var(--theme-card-text, #1B1916)",
  muted: "var(--theme-muted-text, #6E6759)",
  border: "var(--theme-surface-border, #E6E1D5)",
  surface: "var(--theme-surface, #F5F2EA)",
  accent: "#A0804F",
}

const fill = (color: string): CSSProperties => ({ fill: color })
const stroke = (color: string): CSSProperties => ({ stroke: color })

function stackHeight(count: number, size: number, gap: number) {
  return count * size + Math.max(0, count - 1) * gap
}

function SideColumn({ x, label, items, bodyTop, bodyHeight }: { x: number; label: string; items: DiagramItem[]; bodyTop: number; bodyHeight: number }) {
  const start = bodyTop + (bodyHeight - stackHeight(items.length, SIDE_H, SIDE_GAP)) / 2
  return (
    <g>
      <text x={x} y={24} fontSize={12} fontWeight={600} letterSpacing="0.12em" style={fill(C.muted)}>{label.toUpperCase()}</text>
      {items.map((item, index) => {
        const y = start + index * (SIDE_H + SIDE_GAP)
        return (
          <g key={item.label}>
            <rect x={x} y={y} width={SIDE_W} height={SIDE_H} rx={12} strokeWidth={1.5} style={{ ...fill(C.card), ...stroke(C.border) }} />
            <text x={x + 16} y={y + (item.note ? 27 : 37)} fontSize={14} fontWeight={600} style={fill(C.text)}>{item.label}</text>
            {item.note && <text x={x + 16} y={y + 47} fontSize={12} style={fill(C.muted)}>{item.note}</text>}
          </g>
        )
      })}
    </g>
  )
}

/** Vertical centres of a side column's boxes, for the arrows. */
function sideCentres(count: number, bodyTop: number, bodyHeight: number) {
  const start = bodyTop + (bodyHeight - stackHeight(count, SIDE_H, SIDE_GAP)) / 2
  return Array.from({ length: count }, (_, index) => start + index * (SIDE_H + SIDE_GAP) + SIDE_H / 2)
}

export function UseCaseDiagramSvg({ id, diagram }: { id: string; diagram: UseCaseDiagram }) {
  const sideHeight = stackHeight(Math.max(diagram.left.items.length, diagram.right.items.length), SIDE_H, SIDE_GAP)
  const centerHeight = CENTER_HEAD + stackHeight(diagram.center.items.length, CHIP_H, CHIP_GAP) + 20
  const bodyHeight = Math.max(sideHeight, centerHeight)
  const height = TOP + bodyHeight + 16
  const chipsTop = TOP + CENTER_HEAD + (bodyHeight - centerHeight) / 2
  const titleId = `${id}-title`
  const descId = `${id}-desc`
  const markerId = `${id}-arrow`

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-labelledby={`${titleId} ${descId}`} className="h-auto w-full min-w-[640px]" style={{ fontFamily: "inherit" }}>
      <title id={titleId}>{diagram.title}</title>
      <desc id={descId}>{diagram.desc}</desc>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" style={fill(C.accent)} />
        </marker>
      </defs>

      {sideCentres(diagram.left.items.length, TOP, bodyHeight).map((y) => (
        <line key={`l${y}`} x1={LEFT_X + SIDE_W + 4} y1={y} x2={CENTER_X - 4} y2={y} strokeWidth={2} markerEnd={`url(#${markerId})`} style={stroke(C.accent)} />
      ))}
      {sideCentres(diagram.right.items.length, TOP, bodyHeight).map((y) => (
        <line key={`r${y}`} x1={CENTER_X + CENTER_W + 4} y1={y} x2={RIGHT_X - 4} y2={y} strokeWidth={2} markerEnd={`url(#${markerId})`} style={stroke(C.accent)} />
      ))}

      <SideColumn x={LEFT_X} label={diagram.left.label} items={diagram.left.items} bodyTop={TOP} bodyHeight={bodyHeight} />
      <SideColumn x={RIGHT_X} label={diagram.right.label} items={diagram.right.items} bodyTop={TOP} bodyHeight={bodyHeight} />

      <g>
        <rect x={CENTER_X} y={TOP} width={CENTER_W} height={bodyHeight} rx={18} strokeWidth={2} style={{ ...fill(C.surface), ...stroke(C.accent) }} />
        <text x={CENTER_X + 20} y={chipsTop - 16} fontSize={15} fontWeight={700} style={fill(C.text)}>{diagram.center.label}</text>
        {diagram.center.items.map((item, index) => {
          const y = chipsTop + index * (CHIP_H + CHIP_GAP)
          return (
            <g key={item}>
              <rect x={CENTER_X + 16} y={y} width={CENTER_W - 32} height={CHIP_H} rx={9} strokeWidth={1} style={{ ...fill(C.card), ...stroke(C.border) }} />
              <circle cx={CENTER_X + 32} cy={y + CHIP_H / 2} r={4} style={fill(C.accent)} />
              <text x={CENTER_X + 46} y={y + 25} fontSize={13} fontWeight={500} style={fill(C.text)}>{item}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
