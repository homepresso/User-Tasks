/**
 * The working and error bubbles (components/assistants/agent-status): the
 * working text and Stop, the friendly message with Retry, the admin's
 * Settings link, and Details that show only the sanitised summary — never
 * the provider's raw JSON or a key.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FailureNotice, RetryNote, WorkingBubble, failureDetailRows } from '@/components/assistants/agent-status'
import { describeFailure, failureFromMessage, forViewer } from '@/lib/agents/errors'

const RAW = 'Provider 429: {"error":{"message":"Rate limit exceeded for key sk-live-abcdefghijklmnopqrstu","type":"rate_limit_error","param":null,"code":"rate_limit_exceeded"}} — the provider is rate limiting this key'
const view = describeFailure({ ...failureFromMessage(RAW, 'baseten')!, attempts: 4, requestId: 'req_9' })

describe('FailureNotice', () => {
  it('a member sees the friendly message, Retry and the sanitised Details', () => {
    const shown = forViewer(view, false)
    const html = renderToStaticMarkup(createElement(FailureNotice, { message: shown.message, failure: shown, onRetry: () => {} }))
    expect(html).toContain('The AI provider is busy right now')
    expect(html).toContain('data-testid="assistant-retry"')
    expect(html).toContain('Details')
    expect(html).toContain('HTTP 429')
    expect(html).toContain('rate_limit_exceeded')
    expect(html).toContain('req_9')
    expect(html).toContain('Baseten')
    expect(html).not.toContain('{&quot;error')
    expect(html).not.toContain('&quot;param&quot;')
    expect(html).not.toContain('Rate limit exceeded')
    expect(html).not.toContain('sk-live')
    expect(html).not.toContain('assistant-error-settings')
  })

  it('an admin also sees the provider\'s message (key masked) and, for a fix, the Settings link', () => {
    const shown = forViewer(view, true)
    const html = renderToStaticMarkup(createElement(FailureNotice, { message: shown.message, failure: shown, onRetry: null }))
    expect(html).toContain('Provider message')
    expect(html).toContain('Rate limit exceeded for key [key]')
    expect(html).not.toContain('sk-live')
    expect(html).not.toContain('assistant-retry')
    const auth = forViewer(describeFailure({ kind: 'auth', status: 401, message: 'Provider 401', body: '{}', attempts: 1, provider: 'openai' }), true)
    const authHtml = renderToStaticMarkup(createElement(FailureNotice, { message: auth.message, failure: auth }))
    expect(authHtml).toContain('href="/settings/assistants"')
    expect(authHtml).toContain('Open Settings → Agent')
  })

  it('detail rows: only known, sanitised fields', () => {
    // Retries are quiet for members: the attempt count is for people who manage the Agent.
    expect(failureDetailRows(forViewer(view, false)).map((r) => r.label)).toEqual(['Provider', 'Status', 'Error code', 'Error type', 'Request ID'])
    expect(failureDetailRows(forViewer(view, true)).map((r) => r.label)).toEqual(['Provider', 'Status', 'Error code', 'Error type', 'Request ID', 'Attempts', 'Provider message'])
    expect(failureDetailRows(null)).toEqual([])
  })
})

describe('WorkingBubble', () => {
  it('says what is happening, with Stop; Stopping… once stopped', () => {
    const html = renderToStaticMarkup(createElement(WorkingBubble, { activity: { phase: 'working', since: Date.now() }, onStop: () => {} }))
    expect(html).toContain('Working on it…')
    expect(html).toContain('data-testid="agent-working-stop"')
    expect(html).toContain('data-activity-phase="working"')
    const stopping = renderToStaticMarkup(createElement(WorkingBubble, { activity: { phase: 'tool', label: 'Reading the form', since: Date.now() }, stopping: true, onStop: () => {} }))
    expect(stopping).toContain('Stopping…')
    expect(stopping).not.toContain('agent-working-stop')
  })

  it('a live region when asked; nothing while text streams', () => {
    expect(renderToStaticMarkup(createElement(WorkingBubble, { activity: { phase: 'thinking', since: Date.now() }, live: true }))).toContain('aria-live="polite"')
    expect(renderToStaticMarkup(createElement(WorkingBubble, { activity: { phase: 'writing', since: Date.now() } }))).toBe('')
  })
})

describe('RetryNote (admins, after the turn)', () => {
  it('a collapsed Details with the retries and why — no raw provider text', () => {
    const html = renderToStaticMarkup(createElement(RetryNote, { retries: { retries: 2, code: 'rate_limited', status: 429, provider: 'Anthropic' } }))
    expect(html).toContain('<details')
    expect(html).not.toContain('open=')
    expect(html).toContain('Answered after 2 automatic retries (rate limited · HTTP 429 · Anthropic)')
  })
})

describe('WorkingBubble never mentions retries', () => {
  it('a working bubble only says it is working', () => {
    for (const phase of ['working', 'thinking'] as const) {
      const html = renderToStaticMarkup(createElement(WorkingBubble, { activity: { phase, since: Date.now() - 30_000 } }))
      expect(html).toContain('This is taking longer than usual…')
      expect(html).not.toMatch(/provider|retry|attempt/i)
    }
  })
})
