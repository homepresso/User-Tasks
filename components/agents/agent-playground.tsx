'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Loader2, Bot, User, Wrench, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant' | 'tool_call' | 'error'
  content: string
  toolName?: string
  timestamp: string
}

interface AgentPlaygroundProps {
  agentId: string
  agentName: string
}

export function AgentPlayground({ agentId, agentName }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const msg = input.trim()
    if (!msg || running) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }])
    setRunning(true)

    try {
      const resp = await fetch('/api/agents/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, message: msg }),
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
            } else if (event.type === 'done' && event.result) {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: event.result.response,
                timestamp: new Date().toISOString(),
              }])
            } else if (event.type === 'error') {
              setMessages(prev => [...prev, {
                role: 'error',
                content: event.error ?? 'Unknown error',
                timestamp: new Date().toISOString(),
              }])
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'error', content: err.message ?? 'Network error', timestamp: new Date().toISOString() }])
    }
    setRunning(false)
    inputRef.current?.focus()
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
        <Bot size={14} style={{ color: 'var(--theme-primary-text)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>Playground — {agentName}</span>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="ml-auto text-[9px] font-medium hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-80 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot size={24} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)', opacity: 0.3 }} />
            <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Send a message to test your agent</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'user' && 'justify-end')}>
            {msg.role !== 'user' && (
              <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{
                backgroundColor: msg.role === 'error' ? '#FEE2E2' : msg.role === 'tool_call' ? 'var(--theme-surface)' : 'var(--theme-primary-light)',
                color: msg.role === 'error' ? '#DC2626' : msg.role === 'tool_call' ? 'var(--theme-muted-text)' : 'var(--theme-primary-text)',
              }}>
                {msg.role === 'error' ? <AlertCircle size={12} /> : msg.role === 'tool_call' ? <Wrench size={10} /> : <Bot size={12} />}
              </div>
            )}
            <div className={cn('rounded-lg px-3 py-2 text-xs max-w-[80%]', msg.role === 'user' && 'ml-auto')}
              style={{
                backgroundColor: msg.role === 'user' ? 'var(--theme-primary)' : msg.role === 'error' ? '#FEF2F2' : msg.role === 'tool_call' ? 'var(--theme-surface)' : 'var(--theme-card-bg)',
                color: msg.role === 'user' ? 'var(--theme-on-primary)' : msg.role === 'error' ? '#DC2626' : msg.role === 'tool_call' ? 'var(--theme-muted-text)' : 'var(--theme-card-text)',
                border: msg.role === 'assistant' ? '1px solid var(--theme-surface-border)' : undefined,
              }}>
              {msg.role === 'tool_call' && <span className="text-[9px] font-mono">{msg.content}</span>}
              {msg.role !== 'tool_call' && <span className="whitespace-pre-wrap">{msg.content}</span>}
            </div>
            {msg.role === 'user' && (
              <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                <User size={12} />
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
              <Loader2 size={12} className="animate-spin" />
            </div>
            <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 p-3 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Type a message..."
          disabled={running}
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        />
        <Button size="sm" onClick={handleSend} disabled={!input.trim() || running}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
    </div>
  )
}
