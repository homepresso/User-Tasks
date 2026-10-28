"use client"

import { useLayoutEffect, useState, type RefObject } from "react"
import type { SizeMap } from "@/lib/workflow-edge-routing"

function sameSizes(a: SizeMap, b: SizeMap): boolean {
  const ak = Object.keys(a), bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    const x = a[k], y = b[k]
    if (!x || !y || x.width !== y.width || x.height !== y.height) return false
  }
  return true
}

/**
 * Layout sizes (unscaled offsetWidth/offsetHeight) of every `[data-node-id]`
 * element inside `ref`, kept current with a ResizeObserver so connector
 * anchors follow cards whose content grows or shrinks. `key` should change
 * when nodes are added/removed so new elements are observed.
 */
export function useNodeSizes(ref: RefObject<HTMLElement | null>, key: string): SizeMap {
  const [sizes, setSizes] = useState<SizeMap>({})
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const next: SizeMap = {}
      root.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
        const id = el.dataset.nodeId
        if (id) next[id] = { width: el.offsetWidth, height: el.offsetHeight }
      })
      setSizes((prev) => (sameSizes(prev, next) ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    root.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [ref, key])
  return sizes
}
