"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Play, RefreshCw, Check, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { formatCount } from "@/lib/format/number"

export function QueueActions() {
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ count: number; error?: string } | null>(null)
  const router = useRouter()

  async function processQueue() {
    setProcessing(true)
    setResult(null)
    try {
      const resp = await fetch("/api/workflows/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_size: 20 }),
      })
      const data = await resp.json()
      setResult({ count: data.processed ?? 0 })
    } catch (e: any) {
      setResult({ count: 0, error: e.message })
    }
    setProcessing(false)
    router.refresh()
    setTimeout(() => setResult(null), 4000)
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span role="status" className={`flex items-center gap-1 text-xs font-medium ${result.error ? "text-danger" : "text-success"}`}>
          {result.error ? <AlertCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          {result.error ? result.error : `${formatCount(result.count)} processed`}
        </span>
      )}
      <Button
        variant="secondary"
        leadingIcon={<RefreshCw />}
        onClick={() => router.refresh()}
      >
        Refresh
      </Button>
      <Button onClick={processQueue} disabled={processing} loading={processing} leadingIcon={processing ? undefined : <Play />}>
        {processing ? "Processing…" : "Process now"}
      </Button>
    </div>
  )
}
