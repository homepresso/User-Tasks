'use client'

/**
 * Small client enhancements for a docs article: the scroll-spying "On this
 * page" list, heading-anchor link copying and the "Was this page helpful?"
 * widget. The article itself is a server component; each of these renders
 * usable HTML without JavaScript (plain anchor links; the feedback buttons
 * simply do nothing).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { TocEntry } from '@/lib/docs/render'

const SPY_OFFSET = 112

/** Desktop "On this page": highlights the heading currently being read. */
export function DocsToc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const headings = entries.map((entry) => document.getElementById(entry.id)).filter((element): element is HTMLElement => Boolean(element))
    if (headings.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      let current = headings[0].id
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - SPY_OFFSET <= 0) current = heading.id
        else break
      }
      // At the very bottom the last short sections can never reach the top: pick the last.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = headings[headings.length - 1].id
      setActiveId(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [entries])

  // Keep the active entry visible inside the (scrollable) list.
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>('[data-active]')
    const scroller = list?.closest<HTMLElement>('[data-toc-scroll]')
    if (!item || !scroller) return
    const box = scroller.getBoundingClientRect()
    const rect = item.getBoundingClientRect()
    if (rect.top < box.top + 24 || rect.bottom > box.bottom - 24) scroller.scrollTop += rect.top - box.top - box.height / 2
  }, [activeId])

  return (
    <>
      <ul ref={listRef} className="relative mt-3 space-y-px border-l border-(color:--mkt-ink)/[0.08] text-ui">
        {entries.map((entry) => {
          const active = entry.id === activeId
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                data-active={active || undefined}
                aria-current={active ? 'location' : undefined}
                onClick={() => setActiveId(entry.id)}
                className={`-ml-px block border-l-2 py-1 leading-5 transition-colors ${entry.level === 3 ? 'pl-6' : 'pl-3'} ${active ? 'border-(color:--mkt-bronze) font-medium text-(color:--mkt-ink)' : 'border-transparent text-(color:--mkt-muted-strong) hover:border-(color:--mkt-ink)/20 hover:text-(color:--mkt-ink)'}`}
              >
                {entry.text}
              </a>
            </li>
          )
        })}
      </ul>
      <a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); history.replaceState(null, '', location.pathname) }} className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-(color:--mkt-muted) transition-colors hover:text-(color:--mkt-ink)">
        <ArrowUp size={12} aria-hidden="true" /> Back to top
      </a>
    </>
  )
}

/** Clicking a heading's "#" also copies the section link; a short toast confirms it. */
export function AnchorCopy() {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[data-docs-anchor]')
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey) return
      const url = `${location.origin}${location.pathname}${anchor.getAttribute('href') ?? ''}`
      void navigator.clipboard?.writeText(url).then(() => {
        setToast('Link copied')
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setToast(null), 1800)
      }).catch(() => { /* clipboard blocked: the link still navigates */ })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center">
      {toast && (
        <span className="docs-pop inline-flex items-center gap-2 rounded-full bg-(color:--mkt-primary) px-4 py-2 text-ui font-medium text-(color:--mkt-paper) shadow-lg">
          <Check size={14} aria-hidden="true" /> {toast}
        </span>
      )}
    </div>
  )
}

type Vote = 'yes' | 'no'
const VOTE_KEY = 'docs-feedback'

function storedVote(path: string): Vote | null {
  try {
    const value = JSON.parse(localStorage.getItem(VOTE_KEY) ?? '{}')?.[path]
    return value === 'yes' || value === 'no' ? value : null
  } catch {
    return null
  }
}

function storeVote(path: string, vote: Vote) {
  try {
    const all = JSON.parse(localStorage.getItem(VOTE_KEY) ?? '{}') ?? {}
    all[path] = vote
    localStorage.setItem(VOTE_KEY, JSON.stringify(all))
  } catch { /* not remembered */ }
}

/**
 * "Was this page helpful?" Cloud sends the vote (and an optional comment, no
 * personal data asked for) to /api/docs-feedback, which forwards it to the
 * team's ChirpMe channel; self-hosted keeps it in the browser only.
 */
export function FeedbackWidget({ path, send, contactHref }: { path: string; send: boolean; contactHref: string | null }) {
  const [vote, setVote] = useState<Vote | null>(null)
  const [stage, setStage] = useState<'ask' | 'comment' | 'done'>('ask')
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const previous = storedVote(path)
    setVote(previous)
    setStage(previous ? 'done' : 'ask')
    setComment('')
  }, [path])

  const submit = useCallback(async (chosen: Vote, text: string) => {
    storeVote(path, chosen)
    if (!send) return
    setSending(true)
    try {
      await fetch('/api/docs-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, helpful: chosen === 'yes', comment: text.trim() || undefined }),
      })
    } catch { /* best effort */ }
    setSending(false)
  }, [path, send])

  const choose = (chosen: Vote) => {
    setVote(chosen)
    setStage('comment')
  }

  return (
    <section aria-labelledby="docs-feedback-title" className="mt-14 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/60 p-5">
      {stage !== 'done' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="docs-feedback-title" className="text-sm font-semibold text-(color:--mkt-ink)">Was this page helpful?</h2>
            <div className="flex gap-2" role="group" aria-label="Was this page helpful?">
              {(['yes', 'no'] as const).map((option) => {
                const Icon = option === 'yes' ? ThumbsUp : ThumbsDown
                const selected = vote === option
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(option)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-ui font-medium transition ${selected ? 'border-(color:--mkt-bronze)/50 bg-(color:--mkt-bronze)/[0.1] text-(color:--mkt-ink)' : 'border-(color:--mkt-ink)/[0.12] text-(color:--mkt-muted-strong) hover:border-(color:--mkt-ink)/25 hover:text-(color:--mkt-ink)'}`}
                  >
                    <Icon size={14} aria-hidden="true" /> {option === 'yes' ? 'Yes' : 'No'}
                  </button>
                )
              })}
            </div>
          </div>
          {stage === 'comment' && vote && (
            <form
              className="mt-4"
              onSubmit={(event) => { event.preventDefault(); void submit(vote, comment).then(() => setStage('done')) }}
            >
              <label htmlFor="docs-feedback-comment" className="text-ui text-(color:--mkt-muted-strong)">
                {vote === 'yes' ? 'Great. Anything we could make even clearer?' : 'Sorry about that. What was missing or wrong?'} <span className="text-(color:--mkt-muted)">(optional)</span>
              </label>
              <textarea
                id="docs-feedback-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 500))}
                rows={3}
                maxLength={500}
                placeholder="Please don't include personal details."
                className="mt-2 w-full resize-y rounded-lg border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-paper) px-3 py-2 text-sm text-(color:--mkt-ink) placeholder:text-(color:--mkt-subtle) focus:border-(color:--mkt-bronze)/60 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button type="submit" disabled={sending} className="mkt-btn-primary rounded-lg px-3.5 py-1.5 text-ui font-semibold disabled:opacity-60">{sending ? 'Sending…' : 'Send feedback'}</button>
                <button type="button" onClick={() => { void submit(vote, '').then(() => setStage('done')) }} className="rounded-lg px-3 py-1.5 text-ui font-medium text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink)">Skip</button>
              </div>
            </form>
          )}
        </>
      ) : (
        <p id="docs-feedback-title" role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(color:--mkt-muted-strong)">
          <Check size={15} aria-hidden="true" className="text-(color:--mkt-green)" />
          <span className="font-medium text-(color:--mkt-ink)">Thanks for the feedback.</span>
          {contactHref && <span>Need a hand? <a href={contactHref} className="font-medium text-(color:--mkt-bronze) underline decoration-(color:--mkt-bronze)/30 underline-offset-2">Contact us</a>.</span>}
          <button type="button" onClick={() => { setStage('ask'); setVote(null) }} className="text-ui text-(color:--mkt-muted) underline underline-offset-2 hover:text-(color:--mkt-ink)">Change answer</button>
        </p>
      )}
    </section>
  )
}
