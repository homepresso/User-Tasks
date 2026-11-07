"use client"

import { NodeBrandIcon } from '@/lib/connectors/connector-brand'
import { useState } from "react"
import { NODE_CATALOG, nodeColorCategory, nodeColorTextVar, nodeColorVar, type NodeColorCategory, type PortSide, type WorkflowNode } from "@/lib/workflow-schema"
import { getBranchLabels } from "@/lib/workflow-branches"
import { branchChipMaxWidth, branchPortOffsets, CHIP_HEIGHT, CHIP_OFFSET, COLLAPSED_NODE_WIDTH, DEFAULT_NODE_WIDTH } from "@/lib/workflow-edge-routing"
import { validateNode } from "@/lib/workflow-validation"
import { getNodeConfigSummary, type SummaryLookups } from "@/lib/workflow-utils"
import { getWorkflowActivityDisplayName, getWorkflowActivitySummary } from "@/lib/extensibility"
import { formatRunDuration, joinWaitingLabel, RUN_STATUS_LABEL, RUN_STATUS_TOKENS, type NodeRunOverlay } from "@/lib/workflow-run-overlay"
import { formatErrorRate, heatColor, heatSummary, type NodeHeat } from "@/lib/workflow-heat-overlay"
import { VariableText } from "./variable-text"
import { useWorkflowLookups } from "./workflow-lookups"
import {
  X, Link2, Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge,
  Repeat, RotateCw, Timer, Edit, Database, Globe, ListPlus, ThumbsUp, ThumbsDown,
  Variable, Send, FileText, Mail, Bell, Sparkles, Zap,
  Calculator, CaseSensitive, Type, Calendar, CalendarPlus, Regex,
  Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge, CircleStop, Inbox,
  MessageSquareDashed, Radio, CornerDownRight, GitFork, Users, Braces, Brackets, Search, Tag,
  FileSpreadsheet, Sheet, XCircle, AlertTriangle, Presentation, Scale, Puzzle, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore, Briefcase, FilePen, Milestone, Gauge,
  Loader2, CircleSlash, Check, FileSearch, GitCompare, FileOutput, FileStack, ScanText, EyeOff, FileScan,
  Captions, ScanEye, Film, ScanFace, VideoOff, ImagePlus, AudioLines, Clapperboard,
  Signature, FileSignature, Hourglass, FileCheck,
} from 'lucide-react'
import { cn } from "@/lib/utils"

import { BRANCH_COLORS as EDGE_BRANCH_COLORS } from "./edge-renderer"
import { resolveStorageUrl } from "@/lib/storage/refs"

/** The canvas-coloured gap between a runtime card and its status / heat ring. */
const RING_GAP = "0 0 0 2px var(--theme-surface)"

/** Branch chip dots: the same theme chart colours as the branch connectors. */
export const BRANCH_COLORS = EDGE_BRANCH_COLORS

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lucide icon components
export const NODE_ICON_MAP: Record<string, any> = {
  Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer,
  Edit, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, Zap,
  FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar,
  CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge,
  CircleStop, Inbox, CalendarClock: CalendarPlus, FileInput: FileText,
  FileUp: FileText, FileDown: FileText, Download: FileText,
  MessageSquareDashed, Radio, CornerDownRight, GitFork, Users, Braces, Brackets, Search, Tag,
  FileSpreadsheet, Sheet, XCircle, AlertTriangle, Presentation, Scale,
  Puzzle, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore,
  Gauge,
  Briefcase, FilePen, Milestone, Link: Link2,
  FileSearch, GitCompare, FileOutput, FileStack, ScanText, EyeOff, FileScan,
  Captions, ScanEye, Film, ScanFace, VideoOff, ImagePlus, AudioLines, Clapperboard,
  Signature, FileSignature, Hourglass, FileCheck,
}

/** Everything a card shows, derived from the node alone — identical for the designer and every viewer. */
export interface NodeCardModel {
  label: string
  iconName: string
  /** Colour category (theme token) of the step; `null` when the step carries its own `node_color`. */
  colorCategory: NodeColorCategory | null
  /** The step's accent colour as CSS: its colour category's theme token, or its own `node_color`. */
  color: string
  /** Text-legible accent (icon on the header wash). */
  textColor: string
  description: string
  summary: string | null
  branchLabels: string[]
  showIfBadge: boolean
  width: number
  collapsed: boolean
  validationErrors: string[]
  customIcon: { svg: string | null; url: string | null; lucide: string | null; color: string | null }
}

export function nodeCardModel(node: WorkflowNode, lookups: SummaryLookups = {}): NodeCardModel {
  const catalog = NODE_CATALOG.find((n) => n.type === node.type)
  const config = node.config ?? {}
  const safe = config.__safe === true
  const manifest = config.manifest ?? { inputs: [], outputs: [] }
  const description = safe ? (catalog?.description ?? node.type) : node.type === "custom_activity"
    ? ([config.operation_label || (config.operation ? String(config.operation).replace(/_/g, ' ').replace(/^\w/, (ch: string) => ch.toUpperCase()) : null), String(config.activity_name ?? '').trim() !== node.label ? config.activity_name : null].filter(Boolean).join(' · ')
      || String(config.activity_description ?? '').trim() || getWorkflowActivitySummary(manifest) || catalog?.description || node.type)
    : (catalog?.description ?? node.type)
  const label = node.type === "custom_activity"
    ? (getWorkflowActivityDisplayName(manifest, node.label) ?? node.label)
    : node.label
  const override = typeof config.node_color === "string" && config.node_color ? config.node_color as string : null
  const colorCategory = override ? null : nodeColorCategory(node.type)
  return {
    label,
    iconName: catalog?.icon ?? "Plus",
    colorCategory,
    color: colorCategory ? nodeColorVar(colorCategory) : override!,
    // A custom colour is darkened until it reads on the card (AA); theme categories have a text slot.
    textColor: colorCategory ? nodeColorTextVar(colorCategory) : `color-mix(in srgb, ${override} 78%, var(--theme-card-text))`,
    description,
    // Submitter-safe nodes (Home's progress view) have no config to summarise or validate.
    summary: safe ? null : getNodeConfigSummary(node, lookups),
    branchLabels: getBranchLabels(node),
    showIfBadge: node.type === "condition" || node.type === "switch_case",
    width: node.collapsed ? COLLAPSED_NODE_WIDTH : DEFAULT_NODE_WIDTH,
    collapsed: !!node.collapsed,
    validationErrors: safe ? [] : validateNode(node),
    customIcon: {
      svg: (config.node_icon_svg as string | undefined) ?? null,
      url: resolveStorageUrl((config.node_icon_url as string | undefined) ?? null),
      lucide: (config.node_icon_lucide as string | undefined) ?? null,
      color: (config.node_icon_color as string | undefined) ?? null,
    },
  }
}

export interface CardConnectHandlers {
  isConnecting: boolean
  connectingSource: string | null
  onStartConnect: (branchLabel?: string, port?: PortSide) => void
  onFinishConnect: () => void
}

export interface WorkflowNodeCardProps {
  node: WorkflowNode
  selected?: boolean
  /** A selected connection highlights the two steps it joins and fades the rest. */
  emphasis?: 'highlight' | 'fade'
  /** The workflow is active: a live dot in the header. */
  workflowActive?: boolean
  /** Designer only: connect ports. Read-only cards draw the same ports, inert. */
  connect?: CardConnectHandlers
  /** Designer only: the header's delete button. */
  onDelete?: () => void
  /** Runtime overlay (viewers): status ring + badge, current-step pulse, taken branches. */
  run?: NodeRunOverlay
  /** Heat overlay (reports' process map): visits, average duration, error rate. */
  heat?: NodeHeat
  dragging?: boolean
  rootRef?: (el: HTMLDivElement | null) => void
  style?: React.CSSProperties
  rootProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>
  /** Spread on the header (the designer's drag handle). */
  headerProps?: React.HTMLAttributes<HTMLDivElement>
}

/**
 * The workflow step card — one component for the designer canvas, the
 * Save & Test run and the run detail viewer, so a step looks the same
 * everywhere. Runtime state is an overlay on this card, never a different
 * card.
 */
export function WorkflowNodeCard({
  node, selected = false, emphasis, workflowActive = false, connect, onDelete, run, heat, dragging = false,
  rootRef, style, rootProps, headerProps,
}: WorkflowNodeCardProps) {
  const lookups = useWorkflowLookups()
  const m = nodeCardModel(node, lookups)
  const Icon = NODE_ICON_MAP[m.iconName] ?? Plus
  const [hovered, setHovered] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const interactive = !!connect
  const isConnecting = connect?.isConnecting ?? false
  const connectingSource = connect?.connectingSource ?? null
  const isDropTarget = isConnecting && connectingSource !== node.id
  const hasErrors = m.validationErrors.length > 0
  const portOffsets = branchPortOffsets(m.width, m.branchLabels.length)
  const chipMaxWidth = branchChipMaxWidth(m.width, m.branchLabels.length)
  const nodeColor = m.color
  const tokens = run ? RUN_STATUS_TOKENS[run.status] : null
  const ringed = run && run.status !== 'not_run' && run.status !== 'skipped'
  // Case-insensitive: legacy True / False conditions report "true" / "false".
  const taken = new Set((run?.takenBranches ?? []).map((b) => b.toLowerCase()))

  function startOrFinish(label?: string, port?: PortSide) {
    if (!connect) return
    if (isConnecting) { if (connectingSource !== node.id) connect.onFinishConnect() }
    else connect.onStartConnect(label, port)
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onDelete) return
    if (confirmDelete) {
      onDelete()
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 2000)
    }
  }

  const heatTone = heat ? heatColor(heat) : null
  // The status / heat ring sits OUTSIDE the card, past a 2px gap in the
  // canvas colour: flush against the card it framed the coloured header, so
  // the bar no longer looked edge to edge as it does in the designer.
  const overlayShadow = ringed && tokens
    ? `${RING_GAP}, 0 0 0 4px ${tokens.fill}`
    : heat && heat.count > 0 && heatTone
      ? `${RING_GAP}, 0 0 0 ${heat.ratio > 0.66 ? 5 : 4}px ${heatTone}, 0 0 ${Math.round(8 + heat.ratio * 18)}px color-mix(in srgb, ${heatTone} ${Math.round(15 + heat.ratio * 30)}%, transparent)`
      : undefined

  return (
    <div
      ref={rootRef}
      {...rootProps}
      style={{
        ...style,
        ...(overlayShadow ? { boxShadow: [overlayShadow, style?.boxShadow].filter(Boolean).join(', ') } : null),
        // Steps the run never reached lose their colour, not their contrast.
        ...(run && (run.status === 'not_run' || run.status === 'skipped') ? { filter: 'grayscale(0.75)' } : null),
        ...(heat && heat.count === 0 ? { filter: 'grayscale(0.75)' } : null),
      }}
      data-heat={heat ? String(Math.round(heat.ratio * 100)) : undefined}
      data-node-id={node.id}
      data-node-card=""
      data-node-color={m.colorCategory ?? "custom"}
      data-run-status={run?.status}
      data-emphasis={emphasis}
      className={cn(
        "rounded-lg border bg-panel select-none group transition-[box-shadow,border-color] duration-[var(--ds-dur-fast)]",
        m.collapsed ? "w-40" : "w-56",
        hasErrors ? "border-warning" : selected ? "border-primary" : "border-border hover:border-border-strong",
        dragging && "cursor-grabbing shadow-elev-2",
        !dragging && selected && "shadow-elev-1 outline outline-2 outline-offset-1 outline-primary",
        rootProps?.className,
      )}
      onMouseEnter={(e) => { setHovered(true); rootProps?.onMouseEnter?.(e) }}
      onMouseLeave={(e) => { setHovered(false); setConfirmDelete(false); rootProps?.onMouseLeave?.(e) }}
    >
      {/* Current step: a soft pulse around the card (motion-safe). */}
      {run?.current && tokens && (
        <span aria-hidden="true" className="absolute -inset-1.5 rounded-xl pointer-events-none motion-safe:animate-pulse"
          style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.fill} 45%, transparent)` }} />
      )}

      {/* Runtime status badge */}
      {run && tokens && (
        <span
          data-run-badge=""
          className="absolute -top-2.5 right-2 z-30 inline-flex items-center gap-1 rounded-full border border-panel px-1.5 py-px text-2xs font-semibold shadow-elev-1 num"
          style={{ backgroundColor: tokens.fill, color: tokens.on }}
          title={[run.joinWaiting ? `${joinWaitingLabel(run.joinWaiting)}${run.joinWaiting.waitingFor.length ? ` (${run.joinWaiting.waitingFor.join(', ')})` : ''}` : RUN_STATUS_LABEL[run.status], run.durationMs != null ? formatRunDuration(run.durationMs) : null, run.visits && run.visits > 1 ? `${run.visits} visits` : null, run.error].filter(Boolean).join(' · ')}
        >
          {run.status === 'running' ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />
            : run.status === 'waiting' ? <Clock size={12} aria-hidden="true" />
            : run.status === 'failed' ? <XCircle size={12} aria-hidden="true" />
            : run.status === 'completed' ? <CheckCircle size={12} aria-hidden="true" />
            : <CircleSlash size={12} aria-hidden="true" />}
          <span>{run.joinWaiting ? joinWaitingLabel(run.joinWaiting) : RUN_STATUS_LABEL[run.status]}</span>
          {run.durationMs != null && <span className="font-normal">{formatRunDuration(run.durationMs)}</span>}
          {run.visits != null && run.visits > 1 && <span className="font-normal">×{run.visits}</span>}
        </span>
      )}

      {/* Heat badge: visits · average duration · error rate */}
      {heat && heatTone && (
        <span
          data-heat-badge=""
          className={cn(
            "absolute -top-2.5 right-2 z-30 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-2xs font-semibold shadow-elev-1 num",
            heat.count > 0 ? "bg-panel text-fg" : "bg-subtle text-fg-muted border-border",
          )}
          style={heat.count > 0 ? { borderColor: heatTone } : undefined}
          title={heat.count > 0 ? heatSummary(heat, formatRunDuration) : 'No traffic yet'}
        >
          <span>{heat.count > 0 ? `${heat.count}×` : 'No traffic'}</span>
          {heat.avgDurationMs != null && heat.count > 0 && <span className="font-normal">avg {formatRunDuration(heat.avgDurationMs)}</span>}
          {heat.errors > 0 && (
            <span className="inline-flex items-center gap-0.5 text-danger">
              <XCircle size={12} aria-hidden="true" />{formatErrorRate(heat.errorRate)}
            </span>
          )}
        </span>
      )}

      {/* Input handle (top): 8px with a panel ring; grows into a target while connecting. */}
      <div
        className={cn(
          "absolute -top-1 left-1/2 z-20 size-2 rounded-full ring-2 ring-panel transition-transform duration-[var(--ds-dur-fast)]",
          !isDropTarget && "bg-border-strong",
        )}
        style={{
          backgroundColor: isDropTarget ? nodeColor : undefined,
          transform: `translateX(-50%) ${isDropTarget ? "scale(1.75)" : "scale(1)"}`,
        }}
      />

      {/* Drop target indicator (top) */}
      {isDropTarget && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 flex size-5 items-center justify-center rounded-full bg-panel ring-2 motion-safe:animate-bounce"
          style={{ color: m.textColor, ['--tw-ring-color' as string]: nodeColor } as React.CSSProperties}
        >
          <Plus size={12} />
        </div>
      )}

      {/* Header — the designer's drag handle. A wash of the step's colour category. */}
      <div
        className={cn(
          "relative flex items-center gap-2 px-3 text-xs font-semibold text-fg",
          m.collapsed ? "py-1.5 rounded-[inherit]" : "py-2 rounded-t-[inherit] border-b border-border-subtle",
          interactive && (dragging ? "cursor-grabbing" : "cursor-grab"),
        )}
        style={{ backgroundColor: `color-mix(in srgb, ${nodeColor} 16%, var(--theme-card-bg))` }}
        title={m.collapsed ? [m.label, m.description, m.summary].filter(Boolean).join(' — ') : undefined}
        {...headerProps}
      >
        <span
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${nodeColor} 30%, var(--theme-card-bg))`, color: m.textColor }}
        >
          {m.customIcon.svg ? (
            <span
              className="inline-flex size-3.5 items-center justify-center [&_svg]:size-3.5 [&_svg]:fill-current"
              dangerouslySetInnerHTML={{ __html: m.customIcon.svg }}
            />
          ) : m.customIcon.url || m.customIcon.lucide ? (
            <NodeBrandIcon url={m.customIcon.url} lucide={m.customIcon.lucide}
              color={m.customIcon.color || m.textColor} size={12}
              chipClass="inline-flex size-4 items-center justify-center rounded-sm bg-panel p-0.5" />
          ) : (
            <Icon size={14} data-card-icon={m.iconName} />
          )}
        </span>
        <span className="flex-1 truncate" data-card-label="">{m.label}</span>

        {workflowActive && (
          <span className="size-2 shrink-0 rounded-full bg-success ring-2 ring-success-wash" aria-hidden="true" />
        )}

        {m.showIfBadge && (
          <span className="rounded bg-muted px-1 text-2xs font-semibold text-fg-muted">
            If
          </span>
        )}

        {onDelete && (
          <button
            type="button"
            aria-label={confirmDelete ? `Confirm delete ${m.label}` : `Delete ${m.label}`}
            onClick={handleDeleteClick}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "rounded-md p-0.5 transition-opacity",
              confirmDelete ? "bg-danger text-danger-fg opacity-100" : "text-fg-muted opacity-0 hover:bg-muted hover:text-fg group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            {confirmDelete ? <span className="px-1 text-2xs font-semibold">Delete?</span> : <X size={12} />}
          </button>
        )}
      </div>

      {/* Body — hidden when collapsed */}
      {!m.collapsed && (
        <div
          className="rounded-b-[inherit] px-3 py-2 text-2xs"
          style={isDropTarget ? { backgroundColor: `color-mix(in srgb, ${nodeColor} 8%, var(--theme-card-bg))` } : undefined}
        >
          <p className="text-fg-muted" data-card-description="">{m.description}</p>
          {m.summary && (
            <div className="mt-1.5 truncate font-mono text-2xs leading-tight text-fg" title={m.summary} data-card-summary="">
              <VariableText text={m.summary} maxLength={80} />
            </div>
          )}
          {hasErrors && (
            <div className="mt-1.5 flex items-start gap-1 text-warning">
              <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" />
              <p className="text-2xs leading-tight">
                {m.validationErrors[0]}{m.validationErrors.length > 1 ? ` (+${m.validationErrors.length - 1})` : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Side output ports (left / right) — designer only, on hover / selection */}
      {interactive && m.branchLabels.length === 0 && (hovered || selected) && (
        <>
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-label={`Connect from the ${side}`}
              className={cn(
                "absolute top-1/2 z-20 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border bg-panel shadow-elev-1 opacity-70 transition-[opacity,transform] hover:scale-110 hover:opacity-100",
                side === 'left' ? "-left-2.5" : "-right-2.5",
              )}
              style={{ borderColor: nodeColor, color: m.textColor }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); startOrFinish(undefined, side) }}
            >
              <Link2 size={12} />
            </button>
          ))}
        </>
      )}

      {/* Output: branch chips (condition / switch / loop / parallel / outcomes) or the bottom handle */}
      {m.branchLabels.length > 0 ? (
        <div className="absolute left-0 right-0 z-[30]"
          style={{ top: `calc(100% + ${CHIP_OFFSET}px)`, height: CHIP_HEIGHT }}
          data-branch-port="true"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { if (interactive) e.stopPropagation() }}>
          {m.branchLabels.map((label, i) => {
            const wasTaken = taken.has(label.toLowerCase())
            const branchColor = BRANCH_COLORS[i % BRANCH_COLORS.length]
            return (
              <div
                key={`${label}-${i}`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                title={label}
                aria-label={interactive ? `Connect branch ${label}` : wasTaken ? `${label} (taken)` : label}
                data-branch-chip={label}
                data-branch-taken={wasTaken ? "" : undefined}
                className={cn(
                  "absolute top-0 flex items-center justify-center gap-1 rounded-full border bg-panel px-1.5 text-2xs font-medium text-fg shadow-elev-1 transition-[transform,box-shadow] select-none",
                  wasTaken ? "border-success ring-1 ring-success" : "border-border",
                  interactive && "cursor-pointer hover:scale-105 hover:border-border-strong",
                  isConnecting && connectingSource === node.id && "motion-safe:animate-pulse",
                )}
                style={{
                  left: portOffsets[i],
                  transform: "translateX(-50%)",
                  height: CHIP_HEIGHT,
                  maxWidth: chipMaxWidth,
                }}
                onKeyDown={interactive ? (e) => {
                  if (e.key !== "Enter" && e.key !== " ") return
                  e.preventDefault(); e.stopPropagation()
                  startOrFinish(label)
                } : undefined}
                onMouseDown={interactive ? (e) => { e.stopPropagation(); e.preventDefault() } : undefined}
                onPointerDown={interactive ? (e) => { e.stopPropagation(); e.preventDefault() } : undefined}
                onClick={interactive ? (e) => { e.stopPropagation(); e.preventDefault(); startOrFinish(label) } : undefined}
              >
                {wasTaken
                  ? <Check size={12} className="shrink-0 text-success" strokeWidth={3} />
                  : <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: branchColor }} />}
                <span className="truncate">{label}</span>
              </div>
            )
          })}
        </div>
      ) : interactive ? (
        <button
          type="button"
          aria-label={`Connect from ${m.label}`}
          className={cn(
            "group/handle absolute -bottom-3.5 left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); startOrFinish(undefined, 'bottom') }}
        >
          <span
            className={cn(
              "flex items-center justify-center rounded-full border bg-panel transition-all duration-[var(--ds-dur-fast)]",
              hovered || selected || (isConnecting && connectingSource === node.id) ? "size-5 shadow-elev-1" : "size-2.5",
              isConnecting && connectingSource === node.id && "motion-safe:animate-pulse",
            )}
            style={{ borderColor: nodeColor, color: m.textColor, borderWidth: hovered || selected ? 1.5 : 2 }}
          >
            {(hovered || selected || (isConnecting && connectingSource === node.id)) && <Link2 size={12} />}
          </span>
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="absolute -bottom-3.5 left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center"
        >
          <span className="size-2.5 rounded-full border-2 bg-panel" style={{ borderColor: nodeColor }} />
        </span>
      )}
    </div>
  )
}
