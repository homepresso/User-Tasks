"use client"

import { useEffect } from "react"

/**
 * Scroll reveals for every `[data-reveal]` element on a public page. Content
 * is visible in the server HTML; only once this runs does the root get
 * `mkt-reveal-armed` (which hides what is still below the fold) and an
 * IntersectionObserver fades each element in as it arrives. Elements already
 * on screen are shown at once, so nothing above the fold flickers. Under
 * prefers-reduced-motion nothing is armed. Renders nothing.
 */
export function RevealRoot() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    const root = document.documentElement
    const seen = new WeakSet<Element>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add("is-in")
        observer.unobserve(entry.target)
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 })

    const scan = () => {
      const viewport = window.innerHeight
      document.querySelectorAll("[data-reveal]").forEach((element) => {
        if (seen.has(element)) return
        seen.add(element)
        // Stagger siblings that arrive together.
        const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((child) => child.hasAttribute("data-reveal")) : []
        const index = siblings.indexOf(element)
        if (index > 0) (element as HTMLElement).style.setProperty("--reveal-delay", `${Math.min(index, 6) * 70}ms`)
        if (element.getBoundingClientRect().top < viewport) element.classList.add("is-in")
        else observer.observe(element)
      })
    }
    scan()
    root.classList.add("mkt-reveal-armed")
    // Content that mounts later (lazy demos, client navigation) is picked up too.
    const mutations = new MutationObserver(() => scan())
    mutations.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); mutations.disconnect(); root.classList.remove("mkt-reveal-armed") }
  }, [])
  return null
}
