import type { CSSProperties } from "react"
import type { NavArtKind } from "@/lib/marketing-nav"
import "./nav-art.css"

/**
 * Small CSS illustrations of each product area: the Product mega menu tiles,
 * the homepage pillar cards and the mobile menu. Decorative (aria-hidden);
 * they loop while their link is hovered or focused (`.mkt-art`), or always
 * with `live`. No images, no JavaScript.
 */
export function NavArt({ kind, live = false, className = "" }: { kind: NavArtKind; live?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={`mkt-art ${live ? "mkt-art-live" : ""} nav-art nav-art-${kind} ${className}`}>
      {kind === "workflows" && <WorkflowsArt />}
      {kind === "forms" && <FormsArt />}
      {kind === "tasks" && <TasksArt />}
      {kind === "agent" && <AgentArt />}
      {kind === "data" && <DataArt />}
      {kind === "integrations" && <IntegrationsArt />}
    </div>
  )
}

function WorkflowsArt() {
  return (
    <svg viewBox="0 0 160 90" className="h-full w-full">
      <path className="na-edge" d="M30 45 H62" />
      <path className="na-edge" d="M88 45 C100 45 100 22 112 22 H122" style={{ animationDelay: "0.35s" }} />
      <path className="na-edge" d="M88 45 C100 45 100 68 112 68 H122" style={{ animationDelay: "0.35s" }} />
      <rect className="na-node" x="8" y="35" width="24" height="20" rx="5" style={{ "--c": "#4C8DF6" } as CSSProperties} />
      <rect className="na-node na-node-2" x="62" y="33" width="26" height="24" rx="5" style={{ "--c": "#E8B266" } as CSSProperties} />
      <rect className="na-node na-node-3" x="122" y="12" width="28" height="20" rx="5" style={{ "--c": "#4FB3A9" } as CSSProperties} />
      <rect className="na-node na-node-3" x="122" y="58" width="28" height="20" rx="5" style={{ "--c": "#8B7CF6" } as CSSProperties} />
    </svg>
  )
}

function FormsArt() {
  return (
    <div className="na-form">
      <span className="na-label" style={{ width: "34%" }} />
      <span className="na-input" />
      <div className="na-row">
        <div><span className="na-label" style={{ width: "60%" }} /><span className="na-input" /></div>
        <div><span className="na-label" style={{ width: "40%" }} /><span className="na-input" /></div>
      </div>
      <div className="na-list">
        <span /><span /><span className="na-list-new" />
      </div>
    </div>
  )
}

function TasksArt() {
  return (
    <div className="na-tasks">
      {[0, 1, 2].map((index) => (
        <div key={index} className={`na-task ${index === 0 ? "na-task-new" : ""}`}>
          <span className="na-check" />
          <span className="na-line" style={{ width: `${70 - index * 14}%` }} />
          <span className="na-chip" />
        </div>
      ))}
    </div>
  )
}

function AgentArt() {
  return (
    <div className="na-agent">
      <span className="na-bubble na-bubble-me" />
      <span className="na-bubble na-bubble-ai"><i /><i /><i /></span>
      <span className="na-card"><b /><b /><b /></span>
    </div>
  )
}

function DataArt() {
  return (
    <div className="na-data">
      {[46, 72, 38, 88, 60, 96].map((height, index) => (
        <span key={index} style={{ "--h": `${height}%`, animationDelay: `${index * 0.08}s` } as CSSProperties} />
      ))}
    </div>
  )
}

function IntegrationsArt() {
  return (
    <svg viewBox="0 0 160 90" className="h-full w-full">
      {[[24, 18], [24, 72], [136, 18], [136, 72], [80, 8]].map(([x, y], index) => (
        <path key={index} className="na-wire" d={`M80 45 L${x} ${y}`} style={{ animationDelay: `${index * 0.18}s` }} />
      ))}
      {[[24, 18, "#4C8DF6"], [24, 72, "#4FB3A9"], [136, 18, "#8B7CF6"], [136, 72, "#D07A6A"], [80, 8, "#7FA98A"]].map(([x, y, c], index) => (
        <circle key={index} className="na-sat" cx={x} cy={y} r="7" style={{ "--c": c } as CSSProperties} />
      ))}
      <rect className="na-hub" x="64" y="31" width="32" height="28" rx="8" />
    </svg>
  )
}
