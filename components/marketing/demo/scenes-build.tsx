import type { ReactNode } from "react"
import {
  ArrowUp, BarChart3, Calendar, Check, CheckCircle2, ChevronRight, Database, Eye, FileText, GitBranch, Hash, Heading, List, Mail, Pencil, Plus, Rocket,
  Scale, ShoppingCart, Sparkles, Type, UserCheck, Users, Workflow, Zap,
} from "lucide-react"
import { AppWindow, at, Confetti, Cursor, PhoneFlow, Stream, Typed, vars, type SceneProps } from "./demo-kit"

/**
 * "Build it": the Agent turns one sentence into a purchase request app —
 * a data table, two forms, the approval workflow and a report — then the
 * form designer, the workflow designer and publishing.
 */

const PROMPT = "Build a purchase request approval with line items"

const PLAN: Array<{ kind: string; name: string; detail: string; icon: ReactNode }> = [
  { kind: "Data table", name: "Purchase requests", detail: "Requester, cost centre, total, status", icon: <Database size={13} /> },
  { kind: "Form", name: "Purchase request", detail: "List of line items, totals", icon: <FileText size={13} /> },
  { kind: "Form", name: "Purchase approval", detail: "Read-only request, comment", icon: <FileText size={13} /> },
  { kind: "Workflow", name: "Purchase approval", detail: "Budget → manager → finance > 2,000 → PO", icon: <Workflow size={13} /> },
  { kind: "Report", name: "Spend by cost centre", detail: "Chart and table", icon: <BarChart3 size={13} /> },
]

function AgentPanel({ children, composer }: { children: ReactNode; composer?: ReactNode }) {
  return (
    <div className="ut-agent w-full sm:w-[360px] sm:shrink-0">
      <div className="ut-agent-head">
        <span className="ut-agent-mark"><Sparkles size={15} /></span>
        <div className="min-w-0"><p className="text-[13px] font-semibold">Agent</p><p className="ut-sub flex items-center gap-1"><Eye size={11} /> Looking at: Build</p></div>
      </div>
      <div className="ut-agent-body">{children}</div>
      <div className="ut-composer">
        <div className="min-w-0 flex-1">{composer ?? <span className="text-[#9A9282]">Ask the Agent…</span>}</div>
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#1B1916] text-white"><ArrowUp size={14} /></span>
      </div>
    </div>
  )
}

/** The page behind the Agent: an empty Build home that fills as items are created. */
function BuildHome({ built = [] as number[], baseDelay = 0 }) {
  return (
    <div className="ut-hide-sm relative flex-1 overflow-hidden p-5">
      <p className="ut-h">Build</p>
      <p className="ut-sub">Workflows, forms, tables and reports in this workspace</p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {PLAN.map((item, index) => (
          built.includes(index) ? (
            <div key={index} className="ut-card ut-t ut-a-pop flex items-center gap-2 p-3" style={at(baseDelay + index * 0.75 + 0.6)}>
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#FFF4E0] text-[#8A6D45]">{item.icon}</span>
              <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold">{item.name}</span><span className="ut-sub">{item.kind} · draft</span></span>
            </div>
          ) : (
            <div key={index} className="h-[54px] rounded-xl border border-dashed border-[#DCD4C4]" />
          )
        ))}
      </div>
    </div>
  )
}

/* ── 1. Agent plans ─────────────────────────────────────────────── */
export function AgentScene({ onAct }: SceneProps) {
  const sent = 0.4 + PROMPT.length * 0.04 + 0.3
  return (
    <AppWindow url="acme.usertasks.com/build" active="workflows" title="Build" badge={3}>
      <div className="flex min-h-0 flex-1">
        <BuildHome />
        <AgentPanel composer={<span className="ut-t ut-a-hide block" style={at(sent)}><Typed text={PROMPT} delay={0.4} speed={0.04} /></span>}>
          <div className="ut-msg-me ut-t ut-a-in" style={at(sent)}>{PROMPT}</div>
          <div className="ut-t ut-a-hide flex gap-1 pl-1" style={at(sent + 0.9)}>
            <span className="ut-t ut-a-show flex gap-1" style={at(sent + 0.2)}>{[0, 1, 2].map((dot) => <i key={dot} className="ut-dot" style={{ animationDelay: `${dot * 0.15}s` }} />)}</span>
          </div>
          <p className="ut-msg-ai"><Stream text="From your process I plan a table, two forms, the workflow and a report. Nothing existing changes; the workflow is saved as an inactive draft." delay={sent + 0.9} speed={0.045} /></p>
          <div className="ut-plan ut-t ut-a-in" style={at(sent + 2.1)}>
            <div className="ut-plan-head">Build plan: Purchase requests <span className="ut-chip ut-chip-grey">5 items</span></div>
            {PLAN.map((item, index) => (
              <div key={index} className="ut-plan-row ut-t ut-a-left" style={at(sent + 2.3 + index * 0.12)}>
                <span className="text-[#7A7366]">{index + 1}</span>
                <span className="ut-kind flex items-center gap-1.5">{item.icon}{item.kind}</span>
                <span className="min-w-0 truncate font-medium">{item.name}</span>
                <span />
              </div>
            ))}
            <div className="flex justify-end gap-2 border-t border-[#E8E2D6] p-2.5">
              <span className="ut-btn">Cancel</span>
              <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative">Build all<Cursor from={[-240, -120]} delay={sent + 3.1} /></button>
            </div>
          </div>
        </AgentPanel>
      </div>
    </AppWindow>
  )
}

/* ── 2. Build all ─────────────────────────────────────────────── */
export function BuildScene({ onAct }: SceneProps) {
  const step = 0.75
  const done = 0.4 + PLAN.length * step
  return (
    <AppWindow url="acme.usertasks.com/build" active="workflows" title="Build" badge={3}>
      <div className="flex min-h-0 flex-1">
        <BuildHome built={[0, 1, 2, 3, 4]} baseDelay={0.55} />
        <AgentPanel>
          <div className="ut-msg-me">{PROMPT}</div>
          <div className="ut-plan">
            <div className="ut-plan-head">Building… <span className="ut-sub ut-t ut-a-show" style={at(done)}>Done</span></div>
            <div className="px-3 pt-2"><div className="ut-progress"><i style={vars({ "--dur": `${PLAN.length * step}s`, "--delay": "0.4s" })} /></div></div>
            {PLAN.map((item, index) => {
              const finish = 0.4 + (index + 1) * step
              return (
                <div key={index} className="ut-plan-row">
                  <span className="relative inline-flex size-[18px]">
                    <span className="ut-t ut-a-hide absolute inset-0" style={at(finish)}><span className="ut-spin block size-[18px] rounded-full border-2 border-[#E8E2D6] border-t-[#8B7CF6]" /></span>
                    <span className="ut-tick ut-t ut-a-pop absolute inset-0 bg-[#3F7A54] text-white" style={at(finish)}><Check size={11} strokeWidth={3.5} /></span>
                  </span>
                  <span className="ut-kind flex items-center gap-1.5">{item.icon}{item.kind}</span>
                  <span className="min-w-0 truncate font-medium">{item.name}</span>
                  <span className="ut-t ut-a-show text-[11px] font-semibold text-[#3F7A54]" style={at(finish)}>Created</span>
                </div>
              )
            })}
          </div>
          <p className="ut-msg-ai ut-t ut-a-in" style={at(done + 0.2)}>All five are built and checked. Open the request form to review it?</p>
          <div className="ut-t ut-a-in flex gap-2" style={at(done + 0.4)}>
            <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative">Open the form<Cursor from={[-200, -60]} delay={done + 0.6} /></button>
            <span className="ut-btn">Open the workflow</span>
          </div>
        </AgentPanel>
      </div>
    </AppWindow>
  )
}

/* ── 3. Form designer ─────────────────────────────────────────────── */
export function FormDesignerScene({ onAct }: SceneProps) {
  const palette: Array<[ReactNode, string]> = [[<Type key="t" size={13} />, "Text"], [<Hash key="h" size={13} />, "Number"], [<Calendar key="c" size={13} />, "Date"], [<Users key="u" size={13} />, "Person"], [<List key="l" size={13} />, "List"], [<Heading key="s" size={13} />, "Section"]]
  const listAt = 1.5
  const addAt = 2.9
  return (
    <AppWindow url="acme.usertasks.com/forms/purchase-request" active="forms" title={<span className="flex items-center gap-2">Purchase request <span className="ut-chip ut-chip-grey before:!hidden">Version 1</span></span>} right={<span className="ut-hide-sm ut-hide-md flex rounded-lg bg-[#F1ECE2] p-0.5 text-[12px]"><span className="flex items-center gap-1 rounded-md bg-[#fff] px-2 py-1 font-semibold shadow-sm"><Pencil size={11} /> Design</span><span className="flex items-center gap-1 px-2 py-1 text-[#7A7366]"><Eye size={11} /> Preview</span></span>}>
      <div className="flex min-h-0 flex-1">
        <div className="ut-palette">
          <p className="ut-label">Fields</p>
          {palette.map(([icon, label]) => (
            <div key={label} className={`ut-palette-item ${label === "List" ? "is-hot" : ""}`}>{icon}{label}</div>
          ))}
        </div>
        <div className="ut-grid">
          <div className="ut-gfield ut-t ut-a-drop" style={at(0.2)}><Heading size={13} className="text-[#7A7366]" /><b className="font-semibold">Who is asking?</b><span className="ut-gkey ut-mono">section</span></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="ut-gfield ut-t ut-a-drop" style={at(0.5)}><Users size={13} className="text-[#7A7366]" />Requester<span className="ut-gkey ut-mono ut-hide-sm">requester</span></div>
            <div className="ut-gfield ut-t ut-a-drop" style={at(0.7)}><List size={13} className="text-[#7A7366]" />Cost centre<span className="ut-gkey ut-mono ut-hide-sm">cost_centre</span></div>
          </div>
          <div className="ut-list ut-t ut-a-drop is-selected relative" style={vars({ animationDelay: `${listAt}s`, borderColor: "#1B1916", boxShadow: "0 0 0 3px rgba(27,25,22,.07)" })}>
            <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] font-semibold"><List size={13} />Line items<span className="ut-gkey ut-mono">line_items</span></div>
            <div className="ut-list-row is-head"><span>Item</span><span>Qty</span><span className="ut-hide-sm">Unit price</span><span>Line total</span></div>
            <div className="ut-list-row ut-t ut-a-left" style={at(addAt + 0.5)}><span>Monitor, 27-inch</span><span>2</span><span className="ut-hide-sm">420.00</span><span>840.00</span></div>
            <div className="ut-list-row ut-t ut-a-left" style={at(addAt + 1.1)}><span>Keyboard</span><span>2</span><span className="ut-hide-sm">95.00</span><span>190.00</span></div>
            <div className="border-t border-[#E8E2D6] px-2.5 py-2">
              <button type="button" className="ut-target relative inline-flex items-center gap-1 rounded-md border border-dashed border-[#B8AE9C] px-2 py-1 text-[11.5px] font-semibold text-[#5C564C]" onClick={onAct}>
                <Plus size={12} /> Add item
                <Cursor from={[-220, -150]} delay={addAt - 1} />
              </button>
            </div>
          </div>
          <div className="ut-gfield ut-t ut-a-drop" style={at(addAt + 1.6)}><Hash size={13} className="text-[#7A7366]" />Total<span className="ut-chip ut-chip-blue ml-2 before:!hidden ut-mono">= sum(line_items.line_total)</span><span className="ut-gkey ut-mono ut-hide-sm">total</span></div>
        </div>
        <div className="ut-props ut-hide-md">
          <div className="ut-tabs !gap-3 text-[11.5px]"><span className="is-on">Field</span><span>Rules</span><span>Data</span></div>
          <div className="ut-t ut-a-in" style={at(listAt + 0.3)}><p className="ut-label">Label</p><div className="ut-field">Line items</div></div>
          <div className="ut-t ut-a-in" style={at(listAt + 0.45)}><p className="ut-label">Columns</p><div className="flex flex-wrap gap-1">{["Item", "Qty", "Unit price", "Line total"].map((column) => <span key={column} className="ut-chip ut-chip-grey before:!hidden">{column}</span>)}</div></div>
          <div className="ut-t ut-a-in" style={at(listAt + 0.6)}><p className="ut-label">Rows</p><div className="ut-field justify-between">At least 1 <span className="ut-sub">max 50</span></div></div>
          <div className="ut-t ut-a-in rounded-lg bg-[#E5F1E8] p-2 text-[11.5px] text-[#2F5E40]" style={at(addAt + 1.8)}><b className="font-semibold">Rule</b> · Over $2,000 shows “Business case”</div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── 4. Workflow designer ─────────────────────────────────────────────── */
type CanvasNode = { x: number; y: number; label: string; note: string; colour: string; icon: ReactNode; delay: number }

const CANVAS: CanvasNode[] = [
  { x: 11, y: 50, label: "Form submitted", note: "Purchase request", colour: "#3F7A54", icon: <Zap size={12} />, delay: 0.3 },
  { x: 30, y: 50, label: "Budget check", note: "Decision table", colour: "#9A6B2F", icon: <Scale size={12} />, delay: 0.75 },
  { x: 49, y: 50, label: "Manager approval", note: "User task · SLA 1 day", colour: "#3B6FD8", icon: <UserCheck size={12} />, delay: 1.2 },
  { x: 68, y: 50, label: "Over $2,000?", note: "Branch by condition", colour: "#7C5CD6", icon: <GitBranch size={12} />, delay: 1.65 },
  { x: 88, y: 22, label: "Finance approval", note: "User task · Finance team", colour: "#3B6FD8", icon: <Users size={12} />, delay: 2.1 },
  { x: 88, y: 78, label: "Create purchase order", note: "ERP · REST reference", colour: "#2F8C9E", icon: <ShoppingCart size={12} />, delay: 2.55 },
]

export function CanvasScene({ onAct }: SceneProps) {
  const nodeTypes: Array<[ReactNode, string]> = [[<Zap key="z" size={13} />, "Triggers"], [<UserCheck key="u" size={13} />, "User Task"], [<GitBranch key="g" size={13} />, "Branch"], [<Scale key="s" size={13} />, "Decision table"], [<ShoppingCart key="r" size={13} />, "API reference"], [<Mail key="m" size={13} />, "Send email"]]
  const edge = (d: string, delay: number) => <path d={d} pathLength={100} className="ut-t ut-edge-draw" style={vars({ "--len": 100, "--delay": `${delay}s` })} vectorEffect="non-scaling-stroke" />
  const validated = 3.4
  return (
    <AppWindow url="acme.usertasks.com/automations/purchase-approval" active="workflows" title={<span className="flex items-center gap-2">Purchase approval <span className="ut-chip ut-chip-amber">Draft</span></span>} right={
      <span className="flex items-center gap-2">
        <span className="ut-t ut-a-pop ut-chip ut-chip-green ut-hide-sm" style={at(validated)}>0 issues</span>
        <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative">Save &amp; Test<Cursor from={[-260, 160]} delay={validated + 0.5} /></button>
      </span>
    }>
      <div className="flex min-h-0 flex-1">
        <div className="ut-palette">
          <p className="ut-label">Steps</p>
          {nodeTypes.map(([icon, label]) => <div key={label} className="ut-palette-item">{icon}{label}</div>)}
        </div>
        <div className="relative min-w-0 flex-1 p-3">
          <PhoneFlow steps={CANVAS.map((node) => ({ label: node.label, note: node.note, colour: node.colour, icon: node.icon, state: "plain" as const, delay: node.delay }))} />
          <div className="ut-flow ut-flow-wide">
            <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
              {edge("M110 280 L300 280", 1.0)}
              {edge("M300 280 L490 280", 1.45)}
              {edge("M490 280 L680 280", 1.9)}
              {edge("M680 280 C780 280 780 123 880 123", 2.35)}
              {edge("M680 280 C780 280 780 437 880 437", 2.8)}
              {edge("M880 123 L880 437", 3.0)}
              <path d="M110 280 L680 280" className="ut-t ut-a-show ut-edge-run" style={at(validated + 0.3)} vectorEffect="non-scaling-stroke" />
            </svg>
            {CANVAS.map((node) => (
              <div key={node.label} className="ut-node ut-t ut-a-drop" style={vars({ left: `${node.x}%`, top: `${node.y}%`, "--c": node.colour, "--w": "min(150px, 19%)", animationDelay: `${node.delay}s` })}>
                <div className="ut-node-head"><span className="shrink-0">{node.icon}</span><span className="truncate">{node.label}</span></div>
                <div className="ut-node-body ut-hide-sm truncate">{node.note}</div>
              </div>
            ))}
            <span className="ut-t ut-a-in absolute left-[59%] top-[34%] ut-hide-sm rounded-full bg-[#7C5CD6] px-2 py-0.5 text-[10px] font-semibold text-white" style={at(2.4)}>Yes</span>
            <span className="ut-t ut-a-in absolute left-[59%] top-[62%] ut-hide-sm rounded-full bg-[#6E6759] px-2 py-0.5 text-[10px] font-semibold text-white" style={at(2.85)}>No</span>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── 5. Ready to deploy ─────────────────────────────────────────────── */
export function DeployScene({ onAct }: SceneProps) {
  const checks = ["Form · Purchase request, version 1", "Workflow validated · 0 issues", "Save & Test · 3 test cases passed", "Report · Spend by cost centre"]
  const publish = 2.9
  return (
    <AppWindow url="acme.usertasks.com/automations/purchase-approval" active="workflows" title={<span className="flex items-center gap-2">Purchase approval <span className="ut-t ut-a-hide ut-chip ut-chip-amber" style={at(publish + 0.3)}>Draft</span></span>}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[#EFEBE2] p-4">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(27,25,22,.15)_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden="true" />
        <div className="ut-card ut-t ut-a-pop relative w-full max-w-[420px] p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,.45)]" style={at(0.1)}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#F3C77F] to-[#D99A52] text-[#1B1406]"><Rocket size={18} /></span>
            <div><p className="ut-h">Ready to deploy</p><p className="ut-sub">Purchase approval · version 1</p></div>
          </div>
          <ul className="mt-4 space-y-2">
            {checks.map((check, index) => (
              <li key={check} className="ut-t ut-a-left flex items-center gap-2 text-[12.5px]" style={at(0.5 + index * 0.4)}>
                <CheckCircle2 size={16} className="shrink-0 text-[#3F7A54]" />{check}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center gap-2">
            <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative overflow-visible">
              <span className="ut-t ut-a-hide flex items-center gap-1.5" style={at(publish + 0.2)}><Rocket size={13} /> Publish</span>
              <span className="ut-t ut-a-show absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-[#3F7A54]" style={at(publish + 0.2)}><Check size={13} strokeWidth={3} /> Live</span>
              <Cursor from={[180, 90]} delay={publish - 1} />
              <Confetti x={50} y={50} delay={publish + 0.2} />
            </button>
            <span className="ut-btn">Keep as draft</span>
          </div>
          <div className="ut-t ut-a-in mt-4 rounded-lg bg-[#F4F1E9] p-2.5 text-[11.5px]" style={at(publish + 0.6)}>
            <p className="font-semibold">Live · version 1</p>
            <p className="ut-mono mt-0.5 flex items-center gap-1 text-[#5C564C]">acme.usertasks.com/form/purchase-request <ChevronRight size={11} /></p>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}
