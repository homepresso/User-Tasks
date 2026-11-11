"use client"

import { useEffect, useRef, useState } from "react"
import { Hammer, Inbox } from "lucide-react"
import { DemoStage, type SceneId } from "./demo-stage"

const MODES = {
  work: { label: "Get work done", hint: "For the people doing the work", icon: Inbox, scenes: ["inbox", "task", "process", "timeline", "approve"] as SceneId[] },
  build: { label: "Build it", hint: "For the people building the process", icon: Hammer, scenes: ["agent", "build", "form", "canvas", "deploy"] as SceneId[] },
}
type Mode = keyof typeof MODES

/**
 * The homepage hero demo: a big segmented control between "Get work done"
 * (the end-user story) and "Build it" (the designer story). Each mode plays
 * through and hands over to the other. `#demo-build` in the address (the nav's
 * featured card and announcement bar) opens Build mode; `#demo` the default.
 */
export function ProductDemo() {
  const [mode, setMode] = useState<Mode>("work")
  const [key, setKey] = useState(0)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash
      if (hash === "#demo-build" || hash === "#demo") {
        setMode(hash === "#demo-build" ? "build" : "work")
        setKey((value) => value + 1)
        anchor.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      }
    }
    apply()
    window.addEventListener("hashchange", apply)
    return () => window.removeEventListener("hashchange", apply)
  }, [])

  const choose = (next: Mode) => { setMode(next); setKey((value) => value + 1) }

  return (
    <div ref={anchor} id="demo" className="scroll-mt-24">
      <span id="demo-build" className="sr-only" aria-hidden="true" />
      <div className="mx-auto flex justify-center">
        <div role="tablist" aria-label="Demo" className="relative grid grid-cols-2 rounded-2xl border border-white/10 bg-[#fff]/[0.04] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
          <span aria-hidden="true" className="absolute inset-y-1.5 left-1.5 w-[calc(50%-6px)] rounded-xl bg-gradient-to-b from-[#FFF7E8] to-[#F1DFC0] shadow-[0_8px_24px_-8px_rgba(232,178,102,0.6)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: mode === "build" ? "translateX(100%)" : "none" }} />
          {(Object.keys(MODES) as Mode[]).map((id) => {
            const Icon = MODES[id].icon
            const on = mode === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="demo-stage"
                onClick={() => choose(id)}
                className={`relative z-10 flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-left transition-colors duration-300 sm:px-6 sm:py-3 ${on ? "text-[#1B1406]" : "text-[#E9E1D2] hover:text-white"}`}
              >
                <Icon size={18} aria-hidden="true" className="shrink-0" />
                <span>
                  <span className="block text-[15px] font-semibold leading-tight sm:text-base">{MODES[id].label}</span>
                  <span className={`hidden text-xs sm:block ${on ? "text-[#6B5232]" : "text-[#A89E8C]"}`}>{MODES[id].hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div id="demo-stage" role="tabpanel" aria-label={MODES[mode].label} className="mt-8">
        <DemoStage
          key={`${mode}-${key}`}
          scenes={MODES[mode].scenes}
          label={`${MODES[mode].label}: a replica of UserTasks you can click through`}
          onFinish={() => choose(mode === "work" ? "build" : "work")}
        />
      </div>
    </div>
  )
}
