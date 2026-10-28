"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Play, RefreshCw, Check, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"

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
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: result.error ? 'var(--theme-danger)' : 'var(--theme-success)' }}>
          {result.error ? <AlertCircle size={12} /> : <Check size={12} />}
          {result.error ? result.error : `${result.count} processed`}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => router.refresh()}
      >
        <RefreshCw size={14} className="mr-1" /> Refresh
      </Button>
      <Button size="sm" onClick={processQueue} disabled={processing}>
        <Play size={14} className="mr-1" />
        {processing ? "Processing..." : "Process Now"}
      </Button>
    </div>
  )
}
