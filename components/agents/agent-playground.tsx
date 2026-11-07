'use client'

import { useState, useRef, useEffect } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Send, Loader2, Bot, User, Wrench, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatCost } from '@/lib/agents/pricing'

interface Message {
  role: 'user' | 'assistant' | 'tool_call' | 'error' | 'info'
  content: string
  toolName?: string
  timestamp: string
  runId?: string | null
  meta?: string
  outputs?: Record<string, unknown> | null
}

interface AgentPlaygroundProps {
  agentId: string
  agentName: string
  /** The designer has unsaved changes (the console runs the saved agent). */
  dirty?: boolean
}

/**
 * Test console: a multi-turn conversation with the SAVED agent (earlier
 * turns are sent as history), streaming tool calls; shows outputs, tokens
 * and a link to the run's trace.
 */
export function AgentPlayground({ agentId, agentName, dirty = false }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  // Synchronous guard: a double Enter / click in one frame would send the message twice.
  const sendGuard = useSubmitGuard()
  /** The reply being streamed (current model call). */
  const [live, setLive] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, live])

  async function handleSend() {
    await sendGuard.run(async () => {
      const msg = input.trim()
      if (!msg || running) return
      setInput('')
      setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }])
      setRunning(true)
      setLive('')
      const abort = new AbortController()
      abortRef.current = abort
      // Text streamed by the current model call; a call that ends in tool calls keeps it as an interim note.
      let liveText = ''
      let liveIteration: number | undefined
      const settleLive = (keep: boolean) => {
        if (keep && liveText.trim()) {
          const text = liveText
          setMessages(prev => [...prev, { role: 'info', content: text, timestamp: new Date().toISOString() }])
        }
        liveText = ''
        setLive('')
      }

      try {
        const resp = await fetch('/api/agents/execute', {
          method: 'POST',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            agent_id: agentId, message: msg,
            history: messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
          }),
        })

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Request failed' }))
          setMessages(prev => [...prev, { role: 'error', content: err.error ?? 'Failed to run agent', timestamp: new Date().toISOString() }])
          setRunning(false)
          return
        }

        // Read SSE stream
        const reader = resp.body?.getReader()
        const decoder = new TextDecoder()
        if (!reader) { setRunning(false); return }

        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))

              if (event.type === 'delta' && typeof event.text === 'string') {
                if (event.iteration !== liveIteration) { settleLive(true); liveIteration = event.iteration }
                liveText += event.text
                setLive(liveText)
                continue
              }
              if (event.type === 'delta_reset') { liveText = ''; setLive(''); continue }
              if (event.type === 'tool_call_delta') continue
              if (event.type === 'tool_call' || event.type === 'approval_required') settleLive(true)

              if (event.type === 'tool_call' && event.toolCall) {
                setMessages(prev => [...prev, {
                  role: 'tool_call',
                  content: `Calling ${event.toolCall.toolName}(${JSON.stringify(event.toolCall.arguments)})`,
                  toolName: event.toolCall.toolName,
                  timestamp: new Date().toISOString(),
                }])
              } else if (event.type === 'tool_result' && event.toolCall) {
                setMessages(prev => [...prev, {
                  role: 'tool_call',
                  content: `${event.toolCall.toolName} → ${JSON.stringify(event.toolCall.result).slice(0, 200)}`,
                  toolName: event.toolCall.toolName,
                  timestamp: new Date().toISOString(),
                }])
              } else if (event.type === 'retry' && event.message) {
                setMessages(prev => [...prev, { role: 'info', content: event.message, timestamp: new Date().toISOString() }])
              } else if (event.type === 'done' && event.result) {
                const r = event.result
                settleLive(false)
                const cost = r.cost?.cost_status === 'priced' ? formatCost(Number(r.cost.cost_amount), r.cost.cost_currency) : r.cost ? 'cost unknown' : null
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: r.response,
                  timestamp: new Date().toISOString(),
                  runId: event.run_id ?? null,
                  outputs: r.outputs ?? null,
                  meta: `${r.usage?.total_tokens ?? 0} tokens${cost ? ` · ${cost}` : ''} · ${r.iterations} iteration${r.iterations === 1 ? '' : 's'} · ${((r.duration_ms ?? 0) / 1000).toFixed(1)}s${r.streamed ? ' · streamed' : ''}${r.parse_warning ? ` · ${r.parse_warning}` : ''}`,
                }])
              } else if (event.type === 'awaiting_approval') {
                setMessages(prev => [...prev, {
                  role: 'info',
                  content: `Waiting for approval to run ${event.pending?.tool ?? 'a tool'} — a task was created for the reviewer. The run continues when it is approved or rejected.`,
                  timestamp: new Date().toISOString(),
                  runId: event.run_id ?? null,
                }])
              } else if (event.type === 'error') {
                settleLive(true)
                setMessages(prev => [...prev, {
                  role: 'error',
                  content: event.error ?? 'Unknown error',
                  timestamp: new Date().toISOString(),
                  runId: event.run_id ?? null,
                }])
              }
            } catch {}
          }
        }
      } catch (err: any) {
        settleLive(true)
        if (err?.name === 'AbortError') setMessages(prev => [...prev, { role: 'info', content: 'Stopped — the run was cancelled.', timestamp: new Date().toISOString() }])
        else setMessages(prev => [...prev, { role: 'error', content: err.message ?? 'Network error', timestamp: new Date().toISOString() }])
      }
      abortRef.current = null
      setLive('')
      setRunning(false)
      inputRef.current?.focus()
    })
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <Bot size={16} className="shrink-0 text-primary-text" aria-hidden="true" />
        <span className="min-w-0 truncate text-ui font-semibold text-fg">Playground — {agentName}</span>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setMessages([])} className="ml-auto">Clear</Button>
        )}
      </div>

      {dirty && (
        <div className="border-b border-border-subtle bg-warning-wash px-4 py-1.5 text-xs text-fg">
          Unsaved changes — the console runs the saved agent. Save first to test them.
        </div>
      )}
      {/* Messages */}
      <div ref={scrollRef} className="h-80 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <EmptyState size="sm" icon={Bot} title="Send a message to test your agent" />
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'user' && 'justify-end')}>
            {msg.role !== 'user' && (
              <div className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                msg.role === 'error' ? 'bg-danger-wash text-danger' : msg.role === 'tool_call' ? 'bg-subtle text-fg-muted' : 'bg-primary-wash text-primary-text',
              )}>
                {msg.role === 'error' ? <AlertCircle size={14} /> : msg.role === 'tool_call' ? <Wrench size={12} /> : <Bot size={14} />}
              </div>
            )}
            <div className={cn(
              'max-w-[80%] rounded-lg px-3 py-2 text-ui',
              msg.role === 'user' && 'ml-auto bg-primary text-primary-fg',
              msg.role === 'assistant' && 'border border-border bg-panel text-fg',
              msg.role === 'tool_call' && 'bg-subtle text-fg-muted',
              msg.role === 'error' && 'bg-danger-wash text-danger',
              msg.role === 'info' && 'bg-subtle text-fg',
            )}>
              {msg.role === 'tool_call' && <span className="break-all font-mono text-2xs">{msg.content}</span>}
              {msg.role !== 'tool_call' && <span className="whitespace-pre-wrap">{msg.content}</span>}
              {msg.outputs && Object.keys(msg.outputs).length > 0 && (
                <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-subtle px-2 py-1 font-mono text-2xs text-fg" data-testid="playground-outputs">{JSON.stringify(msg.outputs, null, 2)}</pre>
              )}
              {(msg.meta || msg.runId) && (
                <div className={cn('num mt-1 flex flex-wrap gap-x-2 text-2xs', msg.role === 'user' ? 'text-primary-fg' : 'text-fg-muted')}>
                  {msg.meta && <span>{msg.meta}</span>}
                  {msg.runId && <Link href={`/agents/${agentId}/runs/${msg.runId}`} className="underline hover:text-fg">View trace</Link>}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle text-fg-muted">
                <User size={14} />
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="flex gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-wash text-primary-text">
              <Loader2 size={14} className="animate-spin" />
            </div>
            {live ? (
              <div className="max-w-[80%] whitespace-pre-wrap rounded-lg border border-border bg-panel px-3 py-2 text-ui text-fg" data-testid="playground-streaming" aria-live="polite">
                {live}<span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-primary align-middle" />
              </div>
            ) : (
              <div className="rounded-lg bg-subtle px-3 py-2 text-ui text-fg-muted">
                Thinking…
              </div>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => abortRef.current?.abort()} className="self-start">Stop</Button>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 border-t border-border-subtle p-3">
        <Input
          ref={inputRef}
          aria-label="Message"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type a message…"
          disabled={running}
          className="flex-1"
        />
        <IconButton variant="primary" label="Send" onClick={handleSend} disabled={!input.trim() || running} loading={running} icon={<Send />} />
      </div>
    </Card>
  )
}
