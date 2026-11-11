"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUp, Check, Eye, FileText, Sparkles, Workflow, Database, ShieldCheck } from "lucide-react"
import { at, Stream } from "./demo-kit"
import "./demo.css"

/**
 * The homepage Agent spotlight: a scripted Agent panel the visitor drives
 * with suggestion chips. Replies stream in; anything that would change data
 * arrives as a card the visitor applies or confirms (as in the product: the
 * Agent proposes, people decide). No network requests.
 */

type Reply = { text: string; card?: (props: { onConfirm: () => void; confirmed: boolean }) => ReactNode; after?: string }

const PROMPTS: Array<{ ask: string; reply: Reply }> = [
  {
    ask: "Summarise this request",
    reply: {
      text: "Sam wants a MacBook Pro and a USB-C dock for a new designer: $4,200 in total, quote attached. The budget check passed and Priya approved it yesterday. It is now waiting on Finance, which is you, and it is due on Wednesday.",
    },
  },
  {
    ask: "Draft a comment asking for a second quote",
    reply: {
      text: "Here is a draft. I have not posted anything.",
      card: ({ onConfirm, confirmed }) => (
        <ProposalCard title="Comment · draft" icon={<FileText size={13} />} action={confirmed ? "Added to the comment box" : "Apply"} confirmed={confirmed} onConfirm={onConfirm}>
          “Thanks Sam. Before I approve, could you add a second quote? Our policy asks for two above $2,000.”
        </ProposalCard>
      ),
      after: "Done: the draft is in the comment box. Edit it, then post it yourself.",
    },
  },
  {
    ask: "Approve it for me",
    reply: {
      text: "I can do that. Amounts over $2,000 need a comment, so I filled one in. Please confirm:",
      card: ({ onConfirm, confirmed }) => (
        <ProposalCard title="Approve PUR-1042" icon={<ShieldCheck size={13} />} action={confirmed ? "Approved" : "Confirm and approve"} confirmed={confirmed} onConfirm={onConfirm}>
          <span className="block">Outcome: <b>Approve</b></span>
          <span className="block">Comment: “Approved. Charge to Design capex.”</span>
        </ProposalCard>
      ),
      after: "Approved. PO-2291 is being created and Sam will get an email. It is in the timeline as approved by you, with my help.",
    },
  },
  {
    ask: "Build a leave request process",
    reply: {
      text: "From that I plan a table, two forms and a workflow. Nothing is created until you say so.",
      card: ({ onConfirm, confirmed }) => (
        <ProposalCard title="Build plan · Leave requests" icon={<Sparkles size={13} />} action={confirmed ? "Built as drafts" : "Build all"} confirmed={confirmed} onConfirm={onConfirm}>
          <span className="flex items-center gap-2"><Database size={12} /> Data table · Leave records</span>
          <span className="flex items-center gap-2"><FileText size={12} /> Form · Leave request</span>
          <span className="flex items-center gap-2"><FileText size={12} /> Form · Leave approval</span>
          <span className="flex items-center gap-2"><Workflow size={12} /> Workflow · Request → manager → HR records</span>
        </ProposalCard>
      ),
      after: "All four are built. The workflow is an inactive draft: open it to review, then publish.",
    },
  },
]

function ProposalCard({ title, icon, action, confirmed, onConfirm, children }: { title: string; icon: ReactNode; action: string; confirmed: boolean; onConfirm: () => void; children: ReactNode }) {
  return (
    <div className="ut-plan ut-t ut-a-in mt-2" style={at(0.2)}>
      <div className="ut-plan-head"><span className="flex items-center gap-2">{icon}{title}</span></div>
      <div className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px] text-[#4A463E]">{children}</div>
      <div className="flex justify-end gap-2 border-t border-[#E8E2D6] p-2.5">
        {!confirmed && <span className="ut-btn">Discard</span>}
        <button type="button" onClick={onConfirm} disabled={confirmed} className={`ut-btn ${confirmed ? "ut-btn-go" : "ut-btn-dark"} cursor-pointer disabled:cursor-default`}>
          {confirmed && <Check size={13} strokeWidth={3} aria-hidden="true" />}{action}
        </button>
      </div>
    </div>
  )
}

type Turn = { id: number; prompt: number; confirmed: boolean }

export default function AgentChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const body = useRef<HTMLDivElement>(null)
  const next = useRef(1)

  useEffect(() => {
    const element = body.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  }, [turns])

  const ask = (prompt: number) => setTurns((current) => [...current.slice(-2), { id: next.current++, prompt, confirmed: false }])
  const confirm = (id: number) => setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, confirmed: true } : turn)))

  return (
    <div className="ut-demo">
      <div className="ut-window flex h-[520px] flex-col bg-[#fff]">
        <div className="ut-agent-head">
          <span className="ut-agent-mark"><Sparkles size={15} aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-[13px] font-semibold">Agent</p><p className="ut-sub flex items-center gap-1 truncate"><Eye size={11} aria-hidden="true" /> Looking at: Approve purchase: MacBook Pro</p></div>
          <span className="ut-chip ut-chip-grey ml-auto before:!hidden">Your model</span>
        </div>
        <div ref={body} className="ut-agent-body !justify-start overflow-y-auto" aria-live="polite">
          {turns.length === 0 && (
            <div className="m-auto max-w-xs text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F3C77F] to-[#8B7CF6] text-white"><Sparkles size={22} aria-hidden="true" /></span>
              <p className="mt-3 text-[15px] font-semibold">Ask about this task</p>
              <p className="ut-sub mt-1">The Agent sees the screen you are on and works within your permissions. Pick a question below.</p>
            </div>
          )}
          {turns.map((turn) => {
            const { ask: question, reply } = PROMPTS[turn.prompt]
            return (
              <div key={turn.id} className="flex flex-col gap-2">
                <div className="ut-msg-me ut-t ut-a-in">{question}</div>
                <div className="ut-t ut-a-hide flex gap-1 pl-1" style={at(0.7)} aria-hidden="true"><i className="ut-dot" /><i className="ut-dot" style={{ animationDelay: "0.15s" }} /><i className="ut-dot" style={{ animationDelay: "0.3s" }} /></div>
                <p className="ut-msg-ai"><Stream text={reply.text} delay={0.7} speed={0.035} /></p>
                {reply.card && <div className="ut-t ut-a-in" style={at(0.9 + reply.text.split(" ").length * 0.035)}>{reply.card({ onConfirm: () => confirm(turn.id), confirmed: turn.confirmed })}</div>}
                {turn.confirmed && reply.after && <p className="ut-msg-ai"><Stream text={reply.after} delay={0.1} speed={0.035} /></p>}
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-2">
          {PROMPTS.map((prompt, index) => (
            <button key={prompt.ask} type="button" onClick={() => ask(index)} className="rounded-full border border-[#E8E2D6] bg-[#FBF9F4] px-3 py-1.5 text-[12px] font-medium text-[#33302A] transition-colors hover:border-[#B08A54] hover:bg-[#FFF6E6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8B266]">
              {prompt.ask}
            </button>
          ))}
        </div>
        <div className="ut-composer" aria-hidden="true">
          <span className="flex-1 text-[#9A9282]">Ask the Agent…</span>
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#1B1916] text-white"><ArrowUp size={14} /></span>
        </div>
      </div>
    </div>
  )
}
