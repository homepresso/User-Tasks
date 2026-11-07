/**
 * Streaming model replies (client-safe, no server-only imports).
 *
 *  - SseParser: Server-Sent Events framing — chunks split anywhere (inside a
 *    line, a UTF-8 character or between \r and \n), multi-line `data:`,
 *    comments / keep-alives, `event:` names.
 *  - ChatStreamAssembler: rebuilds one chat completion from its stream, in
 *    the non-streaming JSON shape the agent loop already reads
 *    ({choices:[{message:{content, tool_calls}, finish_reason}], usage}).
 *    It understands both dialects agents meet:
 *      * OpenAI-compatible chunks (OpenAI, Azure, Anthropic's and Gemini's
 *        OpenAI compatibility, Groq, Together, Mistral, DeepSeek, Ollama,
 *        Perplexity, vLLM, Bedrock's OpenAI endpoint): choices[].delta with
 *        content and tool_calls deltas keyed by `index` (id / name on the
 *        first fragment, arguments in pieces), usage in the last chunk
 *        (stream_options.include_usage), `data: [DONE]`;
 *      * Anthropic Messages events (message_start, content_block_start /
 *        delta / stop with text_delta and input_json_delta, message_delta
 *        with stop_reason and output usage, message_stop), for gateways that
 *        answer in that dialect.
 *    An `error` payload mid-stream becomes a StreamProviderError.
 *  - DeltaCoalescer: batches text deltas for the browser (fewer, larger SSE
 *    events; holds back while the consumer is slow — backpressure).
 */

export class StreamProviderError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message)
    this.name = 'StreamProviderError'
  }
}

export interface SseEvent { event: string | null; data: string }

export class SseParser {
  private buffer = ''
  private dataLines: string[] = []
  private eventName: string | null = null
  private decoder = new TextDecoder()

  /** Feed bytes (or text); returns the events completed by this chunk. */
  push(chunk: Uint8Array | string): SseEvent[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    return this.drain(false)
  }

  /** End of stream: flush a final event without its blank line. */
  end(): SseEvent[] {
    this.buffer += this.decoder.decode()
    return this.drain(true)
  }

  private drain(final: boolean): SseEvent[] {
    const out: SseEvent[] = []
    for (;;) {
      const nl = this.buffer.search(/\r\n|\r|\n/)
      if (nl === -1) break
      // A lone \r at the very end may be the first half of \r\n: wait for more.
      if (this.buffer[nl] === '\r' && nl === this.buffer.length - 1 && !final) break
      const line = this.buffer.slice(0, nl)
      const sepLen = this.buffer.startsWith('\r\n', nl) ? 2 : 1
      this.buffer = this.buffer.slice(nl + sepLen)
      this.line(line, out)
    }
    if (final) {
      if (this.buffer) { this.line(this.buffer, out); this.buffer = '' }
      this.dispatch(out)
    }
    return out
  }

  private line(line: string, out: SseEvent[]) {
    if (line === '') { this.dispatch(out); return }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.dataLines.push(value)
    else if (field === 'event') this.eventName = value
  }

  private dispatch(out: SseEvent[]) {
    if (this.dataLines.length) out.push({ event: this.eventName, data: this.dataLines.join('\n') })
    this.dataLines = []
    this.eventName = null
  }
}

export interface StreamDelta {
  /** Text appended to the reply. */
  text?: string
  /** A tool call being built: index, and id / name once known; arguments arrive in pieces. */
  tool_call?: { index: number; id?: string; name?: string; arguments_delta?: string }
}

interface ToolCallParts { id: string; name: string; arguments: string }

export class ChatStreamAssembler {
  private text = ''
  private tools = new Map<number, ToolCallParts>()
  /** Anthropic content-block index → tool slot. */
  private blockToTool = new Map<number, number>()
  private finishReason: string | null = null
  private usage: Record<string, any> | null = null
  private anthropicInput: Record<string, any> | null = null
  private model: string | null = null
  done = false
  /** Any content (text or tool call) has been emitted. */
  started = false

  /** Feed one SSE event; returns the deltas it carried. Throws StreamProviderError on an error payload. */
  push(event: SseEvent): StreamDelta[] {
    const data = event.data.trim()
    if (!data) return []
    if (data === '[DONE]') { this.done = true; return [] }
    let json: any
    try { json = JSON.parse(data) } catch { return [] }
    if (!json || typeof json !== 'object') return []

    if (json.error || event.event === 'error' || json.type === 'error') {
      const e = json.error ?? json
      const message = typeof e === 'string' ? e : String(e?.message ?? e?.type ?? 'stream error')
      const kind = String(e?.type ?? e?.code ?? '')
      const retryable = /overloaded|rate|timeout|unavailable|server|internal|5\d\d/i.test(`${kind} ${message}`)
      throw new StreamProviderError(`Provider error mid-stream: ${message.slice(0, 300)}`, retryable)
    }
    if (typeof json.type === 'string' && /^(message_|content_block_|ping)/.test(json.type)) return this.anthropic(json)
    return this.openai(json)
  }

  private openai(json: any): StreamDelta[] {
    const out: StreamDelta[] = []
    if (typeof json.model === 'string') this.model = json.model
    if (json.usage && typeof json.usage === 'object') this.usage = json.usage
    const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
    if (!choice) return out
    const delta = choice.delta ?? choice.message ?? {}
    if (typeof delta.content === 'string' && delta.content) {
      this.text += delta.content
      this.started = true
      out.push({ text: delta.content })
    } else if (Array.isArray(delta.content)) {
      for (const part of delta.content) if (part?.type === 'text' && typeof part.text === 'string' && part.text) { this.text += part.text; this.started = true; out.push({ text: part.text }) }
    }
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((tc: any, i: number) => {
        const index = Number.isInteger(tc?.index) ? tc.index : i
        const slot = this.tools.get(index) ?? { id: '', name: '', arguments: '' }
        if (typeof tc?.id === 'string' && tc.id) slot.id = tc.id
        const name = typeof tc?.function?.name === 'string' ? tc.function.name : ''
        // Usually sent once; some servers repeat it on every fragment, a few split it.
        if (name && !slot.name) slot.name = name
        else if (name && name !== slot.name) slot.name += name
        const args = tc?.function?.arguments
        const piece = typeof args === 'string' ? args : args && typeof args === 'object' ? JSON.stringify(args) : ''
        slot.arguments += piece
        this.tools.set(index, slot)
        this.started = true
        out.push({ tool_call: { index, ...(tc?.id ? { id: tc.id } : {}), ...(tc?.function?.name ? { name: tc.function.name } : {}), ...(piece ? { arguments_delta: piece } : {}) } })
      })
    }
    if (choice.finish_reason) this.finishReason = choice.finish_reason
    return out
  }

  private anthropic(json: any): StreamDelta[] {
    const out: StreamDelta[] = []
    switch (json.type) {
      case 'message_start':
        if (json.message?.usage) this.anthropicInput = json.message.usage
        if (typeof json.message?.model === 'string') this.model = json.message.model
        break
      case 'content_block_start': {
        const block = json.content_block ?? {}
        if (block.type === 'tool_use') {
          const index = this.tools.size
          this.blockToTool.set(Number(json.index), index)
          this.tools.set(index, { id: String(block.id ?? ''), name: String(block.name ?? ''), arguments: '' })
          this.started = true
          out.push({ tool_call: { index, id: block.id, name: block.name } })
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          this.text += block.text
          this.started = true
          out.push({ text: block.text })
        }
        break
      }
      case 'content_block_delta': {
        const d = json.delta ?? {}
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          this.text += d.text
          this.started = true
          out.push({ text: d.text })
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          const index = this.blockToTool.get(Number(json.index))
          if (index !== undefined) {
            this.tools.get(index)!.arguments += d.partial_json
            out.push({ tool_call: { index, arguments_delta: d.partial_json } })
          }
        }
        break
      }
      case 'message_delta': {
        const stop = json.delta?.stop_reason
        if (stop) this.finishReason = stop === 'tool_use' ? 'tool_calls' : stop === 'max_tokens' ? 'length' : stop === 'end_turn' || stop === 'stop_sequence' ? 'stop' : String(stop)
        if (json.usage) {
          const input = this.anthropicInput ?? {}
          const prompt = (Number(input.input_tokens) || 0) + (Number(input.cache_read_input_tokens) || 0) + (Number(input.cache_creation_input_tokens) || 0)
          const completion = Number(json.usage.output_tokens) || 0
          this.usage = {
            prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
            ...(Number(input.cache_read_input_tokens) ? { prompt_tokens_details: { cached_tokens: Number(input.cache_read_input_tokens) } } : {}),
          }
        }
        break
      }
      case 'message_stop':
        this.done = true
        break
    }
    return out
  }

  /** The completion in the non-streaming shape (usage undefined when the stream carried none). */
  result(): { choices: Array<{ message: { role: 'assistant'; content: string | null; tool_calls?: any[] }; finish_reason: string | null }>; usage?: Record<string, any>; model?: string } {
    const toolCalls = Array.from(this.tools.entries()).sort((a, b) => a[0] - b[0]).map(([index, t]) => ({
      id: t.id || `call_stream_${index}`, type: 'function' as const, function: { name: t.name, arguments: t.arguments || '{}' },
    })).filter((t) => t.function.name)
    return {
      choices: [{ message: { role: 'assistant', content: this.text || (toolCalls.length ? null : ''), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: this.finishReason ?? (toolCalls.length ? 'tool_calls' : 'stop') }],
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.model ? { model: this.model } : {}),
    }
  }
}

/**
 * Batches text deltas: flushes after `intervalMs` or `maxChars`, and — when
 * `ready()` says the consumer is behind — keeps accumulating instead of
 * enqueueing more (the next flush carries everything). Tool-call deltas and
 * other events pass through `emit` after pending text is flushed.
 */
export class DeltaCoalescer {
  private pending = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private readonly emitText: (text: string) => void,
    private readonly opts: { intervalMs?: number; maxChars?: number; ready?: () => boolean } = {},
  ) {}

  text(piece: string) {
    if (!piece) return
    this.pending += piece
    if (this.pending.length >= (this.opts.maxChars ?? 400) && this.isReady()) { this.flush(); return }
    this.schedule()
  }

  private schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      // A slow consumer: keep accumulating (bounded) and try again later.
      if (this.isReady() || this.pending.length > 64_000) this.flush()
      else if (this.pending) this.schedule()
    }, this.opts.intervalMs ?? 40)
  }

  private isReady() { return this.opts.ready ? this.opts.ready() : true }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.pending) return
    const out = this.pending
    this.pending = ''
    this.emitText(out)
  }

  close() { this.flush() }
}

/**
 * Wraps an agent event sink for an SSE response: text deltas are coalesced
 * (DeltaCoalescer, holding back while `ready()` is false — the browser is
 * reading slower than the model writes), everything else is sent in order
 * after the pending text.
 */
export function coalescedAgentEvents<E extends { type: string; iteration?: number; text?: string }>(send: (event: E) => void, ready?: () => boolean): { onEvent: (event: E) => void; close: () => void } {
  let iteration: number | undefined
  const coalescer = new DeltaCoalescer((text) => send({ type: 'delta', iteration, text } as E), { ready })
  return {
    onEvent: (event: E) => {
      if (event.type === 'delta' && typeof event.text === 'string') {
        if (event.iteration !== iteration) { coalescer.flush(); iteration = event.iteration }
        coalescer.text(event.text)
        return
      }
      coalescer.flush()
      send(event)
    },
    close: () => coalescer.close(),
  }
}
