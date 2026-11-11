import { Download, Filter, Link2, Plus } from "lucide-react"
import { AppWindow, at, Cursor, Typed, vars, type SceneProps } from "./demo-kit"

/** Scenes for the Data & Reports and Integrations pages: a data table, a report with charts and the CLI. */

const ROWS: Array<[string, string, string, string, "Approved" | "In review" | "Ordered"]> = [
  ["PUR-1042", "Sam Lee", "Design", "4,200.00", "Approved"],
  ["PUR-1041", "Mere Tane", "Operations", "1,180.00", "Ordered"],
  ["PUR-1040", "Jonas Berg", "Engineering", "12,650.00", "In review"],
  ["PUR-1039", "Ana Silva", "Marketing", "640.00", "Approved"],
  ["PUR-1038", "Wiremu Ngata", "Facilities", "2,300.00", "Ordered"],
]

const STATUS_CHIP = { Approved: "ut-chip-green", "In review": "ut-chip-amber", Ordered: "ut-chip-blue" } as const

/* ── Data table ─────────────────────────────────────────────── */
export function TableScene({ onAct }: SceneProps) {
  return (
    <AppWindow url="acme.usertasks.com/data/purchase-requests" active="data" title="Purchase requests" right={<span className="ut-hide-sm ut-chip ut-chip-grey before:!hidden"><Link2 size={11} /> OData feed</span>}>
      <div className="ut-content">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ut-t ut-a-pop ut-chip ut-chip-blue before:!hidden" style={at(0.4)}><Filter size={11} /> Status is Approved or Ordered</span>
          <span className="ut-t ut-a-pop ut-chip ut-chip-grey before:!hidden" style={at(0.7)}>Group by cost centre</span>
          <button type="button" onClick={onAct} className="ut-target ut-btn ut-btn-dark relative ml-auto">
            <Plus size={13} /> Add row
            <Cursor from={[-240, 160]} delay={3.4} />
          </button>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E8E2D6]">
          <table className="ut-table">
            <thead><tr><th>Request</th><th>Requester</th><th className="ut-hide-sm">Cost centre</th><th>Total (USD)</th><th className="ut-hide-sm">Status</th></tr></thead>
            <tbody>
              {ROWS.map((row, index) => (
                <tr key={row[0]} className="ut-t ut-a-left" style={at(0.2 + index * 0.12)}>
                  <td className="ut-mono text-[11.5px]">{row[0]}</td><td>{row[1]}</td><td className="ut-hide-sm">{row[2]}</td><td className="text-right tabular-nums">{row[3]}</td>
                  <td className="ut-hide-sm"><span className={`ut-chip ${STATUS_CHIP[row[4]]}`}>{row[4]}</span></td>
                </tr>
              ))}
              <tr className="ut-row-new" style={vars({ "--delay": "1.8s" })}>
                <td className="ut-mono text-[11.5px]"><span className="ut-t ut-a-in inline-block" style={at(1.8)}>PUR-1043</span></td>
                <td><span className="ut-t ut-a-in inline-block" style={at(1.85)}>Ada Lovelace</span></td>
                <td className="ut-hide-sm"><span className="ut-t ut-a-in inline-block" style={at(1.9)}>Finance</span></td>
                <td className="text-right tabular-nums"><span className="ut-t ut-a-in inline-block" style={at(1.95)}>890.00</span></td>
                <td className="ut-hide-sm"><span className="ut-t ut-a-pop ut-chip ut-chip-amber inline-flex" style={at(2)}>In review</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="ut-sub ut-t ut-a-in mt-3" style={at(2.4)}>Rows added by the Purchase approval workflow · updated 2 seconds ago</p>
      </div>
    </AppWindow>
  )
}

/* ── Report with charts ─────────────────────────────────────────────── */
export function ReportScene({ onAct }: SceneProps) {
  const kpis: Array<[string, string]> = [["Requests", "128"], ["Approved", "91%"], ["Median time to approve", "3.2 h"], ["Spend", "$214k"]]
  const bars: Array<[string, number, boolean]> = [["Design", 62, false], ["Eng.", 96, true], ["Ops", 48, false], ["Mktg", 70, true], ["Facil.", 36, false], ["Finance", 54, true]]
  return (
    <AppWindow url="acme.usertasks.com/reports/spend-by-cost-centre" active="reports" title="Spend by cost centre · last 90 days" right={
      <button type="button" onClick={onAct} className="ut-target ut-btn relative ut-hide-sm"><Download size={13} /> Export<Cursor from={[-220, 200]} delay={3.6} /></button>
    }>
      <div className="ut-content flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {kpis.map(([label, value], index) => (
            <div key={label} className="ut-card ut-t ut-a-in p-3" style={at(0.2 + index * 0.12)}>
              <p className="ut-sub truncate">{label}</p>
              <p className="mt-0.5 text-[19px] font-bold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
          <div className="ut-card flex min-h-[150px] flex-col p-3">
            <p className="ut-label">Spend by cost centre (USD k)</p>
            <div className="ut-bars mt-2 min-h-0 flex-1">
              {bars.map(([label, height, alt], index) => (
                <div key={label}>
                  <span className="ut-t ut-a-in text-[10.5px] font-semibold" style={at(1 + index * 0.1)}>{Math.round(height * 0.62)}</span>
                  <div className={`ut-bar ${alt ? "is-alt" : ""}`} style={vars({ height: `${height}%`, "--delay": `${0.6 + index * 0.1}s` })} />
                  <span className="text-[10.5px] text-[#7A7366]">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ut-card ut-hide-sm flex items-center gap-4 p-3">
            <svg viewBox="0 0 42 42" className="size-28 shrink-0 -rotate-90" aria-hidden="true">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EFE9DD" strokeWidth="6" />
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#3F7A54" strokeWidth="6" pathLength={100} strokeDasharray="62 38" className="ut-t ut-donut" style={vars({ "--len": 62, "--delay": "0.9s" })} />
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#E8B266" strokeWidth="6" pathLength={100} strokeDasharray="24 76" strokeDashoffset={-62} className="ut-t ut-a-show" style={at(1.6)} />
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#8B7CF6" strokeWidth="6" pathLength={100} strokeDasharray="14 86" strokeDashoffset={-86} className="ut-t ut-a-show" style={at(1.9)} />
            </svg>
            <ul className="space-y-1.5 text-[12px]">
              <li className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-[#3F7A54]" />Ordered 62%</li>
              <li className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-[#E8B266]" />Approved 24%</li>
              <li className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-[#8B7CF6]" />In review 14%</li>
            </ul>
          </div>
        </div>
      </div>
    </AppWindow>
  )
}

/* ── CLI ─────────────────────────────────────────────── */
export function CliScene({ onAct }: SceneProps) {
  const first = "usertasks workflows create -f purchase-approval.json"
  const second = "usertasks workflows publish wf_8c21 --set notes=\"Finance step over 2,000\""
  const third = "usertasks logs tail --category workflow"
  const t1 = 0.4
  const t2 = t1 + first.length * 0.03 + 0.9
  const t3 = t2 + second.length * 0.03 + 0.9
  const tail = t3 + third.length * 0.03 + 0.4
  const logs = [
    ["09:41:02", "run.started", "Purchase approval", "PUR-1043"],
    ["09:41:02", "step.completed", "Budget check", "within budget"],
    ["09:41:03", "task.created", "Manager approval", "→ Priya Nair"],
    ["09:52:40", "task.completed", "Manager approval", "approved"],
    ["09:52:41", "integration.call", "Create purchase order", "201 · 84 ms"],
  ]
  return (
    <div className="ut-window h-full">
      <div className="ut-titlebar" aria-hidden="true"><div className="ut-dots"><i /><i /><i /></div><div className="ut-url">~/acme-processes — zsh</div><div style={{ width: 52 }} /></div>
      <div className="relative" style={{ height: "calc(100% - 36px)" }}>
        <div className="ut-term !rounded-none">
          <p><span className="p">❯ </span><Typed text={first} delay={t1} speed={0.03} caret={false} /></p>
          <p className="ut-t ut-a-show ok" style={at(t2 - 0.6)}>✓ Created workflow wf_8c21 “Purchase approval” (draft, 6 steps)</p>
          <p className="mt-2"><span className="ut-t ut-a-show p" style={at(t2 - 0.1)}>❯ </span><Typed text={second} delay={t2} speed={0.03} caret={false} /></p>
          <p className="ut-t ut-a-show ok" style={at(t3 - 0.6)}>✓ Published version 1</p>
          <p className="mt-2"><span className="ut-t ut-a-show p" style={at(t3 - 0.1)}>❯ </span><Typed text={third} delay={t3} speed={0.03} caret={false} /></p>
          {logs.map((line, index) => (
            <p key={index} className="ut-t ut-a-show truncate" style={at(tail + index * 0.35)}>
              <span className="dim">{line[0]} </span><span className="p">{line[1].padEnd(17)}</span> {line[2]} <span className="dim">· {line[3]}</span>
            </p>
          ))}
        </div>
        <button type="button" onClick={onAct} className="ut-target sr-only">Show the final output</button>
      </div>
    </div>
  )
}
