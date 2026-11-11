import type { ReactNode } from "react"
import { Check, ChevronRight, Clock, FileText, Flag, Mail, Paperclip, Scale, ShoppingCart, UserCheck, Users } from "lucide-react"
import { AppWindow, at, Confetti, Cursor, PhoneFlow, Typed, vars, type SceneProps } from "./demo-kit"

/**
 * "Get work done": a purchase request reaches Ada, she opens it, sees where
 * it is in the process and who has touched it, and approves it. The data is
 * one fictional request (Northwind Design, $4,200).
 */

const TITLE = "Approve purchase: MacBook Pro ($4,200)"
const URL = "acme.usertasks.com/tasks"

/* ── 1. Inbox ─────────────────────────────────────────────────── */
export function InboxScene({ onAct }: SceneProps) {
  const rows = [
    { task: "Review contract: Harbour Freight renewal", process: "Contract review", due: "Tomorrow", priority: "High", status: <span className="ut-chip ut-chip-blue">In progress</span> },
    { task: "Onboard: Priya Shah — laptop and access", process: "Employee onboarding", due: "Fri 14 Nov", priority: "Medium", status: <span className="ut-chip ut-chip-amber">Queued</span> },
    { task: "Expense claim: Wellington offsite", process: "Expense claims", due: "Mon 17 Nov", priority: "Low", status: <span className="ut-chip ut-chip-grey">Todo</span> },
    { task: "Access request: Finance shared drive", process: "Access requests", due: "Tue 18 Nov", priority: "Medium", status: <span className="ut-chip ut-chip-grey">Todo</span> },
    { task: "Timesheet: week 46, Mere Tane", process: "Timesheet approval", due: "Fri 21 Nov", priority: "Low", status: <span className="ut-chip ut-chip-grey">Todo</span> },
  ]
  return (
    <AppWindow url={URL} active="tasks" title="My tasks" badge={6}>
      <div className="ut-content">
        <div className="ut-toast ut-t" style={vars({ "--delay": "0.5s" })}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#E8B266] text-[#1B1406]"><Flag size={14} /></span>
          <span><b className="block text-[12px] text-white">New task assigned to you</b><span className="text-[#C9BFAE]">Purchase request · from Sam Lee</span></span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div><p className="ut-h">Good morning, Ada</p><p className="ut-sub">6 tasks · 2 due this week</p></div>
          <div className="ut-hide-sm flex gap-1.5"><span className="ut-chip ut-chip-grey">All 6</span><span className="ut-chip ut-chip-amber">Due soon 2</span></div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-[#E8E2D6]">
          <table className="ut-table">
            <thead><tr><th>Task</th><th className="ut-hide-sm">Process</th><th>Due</th><th className="ut-hide-sm ut-hide-md">Priority</th><th className="ut-hide-sm">Status</th></tr></thead>
            <tbody>
              <tr className="ut-row-new ut-t ut-a-in cursor-pointer" style={vars({ "--delay": "0.9s", animationDelay: "0.9s" })} onClick={onAct}>
                <td className="relative !overflow-visible">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onAct() }} className="ut-target flex max-w-full items-center gap-2 text-left font-semibold" aria-label={`Open task: ${TITLE}`}>
                    <span className="ut-t ut-a-pop ut-ring size-2 shrink-0 rounded-full bg-[#E8B266]" style={at(1.2)} /><span className="truncate">{TITLE}</span>
                  </button>
                  <Cursor from={[260, 170]} delay={2.3} at={[40, 50]} />
                </td>
                <td className="ut-hide-sm">Purchase request</td>
                <td><span className="ut-due inline-flex items-center gap-1"><Clock size={12} />2 days</span></td>
                <td className="ut-hide-sm ut-hide-md">High</td>
                <td className="ut-hide-sm"><span className="ut-chip ut-chip-amber">New</span></td>
              </tr>
              {rows.map((row) => (
                <tr key={row.task}>
                  <td>{row.task}</td><td className="ut-hide-sm">{row.process}</td><td>{row.due}</td><td className="ut-hide-sm ut-hide-md">{row.priority}</td><td className="ut-hide-sm">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── Shared task header ─────────────────────────────────────────── */
type Tab = "Form" | "Process" | "Timeline" | "Comments"

function TaskHeader({ tab, target, onAct, done = false, cursorDelay = 3.6 }: { tab: Tab; target?: Tab | "Approve"; onAct: () => void; done?: boolean; cursorDelay?: number }) {
  const tabs: Tab[] = ["Form", "Process", "Timeline", "Comments"]
  return (
    <div>
      <p className="ut-sub flex items-center gap-1">My tasks <ChevronRight size={11} /> <span className="ut-mono">PUR-1042</span></p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="ut-h min-w-0 truncate">{TITLE}</p>
        <div className="ut-hide-sm flex shrink-0 gap-1.5">
          {target === "Approve" ? (
            <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative"><Check size={13} /> Approve<Cursor from={[-160, 170]} delay={cursorDelay} /></button>
          ) : (
            <span className={`ut-btn ${done ? "ut-btn-go" : "ut-btn-dark"}`}><Check size={13} /> {done ? "Approved" : "Approve"}</span>
          )}
          <span className="ut-btn ut-hide-md">Reject</span>
          <span className="ut-btn ut-hide-md">Request changes</span>
        </div>
      </div>
      <div className="ut-hide-sm mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        <span><span className="ut-sub">Priority </span><b className="font-semibold">High</b></span>
        <span><span className="ut-sub">Due </span><b className="font-semibold text-[#B23A2E]">in 2 days</b></span>
        <span><span className="ut-sub">Requested by </span><b className="font-semibold">Sam Lee</b></span>
        <span className="ut-hide-md"><span className="ut-sub">Step </span><b className="font-semibold">Finance approval</b></span>
      </div>
      <div className="ut-tabs mt-3">
        {tabs.map((name) => {
          const label = name === "Comments" ? <>Comments <span className="ut-chip ut-chip-grey !h-4 !px-1.5 before:!hidden">1</span></> : name
          if (name === target) {
            return <button key={name} type="button" onClick={onAct} className="ut-target relative py-2 text-[12.5px]">{label}<Cursor from={[-200, 180]} delay={cursorDelay} /></button>
          }
          return <span key={name} className={name === tab ? "is-on" : ""}>{label}</span>
        })}
      </div>
    </div>
  )
}

/* ── 2. The task form ─────────────────────────────────────────────── */
export function TaskScene({ onAct }: SceneProps) {
  const fields: Array<[string, ReactNode]> = [
    ["Requester", "Sam Lee · Design"],
    ["Cost centre", <span key="cc" className="flex items-center gap-2">Design <span className="ut-mono text-[11px] text-[#7A7366]">CC-410</span></span>],
    ["Supplier", "Northwind Tech Ltd"],
    ["Needed by", "Fri 28 Nov 2026"],
  ]
  const items: Array<[string, string, string, string]> = [
    ["MacBook Pro 14-inch, 32 GB", "1", "3,890.00", "3,890.00"],
    ["USB-C dock", "1", "310.00", "310.00"],
  ]
  return (
    <AppWindow url={`${URL}/PUR-1042`} active="tasks" title="Task" badge={4}>
      <div className="ut-content">
        <div className="ut-t ut-a-in"><TaskHeader tab="Form" target="Process" onAct={onAct} cursorDelay={4} /></div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_200px]">
          <div className="ut-card p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map(([label, value], index) => (
                <div key={label} className="ut-t ut-a-in" style={at(0.35 + index * 0.12)}>
                  <p className="ut-label">{label}</p><div className="ut-field">{value}</div>
                </div>
              ))}
            </div>
            <div className="ut-t ut-a-in mt-3" style={at(0.9)}>
              <p className="ut-label">Line items</p>
              <div className="ut-list">
                <div className="ut-list-row is-head"><span>Item</span><span>Qty</span><span className="ut-hide-sm">Unit</span><span>Total</span></div>
                {items.map((row, index) => (
                  <div key={row[0]} className="ut-list-row ut-t ut-a-left" style={at(1.1 + index * 0.18)}><span className="truncate">{row[0]}</span><span>{row[1]}</span><span className="ut-hide-sm">{row[2]}</span><span>{row[3]}</span></div>
                ))}
              </div>
            </div>
            <div className="ut-t ut-a-pop mt-3 flex items-center justify-between rounded-lg bg-[#FBF0DC] px-3 py-2" style={at(1.6)}>
              <span className="text-[12px] font-semibold text-[#8A5A16]">Total</span><span className="text-[15px] font-bold">$4,200.00</span>
            </div>
          </div>
          <div className="ut-hide-sm ut-card ut-t ut-a-right flex flex-col gap-2 p-3 lg:flex" style={at(1.3)}>
            <p className="ut-label">Attachments</p>
            <div className="flex items-center gap-2 rounded-lg border border-[#E8E2D6] p-2 text-[12px]"><Paperclip size={13} className="text-[#8A6D45]" /> Quote-NW-5531.pdf</div>
            <p className="ut-label mt-2">Policy</p>
            <div className="flex items-center gap-2 rounded-lg bg-[#E5F1E8] p-2 text-[12px] text-[#3F7A54]"><Scale size={13} /> Within budget</div>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── Flow drawing (process view, approve strip) ─────────────────────── */
type FlowNode = { id: string; x: number; y: number; label: string; note: string; colour: string; icon: ReactNode; state: "done" | "current" | "idle"; delay?: number }

function FlowNodes({ nodes, pin }: { nodes: FlowNode[]; pin?: { id: string; text: string; delay: number } }) {
  return (
    <>
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`ut-node is-${node.state} ${node.state === "done" && node.delay !== undefined ? "ut-t ut-node-done-anim" : ""} ${node.state === "current" ? "ut-ring" : ""}`}
          style={vars({ left: `${node.x}%`, top: `${node.y}%`, "--c": node.colour, "--delay": `${node.delay ?? 0}s`, "--w": "min(158px, 22%)" })}
        >
          <div className="ut-node-head"><span className="shrink-0">{node.icon}</span><span className="truncate">{node.label}</span></div>
          {node.note && <div className="ut-node-body ut-hide-sm truncate">{node.note}</div>}
          {node.state === "done" && <span className="ut-node-status ut-t ut-a-pop flex size-4 items-center justify-center rounded-full bg-[#3F7A54] text-white" style={at((node.delay ?? 0) + 0.2)}><Check size={10} strokeWidth={3} /></span>}
        </div>
      ))}
      {pin && (() => {
        const node = nodes.find((candidate) => candidate.id === pin.id)!
        return <span className="ut-pin ut-t ut-a-drop" style={vars({ left: `${node.x}%`, top: `${node.y - 8}%`, animationDelay: `${pin.delay}s` })}>{pin.text}</span>
      })()}
    </>
  )
}

const PROCESS: FlowNode[] = [
  { id: "submit", x: 13, y: 26, label: "Request submitted", note: "Purchase request form", colour: "#3F7A54", icon: <FileText size={12} />, state: "done", delay: 0.3 },
  { id: "budget", x: 38, y: 26, label: "Budget check", note: "Decision table · CC budgets", colour: "#9A6B2F", icon: <Scale size={12} />, state: "done", delay: 0.9 },
  { id: "manager", x: 63, y: 26, label: "Manager approval", note: "Priya Nair · approved", colour: "#3B6FD8", icon: <UserCheck size={12} />, state: "done", delay: 1.5 },
  { id: "amount", x: 87, y: 26, label: "Over $2,000?", note: "Branch by condition", colour: "#7C5CD6", icon: <ChevronRight size={12} />, state: "done", delay: 2.1 },
  { id: "finance", x: 87, y: 72, label: "Finance approval", note: "Assigned to you", colour: "#3B6FD8", icon: <Users size={12} />, state: "current" },
  { id: "po", x: 58, y: 72, label: "Create purchase order", note: "ERP · REST reference", colour: "#2F8C9E", icon: <ShoppingCart size={12} />, state: "idle" },
  { id: "notify", x: 28, y: 72, label: "Email Sam", note: "Email template", colour: "#2F8C9E", icon: <Mail size={12} />, state: "idle" },
]

/** Edges in a 1000 × 560 box (the node centres above, scaled). */
function ProcessEdges({ finished = false, offset = 0 }: { finished?: boolean; offset?: number }) {
  const h = (a: number, b: number, y: number) => `M${a * 10} ${y * 5.6} L${b * 10} ${y * 5.6}`
  const edge = (d: string, delay: number) => <path d={d} pathLength={100} className="ut-t ut-edge-on" style={vars({ "--len": 100, "--delay": `${delay + offset}s` })} vectorEffect="non-scaling-stroke" />
  return (
    <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
      {edge(h(13, 38, 26), 0.6)}
      {edge(h(38, 63, 26), 1.2)}
      {edge(h(63, 87, 26), 1.8)}
      {finished
        ? <>{edge("M870 146 L870 403", 0)}{edge("M870 403 L580 403", 0.5)}</>
        : <><path d="M870 146 L870 403" className="ut-edge-live" vectorEffect="non-scaling-stroke" /><path d="M870 403 L580 403" className="ut-edge" vectorEffect="non-scaling-stroke" /></>}
      <path d="M580 403 L280 403" className="ut-edge" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ── 3. Process view ─────────────────────────────────────────────── */
export function ProcessScene({ onAct }: SceneProps) {
  return (
    <AppWindow url={`${URL}/PUR-1042?tab=process`} active="tasks" title="Task" badge={4}>
      <div className="ut-content flex flex-col">
        <TaskHeader tab="Process" target="Timeline" onAct={onAct} cursorDelay={4.1} />
        <div className="mt-3 min-h-0 flex-1">
          <PhoneFlow pin="You" steps={PROCESS.slice(2, 6).map((node, index) => ({ label: node.label, note: node.note, colour: node.colour, icon: node.icon, state: node.state, delay: 0.2 + index * 0.25 }))} />
          <div className="ut-flow ut-flow-wide">
            <ProcessEdges />
            <FlowNodes nodes={PROCESS} pin={{ id: "finance", text: "Waiting for you", delay: 2.6 }} />
            <div className="ut-t ut-a-in absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px]" style={at(2.8)}>
              <span className="ut-chip ut-chip-green">4 steps done</span>
              <span className="ut-chip ut-chip-amber">1 waiting · you</span>
              <span className="ut-chip ut-chip-grey ut-hide-sm">2 to go</span>
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── Timeline items ─────────────────────────────────────────────── */
type Event = { title: string; meta: string; quote?: string; wait?: boolean; delay: number; icon?: ReactNode }

function Timeline({ events }: { events: Event[] }) {
  return (
    <div className="ut-tl">
      {events.map((event) => (
        <div key={event.title} className="ut-tl-item ut-t ut-a-left" style={at(event.delay)}>
          <span className={`ut-tl-dot ${event.wait ? "is-wait ut-ring" : ""}`}>{event.wait ? <Clock size={9} strokeWidth={3} /> : <Check size={9} strokeWidth={3.5} />}</span>
          <p className="ut-tl-title">{event.title}</p>
          <p className="ut-tl-meta">{event.meta}</p>
          {event.quote && <p className="ut-quote">“{event.quote}”</p>}
        </div>
      ))}
    </div>
  )
}

const HISTORY: Event[] = [
  { title: "Submitted by Sam Lee", meta: "Mon 10 Nov · 09:12 · Purchase request form", quote: "Kit for our new designer, starting on the 1st.", delay: 0.3 },
  { title: "Budget check passed", meta: "Automatic · 09:12 · CC-410 has $18,300 left this quarter", delay: 0.75 },
  { title: "Approved by Priya Nair (manager)", meta: "Mon 10 Nov · 10:40", quote: "Within budget. Fine by me.", delay: 1.2 },
]

/* ── 4. Timeline ─────────────────────────────────────────────── */
export function TimelineScene({ onAct }: SceneProps) {
  return (
    <AppWindow url={`${URL}/PUR-1042?tab=timeline`} active="tasks" title="Task" badge={4}>
      <div className="ut-content">
        <TaskHeader tab="Timeline" target="Approve" onAct={onAct} cursorDelay={3.4} />
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_210px]">
          <Timeline events={[...HISTORY, { title: "Waiting for you · Finance approval", meta: "Assigned Mon 10:40 · due Wed 12 Nov, 17:00", wait: true, delay: 1.7 }]} />
          <div className="ut-hide-sm ut-card ut-t ut-a-right h-fit p-3" style={at(1.9)}>
            <p className="ut-label">SLA</p>
            <p className="text-[13px] font-semibold">Due in 2 days</p>
            <div className="ut-progress mt-2"><i style={vars({ "--dur": "1.2s", "--delay": "2.1s", width: "38%" })} /></div>
            <p className="ut-sub mt-2">Reminder tomorrow 09:00, then escalates to Finance lead.</p>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── 5. Approve ─────────────────────────────────────────────── */
export function ApproveScene({ onAct }: SceneProps) {
  const click = 3.3
  const strip: FlowNode[] = [
    { id: "manager", x: 14, y: 50, label: "Manager", note: "", colour: "#3B6FD8", icon: <UserCheck size={12} />, state: "done" },
    { id: "finance", x: 38, y: 50, label: "Finance", note: "", colour: "#3B6FD8", icon: <Users size={12} />, state: "done", delay: click + 0.4 },
    { id: "po", x: 62, y: 50, label: "Create PO", note: "", colour: "#2F8C9E", icon: <ShoppingCart size={12} />, state: "done", delay: click + 1.1 },
    { id: "notify", x: 86, y: 50, label: "Email Sam", note: "", colour: "#2F8C9E", icon: <Mail size={12} />, state: "done", delay: click + 1.6 },
  ]
  return (
    <AppWindow url={`${URL}/PUR-1042`} active="tasks" title="Task" badge={3}>
      <div className="ut-content flex flex-col gap-3">
        <div className="ut-toast ut-t" style={vars({ "--delay": `${click + 1.2}s` })}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#7FA98A] text-[#0E1A12]"><Check size={15} strokeWidth={3} /></span>
          <span><b className="block text-[12px] text-white">Approved · PO-2291 created</b><span className="text-[#C9BFAE]">Sam has been emailed</span></span>
        </div>
        <div className="ut-flow !h-[86px] shrink-0">
          <svg viewBox="0 0 1000 86" preserveAspectRatio="none" aria-hidden="true">
            <path d="M140 43 L380 43" pathLength={100} className="ut-edge-on" style={vars({ "--len": 100, "--delay": "0s" })} vectorEffect="non-scaling-stroke" />
            <path d="M380 43 L620 43" pathLength={100} className="ut-t ut-edge-on" style={vars({ "--len": 100, "--delay": `${click + 0.7}s` })} vectorEffect="non-scaling-stroke" />
            <path d="M620 43 L860 43" pathLength={100} className="ut-t ut-edge-on" style={vars({ "--len": 100, "--delay": `${click + 1.4}s` })} vectorEffect="non-scaling-stroke" />
          </svg>
          <FlowNodes nodes={strip} />
        </div>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="ut-card flex flex-col p-4">
            <p className="ut-label">Comment for Sam and the audit trail</p>
            <div className="ut-field !block min-h-[74px] py-2 leading-5"><Typed text="Approved. Charge to Design capex; Northwind delivers Thursday." delay={0.5} speed={0.035} /></div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative overflow-visible ut-t" style={vars({ animation: `ut-press 0.3s ease ${click}s both` })}>
                <span className="ut-t ut-a-hide flex items-center gap-1.5" style={at(click + 0.25)}><Check size={13} /> Approve</span>
                <span className="ut-t ut-a-show absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-[#3F7A54]" style={at(click + 0.25)}><Check size={13} strokeWidth={3} /> Approved</span>
                <Cursor from={[200, 120]} delay={click - 1.1} />
                <Confetti x={50} y={50} delay={click + 0.25} />
              </button>
              <span className="ut-btn ut-hide-sm">Reject</span>
              <span className="ut-sub ml-auto ut-hide-sm">Saved as you type</span>
            </div>
          </div>
          <div className="ut-card min-h-0 overflow-hidden p-4">
            <Timeline events={[
              { title: "Approved by Priya Nair (manager)", meta: "Mon 10 Nov · 10:40", delay: 0 },
              { title: "Approved by you", meta: "Just now · “Approved. Charge to Design capex…”", delay: click + 0.5 },
              { title: "Purchase order PO-2291 created", meta: "Automatic · ERP reference", delay: click + 1.2 },
              { title: "Sam Lee emailed", meta: "Automatic · Purchase approved template", delay: click + 1.7 },
            ]} />
          </div>
        </div>
      </div>
    </AppWindow>
  )
}
