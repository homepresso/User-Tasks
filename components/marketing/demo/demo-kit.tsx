import type { CSSProperties, ReactNode } from "react"
import { BarChart3, Bot, Database, FileText, Home, Inbox, Lock, Search, Bell, Users, Workflow } from "lucide-react"

/**
 * Building blocks of the demo scenes: the app window, sidebar, typed text,
 * streamed words, the cursor, click ripples and confetti. Pure markup; every
 * effect is a CSS animation with a delay (see demo.css), so scenes need no
 * timers of their own.
 */

export type SceneProps = {
  /** The visitor's click on the scene's target: advance (or finish the step now). */
  onAct: () => void
}

/** Style for an element that animates in at `delay` seconds. */
export const at = (delay: number, extra?: CSSProperties): CSSProperties => ({ animationDelay: `${delay}s`, ...extra })

/** The CSS custom property style helper (keeps call sites short). */
export const vars = (values: Record<string, string | number>): CSSProperties => values as CSSProperties

/** Text typed one character at a time from `delay`, `speed` seconds per character, with a caret while typing. */
export function Typed({ text, delay, speed = 0.045, caret = true }: { text: string; delay: number; speed?: number; caret?: boolean }) {
  return (
    <span>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {Array.from(text).map((char, index) => (
          <span key={index} className="ut-t ut-char" style={at(delay + index * speed)}>{char}</span>
        ))}
        {caret && <span className="ut-t ut-a-hide inline-block" style={at(delay + text.length * speed + 0.6)}><span className="ut-caret" /></span>}
      </span>
    </span>
  )
}

/** Words that stream in like a model's reply. */
export function Stream({ text, delay, speed = 0.05 }: { text: string; delay: number; speed?: number }) {
  const words = text.split(" ")
  return (
    <span>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <span key={index} className="ut-t ut-word" style={at(delay + index * speed)}>{word}{index < words.length - 1 ? " " : ""}</span>
        ))}
      </span>
    </span>
  )
}

/**
 * The pointer. Place it inside the (relatively positioned) element it points
 * at: it glides in from `from` (px offset from that element's centre) and
 * clicks on the centre, so it lands on target at every breakpoint.
 */
export function Cursor({ from, delay, duration = 1.1, at: spot = [50, 50] }: { from: [number, number]; delay: number; duration?: number; at?: [number, number] }) {
  const style = vars({ left: `${spot[0]}%`, top: `${spot[1]}%`, "--x0": `${from[0]}px`, "--y0": `${from[1]}px`, "--x1": "0px", "--y1": "0px", "--delay": `${delay}s`, "--dur": `${duration}s` })
  return (
    <>
      <svg aria-hidden="true" className="ut-t ut-cursor" style={style} viewBox="0 0 24 24">
        <path d="M4 2.5 L4 19 L8.6 14.9 L11.6 21.5 L14.4 20.3 L11.5 13.8 L17.8 13.8 Z" fill="#fff" stroke="#1B1916" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span aria-hidden="true" className="ut-t ut-click" style={vars({ left: `${spot[0]}%`, top: `${spot[1]}%`, "--delay": `${delay + duration * 0.86}s` })} />
    </>
  )
}

const CONFETTI_COLOURS = ["#E8B266", "#8B7CF6", "#4FB3A9", "#E06C5A", "#7FA98A", "#F3D08A", "#4C8DF6"]

/** A burst of confetti at (x, y) percent of the scene. Deterministic (no Math.random in render). */
export function Confetti({ x, y, delay, count = 28 }: { x: number; y: number; delay: number; count?: number }) {
  return (
    <div aria-hidden="true" className="ut-confetti" style={vars({ "--cx": `${x}%`, "--cy": `${y}%` })}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.3
        const distance = 70 + ((index * 37) % 90)
        return (
          <i
            key={index}
            className="ut-t"
            style={vars({
              "--c": CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
              "--dx": `${Math.round(Math.cos(angle) * distance)}px`,
              "--dy": `${Math.round(Math.sin(angle) * distance * 0.8 + 40)}px`,
              "--r": `${(index * 47) % 360}deg`,
              "--delay": `${delay + (index % 4) * 0.02}s`,
            })}
          />
        )
      })}
    </div>
  )
}

type NavKey = "home" | "tasks" | "queue" | "data" | "reports" | "workflows" | "forms" | "agents"

/** The browser window with the app's sidebar and top bar. */
export function AppWindow({ url, active, title, right, children, badge = 3 }: { url: string; active: NavKey; title: ReactNode; right?: ReactNode; children: ReactNode; badge?: number }) {
  const item = (key: NavKey, icon: ReactNode, label: string, extra?: ReactNode) => (
    <div className={`ut-side-item ${active === key ? "is-active" : ""}`}>{icon}<span>{label}</span>{extra}</div>
  )
  return (
    <div className="ut-window h-full">
      <div className="ut-titlebar" aria-hidden="true">
        <div className="ut-dots"><i /><i /><i /></div>
        <div className="ut-url"><Lock size={10} />{url}</div>
        <div className="ut-hide-sm" style={{ width: 52 }} />
      </div>
      <div className="ut-app">
        <aside className="ut-side" aria-hidden="true">
          <div className="ut-side-logo"><LogoGlyph /><span>user<b>tasks</b></span></div>
          {item("home", <Home size={15} />, "Home")}
          {item("tasks", <Inbox size={15} />, "My tasks", <span className="ut-badge">{badge}</span>)}
          {item("queue", <Users size={15} />, "Task queue")}
          {item("data", <Database size={15} />, "Data")}
          {item("reports", <BarChart3 size={15} />, "Reports")}
          <p className="ut-side-head">Build</p>
          {item("workflows", <Workflow size={15} />, "Workflows")}
          {item("forms", <FileText size={15} />, "Forms")}
          {item("agents", <Bot size={15} />, "Agents")}
        </aside>
        <div className="ut-main">
          <div className="ut-topbar">
            <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
            {right}
            <div className="ut-search" aria-hidden="true"><Search size={13} /> Search or jump to…</div>
            <Bell size={16} aria-hidden="true" className="ut-hide-sm text-[#7A7366]" />
            <span className="ut-avatar" aria-hidden="true">AL</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

function LogoGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#2A251E" />
      <circle cx="17" cy="17" r="7" fill="#F4EFE4" />
      <path d="M17 31v6a8 8 0 0 0 8 8h6" fill="none" stroke="#F4EFE4" strokeWidth="6" strokeLinecap="round" transform="translate(0 -6)" />
      <rect x="29" y="31" width="9" height="9" rx="2.5" fill="#C9A06A" />
    </svg>
  )
}

export type PhoneStep = { label: string; note?: string; colour: string; icon: ReactNode; state: "done" | "current" | "idle" | "plain"; delay: number }

/** Phones: a workflow as a vertical list of steps (the canvas is too wide to read at 390px). */
export function PhoneFlow({ steps, pin }: { steps: PhoneStep[]; pin?: string }) {
  return (
    <ol className="ut-phoneflow sm:hidden" aria-hidden="true">
      {steps.map((step, index) => (
        <li key={step.label} className={`ut-t ut-a-left ut-pf-step is-${step.state}`} style={at(step.delay)}>
          <span className="ut-pf-icon" style={vars({ background: step.colour })}>{step.icon}</span>
          <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{step.label}</b>{step.note && <span className="ut-sub block truncate">{step.note}</span>}</span>
          {step.state === "done" && <span className="ut-chip ut-chip-green">Done</span>}
          {step.state === "current" && <span className="ut-chip ut-chip-amber">{pin ?? "Now"}</span>}
          {index < steps.length - 1 && <i className="ut-pf-line" />}
        </li>
      ))}
    </ol>
  )
}
