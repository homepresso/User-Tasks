"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import type { SceneProps } from "./demo-kit"
import { ApproveScene, InboxScene, ProcessScene, TaskScene, TimelineScene } from "./scenes-work"
import { AgentScene, BuildScene, CanvasScene, DeployScene, FormDesignerScene } from "./scenes-build"
import { CliScene, ReportScene, TableScene } from "./scenes-extra"
import "./demo.css"

export type SceneId = "inbox" | "task" | "process" | "timeline" | "approve" | "agent" | "build" | "form" | "canvas" | "deploy" | "table" | "report" | "cli"

type SceneDef = {
  Component: ComponentType<SceneProps>
  /** Short tab label. */
  title: string
  /** What the step shows, read as "Step n of m: …". */
  caption: string
  /** Seconds before auto-advancing. */
  duration: number
  /** The visitor's click finishes this step in place (its payoff is on the same screen) instead of moving on. */
  finishOnAct?: boolean
}

export const SCENES: Record<SceneId, SceneDef> = {
  inbox: { Component: InboxScene, title: "Task list", caption: "a purchase request lands in Ada’s task list", duration: 5.4 },
  task: { Component: TaskScene, title: "Open it", caption: "she opens it: the request, its line items and the quote, on one form", duration: 6.2 },
  process: { Component: ProcessScene, title: "Process", caption: "the process view shows the path so far, and that it is waiting on her", duration: 6 },
  timeline: { Component: TimelineScene, title: "Timeline", caption: "the timeline: submitted, checked against budget, approved by her manager", duration: 5.4 },
  approve: { Component: ApproveScene, title: "Approve", caption: "she comments and approves; the purchase order is raised and Sam is told", duration: 8, finishOnAct: true },
  agent: { Component: AgentScene, title: "Ask the Agent", caption: "describe the process; the Agent plans the table, forms, workflow and report", duration: 9 },
  build: { Component: BuildScene, title: "Build all", caption: "Build all: each item is created and checked, saved as drafts you review", duration: 6.6 },
  form: { Component: FormDesignerScene, title: "Form", caption: "the request form, with a List of line items and a total that adds itself up", duration: 7.2, finishOnAct: true },
  canvas: { Component: CanvasScene, title: "Workflow", caption: "the approval workflow: budget rules, people, a branch by amount and the order", duration: 6.8 },
  deploy: { Component: DeployScene, title: "Deploy", caption: "everything checks out; publish it and the form link is live", duration: 6.4, finishOnAct: true },
  table: { Component: TableScene, title: "Data", caption: "every request is a row in a data table, filtered and grouped, with an OData feed", duration: 5.6, finishOnAct: true },
  report: { Component: ReportScene, title: "Report", caption: "a saved report with charts over the same rows, always current", duration: 6, finishOnAct: true },
  cli: { Component: CliScene, title: "CLI", caption: "the same workflow, created, published and watched from the terminal", duration: 9.5, finishOnAct: true },
}

/** prefers-reduced-motion, live (false on the server). */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)"
function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false)
}

/**
 * Plays a list of scenes as an auto-advancing, interruptible story.
 *
 * - Auto-advances while idle; hovering or focusing the demo holds the current
 *   step (its animation finishes, it just doesn't move on).
 * - Fully paused while off screen (IntersectionObserver), in a hidden tab or
 *   when the visitor presses pause: CSS animations stop where they are.
 * - Every scene has a real button target (the highlighted row, tab or
 *   button): clicking it moves on, or completes the step's payoff now.
 * - Reduced motion: no autoplay, each step shown as its final frame, with
 *   the step buttons to move between them.
 * - Captions: "Step 3 of 5: …", announced politely once the visitor interacts.
 */
export function DemoStage({ scenes, label, onFinish, heightClass = "h-[440px] sm:h-[520px] lg:h-[560px]", startAt = 0 }: {
  scenes: SceneId[]
  label: string
  /** Called after the last step instead of looping (the homepage switches modes). */
  onFinish?: () => void
  heightClass?: string
  startAt?: number
}) {
  const [index, setIndex] = useState(startAt)
  const [run, setRun] = useState(0)
  const [ff, setFf] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const [focused, setFocused] = useState(false)
  const [offscreen, setOffscreen] = useState(false)
  const [hiddenTab, setHiddenTab] = useState(false)
  const [interacted, setInteracted] = useState(false)
  const reduced = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const elapsed = useRef(0)

  const scene = SCENES[scenes[index]]
  const frozen = userPaused || offscreen || hiddenTab
  const advancing = !frozen && !held && !focused && !reduced

  const go = useCallback((next: number, fromUser = false) => {
    if (fromUser) setInteracted(true)
    if (next >= scenes.length && onFinish && !fromUser) { onFinish(); return }
    setIndex(((next % scenes.length) + scenes.length) % scenes.length)
    setRun((value) => value + 1)
    setFf(false)
    elapsed.current = 0
  }, [scenes.length, onFinish])

  // Off screen and hidden tabs freeze everything.
  useEffect(() => {
    const element = root.current
    if (!element || !("IntersectionObserver" in window)) return
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting), { threshold: 0.15 })
    observer.observe(element)
    const onVisibility = () => setHiddenTab(document.visibilityState === "hidden")
    document.addEventListener("visibilitychange", onVisibility)
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility) }
  }, [])

  // The step clock: one rAF loop, no re-renders (the progress bar is written directly).
  useEffect(() => {
    if (!advancing) return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      elapsed.current += (now - last) / 1000
      last = now
      const progress = Math.min(1, elapsed.current / scene.duration)
      if (bar.current) bar.current.style.transform = `scaleX(${progress})`
      if (progress >= 1) { go(index + 1); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [advancing, index, run, scene.duration, go])

  useEffect(() => { if (bar.current) bar.current.style.transform = `scaleX(${reduced ? 1 : elapsed.current / scene.duration})` }, [index, run, reduced, scene.duration])

  const onAct = () => {
    setInteracted(true)
    if (scene.finishOnAct && !ff) {
      setFf(true)
      elapsed.current = Math.max(elapsed.current, scene.duration - 2.6)
    } else {
      go(index + 1, true)
    }
  }

  const Scene = scene.Component

  return (
    <div
      ref={root}
      role="group"
      aria-roledescription="interactive demo"
      aria-label={label}
      className="ut-demo"
      data-paused={frozen ? "true" : "false"}
      data-ff={ff || reduced ? "true" : "false"}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHeld(true) }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setHeld(false) }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}
    >
      <div className={`relative ${heightClass}`}>
        <div key={`${index}-${run}`} className="ut-scene">
          <Scene onAct={onAct} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <p className="min-h-[2.75rem] text-center text-[14px] leading-snug text-[color:var(--demo-caption,#C9BFAE)] sm:min-h-0" aria-live={interacted ? "polite" : "off"}>
          <span className="font-semibold text-[color:var(--demo-caption-strong,#F4EFE4)]">Step {index + 1} of {scenes.length}:</span> {scene.caption}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(index - 1, true)} className="ut-demo-ctl" aria-label="Previous step"><ChevronLeft size={16} aria-hidden="true" /></button>
          <ol className="flex flex-1 gap-1.5" aria-label="Steps">
            {scenes.map((id, position) => (
              <li key={id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => go(position, true)}
                  aria-current={position === index ? "step" : undefined}
                  aria-label={`Step ${position + 1}: ${SCENES[id].title}`}
                  className={`ut-demo-step group w-full text-left ${position === index ? "is-on" : ""} ${position < index ? "is-past" : ""}`}
                >
                  <span className="ut-demo-track"><span ref={position === index ? bar : undefined} className="ut-demo-fill" /></span>
                  <span className="ut-demo-step-label hidden truncate sm:block">{position + 1}. {SCENES[id].title}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => go(index + 1, true)} className="ut-demo-ctl" aria-label="Next step"><ChevronRight size={16} aria-hidden="true" /></button>
          {!reduced && (
            <button type="button" onClick={() => { setInteracted(true); setUserPaused((value) => !value) }} className="ut-demo-ctl" aria-label={userPaused ? "Play the demo" : "Pause the demo"} aria-pressed={userPaused}>
              {userPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
