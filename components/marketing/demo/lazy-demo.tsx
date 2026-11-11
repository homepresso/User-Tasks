"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import type { SceneId } from "./demo-stage"

/**
 * Below-the-fold demos: nothing of their code loads until the slot is about
 * to scroll into view. The slot keeps its height meanwhile (no layout shift).
 */

const AgentChat = dynamic(() => import("./agent-chat"), { ssr: false })
const DemoStage = dynamic(() => import("./demo-stage").then((module) => module.DemoStage), { ssr: false })

function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); observer.disconnect() } }, { rootMargin: "400px 0px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, near }
}

function Placeholder({ height }: { height: string }) {
  return <div aria-hidden="true" className={`${height} animate-pulse rounded-2xl bg-[#fff]/[0.04] ring-1 ring-white/10`} />
}

export function LazyAgentChat() {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  return <div ref={ref}>{near ? <AgentChat /> : <Placeholder height="h-[520px]" />}</div>
}

export function LazyDemoStage({ scenes, label, heightClass = "h-[440px] sm:h-[520px]" }: { scenes: SceneId[]; label: string; heightClass?: string }) {
  const { ref, near } = useNearViewport<HTMLDivElement>()
  return <div ref={ref}>{near ? <DemoStage scenes={scenes} label={label} heightClass={heightClass} /> : <><Placeholder height={heightClass} /><div className="h-[92px]" /></>}</div>
}
