/**
 * Which models read a PDF themselves (client-safe, pure): a capability map
 * like lib/agents/reasoning.ts. Only models known to take a PDF in a chat
 * message count; anything else (an unknown model, a gateway, a provider
 * whose OpenAI-compatible endpoint doesn't document PDF input) is
 * unsupported and gets the fallbacks (extracted text, page images, OCR).
 *
 *   provider            part sent                               models                         pages
 *   anthropic (native)  Messages `document` block (base64 PDF)  Claude 3.5+ / 4.x / 5.x,      600 (1M-context models),
 *                       — text and scanned pages are read       Fable, Mythos                  100 (200k-context models)
 *   openai              Chat Completions `file` part            gpt-4o*, gpt-4.1*, gpt-4.5,    100
 *                       { filename, file_data: data URL }       gpt-5*, o1, o3, o4-mini
 *                                                               (not *-mini reasoning o1/o3,
 *                                                               not gpt-3.5 / audio models)
 *   everything else     — (Gemini's OpenAI-compatible endpoint documents images and audio only;
 *                       Azure, xAI, Mistral, Bedrock compatibility: not documented)
 *
 * Sources: the claude-api skill (document blocks: 32 MB request, 600 pages,
 * 100 for 200k-context models), developers.openai.com "File inputs" (Chat
 * Completions takes PDFs as `file` parts, file_data base64; 50 MB per
 * request; vision models gpt-4o and later), aistudio.google.com OpenAI
 * compatibility guide (no PDF part). Claude's document block is only sent
 * over the native Messages API (lib/agents/anthropic-messages.ts): the
 * OpenAI-compatible endpoint, gateways and proxies get the fallbacks.
 */
import type { AgentProviderKind } from './provider'

export interface PdfInputSupport {
  /** Most pages one PDF may have to be sent whole. */
  maxPages: number
  /** Only over Anthropic's native Messages API (not the compatibility endpoint / a gateway). */
  nativeOnly?: boolean
}

/** The app's own cap on a PDF sent to a model as a file (raw bytes; base64 adds a third — well inside Anthropic's 32 MB and OpenAI's 50 MB request limits). */
export const NATIVE_PDF_MAX_BYTES = 20 * 1024 * 1024

const id = (model: string) => String(model ?? '').trim().toLowerCase()
  .replace(/^models\//, '')
  .replace(/^(?:global\.|us\.|eu\.|au\.|jp\.|apac\.)?anthropic\./, '')

/** Does this provider + model read PDFs (null: no — use the fallbacks)? */
export function pdfInputSupport(provider: AgentProviderKind | string, model: string): PdfInputSupport | null {
  const m = id(model)
  if (!m) return null
  switch (provider) {
    case 'anthropic': {
      // 1M-context models: 600 pages per request.
      if (/claude-(fable|mythos)(-|$)/.test(m) || /claude-(opus|sonnet|haiku)-([5-9])(\b|-|$)/.test(m) || /claude-(opus-4-[6-9]|sonnet-4-6)/.test(m)) return { maxPages: 600, nativeOnly: true }
      // 200k-context models: 100 pages.
      if (/claude-(opus|sonnet|haiku)-4(\b|-|$)/.test(m) || /claude-3-(5|7)-(sonnet|haiku)/.test(m)) return { maxPages: 100, nativeOnly: true }
      return null
    }
    case 'openai': {
      if (/(audio|realtime|search|transcribe|tts)/.test(m)) return null
      if (/^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5)/.test(m)) return { maxPages: 100 }
      if (/^(o1|o3)(?!-mini)(\b|-|$)/.test(m) || /^o4(\b|-|$)/.test(m)) return { maxPages: 100 }
      return null
    }
    default:
      return null
  }
}

/** Send PDFs to this model as files? `native`: the request goes to Anthropic's native Messages API. */
export function supportsPdfInput(provider: AgentProviderKind | string, model: string, opts: { native?: boolean } = {}): boolean {
  const s = pdfInputSupport(provider, model)
  if (!s) return false
  return s.nativeOnly ? opts.native === true : true
}
