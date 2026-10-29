"use client"

import { NodeBrandIcon } from '@/lib/connectors/connector-brand'
import { useState } from "react"
import { NODE_CATALOG, type PortSide, type WorkflowNode } from "@/lib/workflow-schema"
import { getBranchLabels } from "@/lib/workflow-branches"
import { branchChipMaxWidth, branchPortOffsets, CHIP_HEIGHT, CHIP_OFFSET, COLLAPSED_NODE_WIDTH, DEFAULT_NODE_WIDTH } from "@/lib/workflow-edge-routing"
import { validateNode } from "@/lib/workflow-validation"
import { getNodeConfigSummary, type SummaryLookups } from "@/lib/workflow-utils"
import { getWorkflowActivityDisplayName, getWorkflowActivitySummary } from "@/lib/extensibility"
import { formatRunDuration, RUN_STATUS_LABEL, RUN_STATUS_TOKENS, type NodeRunOverlay } from "@/lib/workflow-run-overlay"
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
} from 'lucide-react'
import { cn } from "@/lib/utils"
import { readableFill } from "@/lib/theme/legibility"
import { resolveStorageUrl } from "@/lib/storage/refs"

export const BRANCH_COLORS = ["#22C55E", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#6B7280"]

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
}

/** Everything a card shows, derived from the node alone — identical for the designer and every viewer. */
export interface NodeCardModel {
  label: string
  iconName: string
  color: string
  /** Header fill (the colour darkened until white text reads at 5.2:1). */
  headerColor: string
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
  const manifest = config.manifest ?? { inputs: [], outputs: [] }
  const description = node.type === "custom_activity"
    ? (String(config.activity_description ?? '').trim() || getWorkflowActivitySummary(manifest) || catalog?.description || node.type)
    : (catalog?.description ?? node.type)
  const label = node.type === "custom_activity"
    ? (getWorkflowActivityDisplayName(manifest, node.label) ?? node.label)
    : node.label
  const color = (config.node_color as string | undefined) ?? catalog?.color ?? "#6B7280"
  return {
    label,
    iconName: catalog?.icon ?? "Plus",
    color,
    headerColor: readableFill(color, "#FFFFFF", 5.2),
    description,
    summary: getNodeConfigSummary(node, lookups),
    branchLabels: getBranchLabels(node),
    showIfBadge: node.type === "condition" || node.type === "switch_case",
    width: node.collapsed ? COLLAPSED_NODE_WIDTH : DEFAULT_NODE_WIDTH,
    collapsed: !!node.collapsed,
    validationErrors: validateNode(node),
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
  const overlayShadow = ringed && tokens
    ? `0 0 0 2px ${tokens.fill}, 0 0 18px color-mix(in srgb, ${tokens.fill} 28%, transparent)`
    : heat && heat.count > 0 && heatTone
      ? `0 0 0 ${heat.ratio > 0.66 ? 3 : 2}px ${heatTone}, 0 0 ${Math.round(8 + heat.ratio * 18)}px color-mix(in srgb, ${heatTone} ${Math.round(15 + heat.ratio * 30)}%, transparent)`
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
      data-run-status={run?.status}
      data-emphasis={emphasis}
      className={cn(
        "rounded-2xl select-none group",
        m.collapsed ? "w-40" : "w-56",
        dragging && "cursor-grabbing",
        !dragging && selected && "shadow-lg",
        !dragging && !selected && "shadow-sm hover:shadow-md",
        rootProps?.className,
      )}
      onMouseEnter={(e) => { setHovered(true); rootProps?.onMouseEnter?.(e) }}
      onMouseLeave={(e) => { setHovered(false); setConfirmDelete(false); rootProps?.onMouseLeave?.(e) }}
    >
      {/* Current step: a soft pulse around the card (motion-safe). */}
      {run?.current && tokens && (
        <span aria-hidden="true" className="absolute -inset-1 rounded-[1.2rem] pointer-events-none motion-safe:animate-pulse"
          style={{ boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.fill} 45%, transparent)` }} />
      )}

      {/* Runtime status badge */}
      {run && tokens && (
        <span
          data-run-badge=""
          className="absolute -top-2.5 right-2 z-30 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold shadow-sm border"
          style={{ backgroundColor: tokens.fill, color: tokens.on, borderColor: 'var(--theme-card-bg)' }}
          title={[RUN_STATUS_LABEL[run.status], run.durationMs != null ? formatRunDuration(run.durationMs) : null, run.visits && run.visits > 1 ? `${run.visits} visits` : null, run.error].filter(Boolean).join(' · ')}
        >
          {run.status === 'running' ? <Loader2 size={9} className="motion-safe:animate-spin" aria-hidden="true" />
            : run.status === 'waiting' ? <Clock size={9} aria-hidden="true" />
            : run.status === 'failed' ? <XCircle size={9} aria-hidden="true" />
            : run.status === 'completed' ? <CheckCircle size={9} aria-hidden="true" />
            : <CircleSlash size={9} aria-hidden="true" />}
          <span>{RUN_STATUS_LABEL[run.status]}</span>
          {run.durationMs != null && <span className="font-normal">{formatRunDuration(run.durationMs)}</span>}
          {run.visits != null && run.visits > 1 && <span className="font-normal">×{run.visits}</span>}
        </span>
      )}

      {/* Heat badge: visits · average duration · error rate */}
      {heat && heatTone && (
        <span
          data-heat-badge=""
          className="absolute -top-2.5 right-2 z-30 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold shadow-sm border tabular-nums"
          style={{
            backgroundColor: heat.count > 0 ? 'var(--theme-card-bg)' : 'var(--theme-surface)',
            color: heat.count > 0 ? 'var(--theme-card-text)' : 'var(--theme-muted-text)',
            borderColor: heat.count > 0 ? heatTone : 'var(--theme-surface-border)',
          }}
          title={heat.count > 0 ? heatSummary(heat, formatRunDuration) : 'No traffic yet'}
        >
          <span>{heat.count > 0 ? `${heat.count}×` : 'No traffic'}</span>
          {heat.avgDurationMs != null && heat.count > 0 && <span className="font-normal">avg {formatRunDuration(heat.avgDurationMs)}</span>}
          {heat.errors > 0 && (
            <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--theme-danger)' }}>
              <XCircle size={9} aria-hidden="true" />{formatErrorRate(heat.errorRate)}
            </span>
          )}
        </span>
      )}

      {/* Input port (top) — always visible */}
      <div
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-20 transition-all"
        style={{
          backgroundColor: isDropTarget ? nodeColor : "var(--theme-surface-border)",
          border: "2px solid var(--theme-card-bg)",
          boxShadow: isDropTarget ? `0 0 8px ${nodeColor}80` : undefined,
          transform: `translateX(-50%) ${isDropTarget ? "scale(1.5)" : "scale(1)"}`,
        }}
      />

      {/* Drop target indicator (top) */}
      {isDropTarget && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full animate-bounce flex items-center justify-center z-30"
          style={{ backgroundColor: nodeColor, border: "2px solid var(--theme-card-bg)" }}
        >
          <Plus size={10} className="text-white" />
        </div>
      )}

      {/* Header — the designer's drag handle */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 text-white text-xs font-medium relative overflow-hidden",
          m.collapsed ? "py-2 rounded-2xl" : "py-2.5 rounded-t-2xl",
          interactive && (dragging ? "cursor-grabbing" : "cursor-grab"),
        )}
        style={{
          background: `linear-gradient(135deg, ${m.headerColor}, ${m.headerColor}DD)`,
          boxShadow: selected ? `0 0 0 2px ${nodeColor}, 0 0 12px ${nodeColor}30` : undefined,
        }}
        title={m.collapsed ? [m.label, m.description, m.summary].filter(Boolean).join(' — ') : undefined}
        {...headerProps}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.05) 100%)" }} />
        {m.customIcon.svg ? (
          <span
            className="shrink-0 relative z-10 inline-flex h-3.5 w-3.5 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:fill-current"
            dangerouslySetInnerHTML={{ __html: m.customIcon.svg }}
          />
        ) : m.customIcon.url || m.customIcon.lucide ? (
          <NodeBrandIcon url={m.customIcon.url} lucide={m.customIcon.lucide}
            color={m.customIcon.color || nodeColor} size={11}
            chipClass="shrink-0 relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white/90 p-0.5" />
        ) : (
          <Icon size={14} className="shrink-0 relative z-10" data-card-icon={m.iconName} />
        )}
        <span className="flex-1 truncate relative z-10" data-card-label="">{m.label}</span>

        {workflowActive && (
          <span className="w-2 h-2 rounded-full shrink-0 relative z-10"
            style={{ backgroundColor: "#22C55E", boxShadow: "0 0 6px #22C55E80" }} />
        )}

        {m.showIfBadge && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full relative z-10" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            IF
          </span>
        )}

        {onDelete && (
          <button
            onClick={handleDeleteClick}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "rounded-md p-0.5 transition-all relative z-10",
              confirmDelete ? "bg-white/30 opacity-100" : "opacity-0 group-hover:opacity-70 hover:opacity-100",
            )}
          >
            {confirmDelete ? <span className="text-[9px] font-bold px-1">DELETE?</span> : <X size={12} />}
          </button>
        )}
      </div>

      {/* Body — hidden when collapsed */}
      {!m.collapsed && (
        <div
          className="px-3 py-2.5 text-[10px] rounded-b-2xl"
          style={{
            backgroundColor: isDropTarget ? `${nodeColor}15` : "var(--theme-card-bg)",
            borderTop: `1px solid ${selected ? `${nodeColor}40` : "var(--theme-surface-border)"}`,
            borderLeft: `2px solid ${hasErrors ? 'color-mix(in srgb, var(--theme-warning) 25%, transparent)' : selected ? nodeColor : "transparent"}`,
            borderRight: `2px solid ${hasErrors ? 'color-mix(in srgb, var(--theme-warning) 25%, transparent)' : selected ? nodeColor : "transparent"}`,
            borderBottom: `2px solid ${hasErrors ? 'color-mix(in srgb, var(--theme-warning) 25%, transparent)' : selected ? nodeColor : "transparent"}`,
            borderRadius: "0 0 1rem 1rem",
          }}
        >
          <p style={{ color: "var(--theme-muted-text)" }} data-card-description="">{m.description}</p>
          {m.summary && (
            <div className="mt-1.5 font-mono truncate leading-tight" style={{ color: "var(--theme-card-text)", fontSize: "9px" }} title={m.summary} data-card-summary="">
              <VariableText text={m.summary} maxLength={80} />
            </div>
          )}
          {hasErrors && (
            <div className="mt-1.5 flex items-start gap-1">
              <span className="shrink-0 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold" style={{ backgroundColor: 'var(--theme-warning)', color: 'var(--theme-card-bg)' }}>!</span>
              <p className="text-[9px] leading-tight" style={{ color: 'var(--theme-warning)' }}>
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
              className={cn(
                "absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center text-white z-20 transition-all hover:scale-125 opacity-60 hover:opacity-100",
                side === 'left' ? "-left-3" : "-right-3",
              )}
              style={{ backgroundColor: nodeColor, borderColor: "var(--theme-card-bg)", boxShadow: `0 1px 3px rgba(0,0,0,0.2)` }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); startOrFinish(undefined, side) }}
            >
              <Link2 size={8} />
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
                  "absolute top-0 flex items-center justify-center gap-0.5 px-1.5 rounded-full border text-[8px] font-semibold transition-all select-none",
                  interactive && "cursor-pointer hover:scale-110 hover:shadow-lg active:scale-95",
                  isConnecting && connectingSource === node.id && "animate-pulse",
                )}
                style={{
                  left: portOffsets[i],
                  transform: "translateX(-50%)",
                  height: CHIP_HEIGHT,
                  maxWidth: chipMaxWidth,
                  backgroundColor: readableFill(BRANCH_COLORS[i % BRANCH_COLORS.length]),
                  borderColor: "var(--theme-card-bg)",
                  color: "white",
                  boxShadow: wasTaken
                    ? `0 0 0 2px var(--theme-success), 0 2px 6px rgba(0,0,0,0.35)`
                    : `0 2px 6px rgba(0,0,0,0.35)`,
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
                {wasTaken ? <Check size={7} className="shrink-0" strokeWidth={3} /> : <Link2 size={7} className="shrink-0" />}
                <span className="truncate">{label}</span>
              </div>
            )
          })}
        </div>
      ) : interactive ? (
        <button
          className={cn(
            "absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-2",
            "flex items-center justify-center text-white z-20 transition-all",
            "hover:scale-110",
            isConnecting && connectingSource === node.id && "scale-125 animate-pulse",
          )}
          style={{
            backgroundColor: nodeColor,
            borderColor: "var(--theme-card-bg)",
            boxShadow: hovered || selected
              ? `0 0 12px ${nodeColor}60, 0 0 4px ${nodeColor}30`
              : `0 1px 4px rgba(0,0,0,0.2), 0 0 6px ${nodeColor}20`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); startOrFinish(undefined, 'bottom') }}
        >
          <Link2 size={11} />
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full border-2 flex items-center justify-center text-white z-20"
          style={{ backgroundColor: nodeColor, borderColor: "var(--theme-card-bg)", boxShadow: `0 1px 4px rgba(0,0,0,0.2), 0 0 6px ${nodeColor}20` }}
        >
          <Link2 size={11} />
        </span>
      )}
    </div>
  )
}
