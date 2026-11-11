'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { serverQuery } from '@/lib/server-read'
import { saveOnboardingChoice } from '@/app/actions/onboarding'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  decideVisibility, dismissKey, initialView, itemDef, progressOf, visitedItemForPath,
  type GuideView, type OnboardingChoice, type OnboardingItemDef, type OnboardingProgress, type StoredOnboarding, type Visibility,
} from '@/lib/onboarding/model'
import type { OnboardingState } from '@/lib/services/onboarding'

/**
 * The getting-started guide's state for the dashboard shell: the checklist
 * (onboarding.state), what the person chose, whether it opens by itself, and
 * the dialog / tour / feedback surfaces. Mounted once in DashboardShell, so
 * the sidebar launcher and the Help menu share it. Rules: lib/onboarding/model.ts.
 */

const GuideDialog = dynamic(() => import('./getting-started-dialog').then((m) => m.GettingStartedDialog), { ssr: false })
const TourRunner = dynamic(() => import('./tour-runner').then((m) => m.TourRunner), { ssr: false })
const FeedbackDialog = dynamic(() => import('./feedback-dialog').then((m) => m.FeedbackDialog), { ssr: false })

export const ONBOARDING_QUERY_KEY = ['onboarding-state'] as const

export interface GuideItem extends OnboardingItemDef { done: boolean }

interface OnboardingContextValue {
  state: OnboardingState | null
  items: GuideItem[]
  progress: OnboardingProgress
  visibility: Visibility | null
  /** Open the guide (on a given screen). */
  openGuide: (view?: GuideView) => void
  openFeedback: () => void
  startTour: (tourId: string) => void
  choose: (choice: OnboardingChoice) => Promise<void>
}

const EMPTY_PROGRESS: OnboardingProgress = { done: 0, total: 0, complete: false, percent: 0 }

const OnboardingContext = createContext<OnboardingContextValue>({
  state: null, items: [], progress: EMPTY_PROGRESS, visibility: null,
  openGuide: () => {}, openFeedback: () => {}, startTour: () => {}, choose: async () => {},
})

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext)
}

function readDismissed(key: string | null): boolean {
  if (!key) return false
  try { return window.sessionStorage.getItem(key) === '1' } catch { return false }
}

export function OnboardingProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const { data: state = null } = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: () => serverQuery('onboarding.state'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const [view, setView] = useState<GuideView | null>(null)
  const [tour, setTour] = useState<string | null>(null)
  const [feedback, setFeedback] = useState(false)
  const key = state ? dismissKey(userId, state.tenant_id) : null
  const [dismissedTick, setDismissedTick] = useState(0)

  const items = useMemo<GuideItem[]>(() => (state?.items ?? []).flatMap((i) => {
    const def = itemDef(i.id)
    return def ? [{ ...def, done: i.done }] : []
  }), [state])
  const progress = useMemo(() => progressOf(items, Object.fromEntries(items.map((i) => [i.id, i.done]))), [items])
  const visibility = useMemo(() => state ? decideVisibility({
    audience: state.audience, tenantCreatedAt: state.tenant_created_at, joinedAt: state.joined_at,
    showToMembers: state.settings.show_to_members, stored: state.stored, progress,
    sessionDismissed: readDismissed(key), now: new Date(),
  }) : null, [state, progress, key, dismissedTick]) // eslint-disable-line react-hooks/exhaustive-deps -- dismissedTick re-reads sessionStorage

  const setStored = useCallback((stored: StoredOnboarding) => {
    queryClient.setQueryData<OnboardingState | null>(ONBOARDING_QUERY_KEY, (prev) => prev ? { ...prev, stored } : prev)
  }, [queryClient])

  const choose = useCallback(async (choice: OnboardingChoice) => {
    const result = await saveOnboardingChoice(choice)
    if (result.ok) {
      setStored(result.stored)
      if (choice.kind === 'visit') void queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
    }
  }, [queryClient, setStored])

  const dismissForSession = useCallback(() => {
    if (key) { try { window.sessionStorage.setItem(key, '1') } catch { /* ignore */ } }
    setDismissedTick((n) => n + 1)
  }, [key])

  const openGuide = useCallback((requested?: GuideView) => {
    if (!state) return
    setView(initialView(state.stored, { celebrate: Boolean(visibility?.celebrate), requested: requested ?? null }))
  }, [state, visibility])

  // Opens by itself once per page load: new workspace / new member, not opted out, reminder due.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || !state || !visibility?.autoOpen || pathname.startsWith('/onboarding')) return
    // Marked when it actually opens: a refetch in the meantime reschedules it rather than losing it.
    const t = window.setTimeout(() => {
      autoOpened.current = true
      setView(initialView(state.stored, { celebrate: visibility.celebrate }))
    }, 600)
    return () => window.clearTimeout(t)
  }, [state, visibility, pathname])

  // Visiting a page completes its item (My tasks, Preferences, the tutorials).
  const searchString = search?.toString() ?? ''
  useEffect(() => {
    if (!state) return
    const item = visitedItemForPath(pathname, searchString)
    if (!item || !state.items.some((i) => i.id === item && !i.done)) return
    void choose({ kind: 'visit', item })
  }, [pathname, searchString, state, choose])

  // Done states change as the person works: refresh when they come back to a page.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    if (!state || progress.complete) return
    void queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on navigation only
  }, [pathname])

  const startTour = useCallback((tourId: string) => {
    setView(null)
    dismissForSession()
    if (!isMobile) setTour(tourId)
  }, [dismissForSession, isMobile])

  const value = useMemo<OnboardingContextValue>(() => ({
    state, items, progress, visibility, openGuide, openFeedback: () => setFeedback(true), startTour, choose,
  }), [state, items, progress, visibility, openGuide, startTour, choose])

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {state && view && (
        <GuideDialog
          view={view}
          onViewChange={setView}
          onClose={(how) => {
            setView(null)
            if (how === 'dismiss') dismissForSession()
          }}
        />
      )}
      {tour && (
        <TourRunner
          tourId={tour}
          agentAvailable={Boolean(state?.agent_available)}
          onExit={(how) => {
            const done = tour
            setTour(null)
            if (how !== 'skipped') void choose({ kind: 'tour', tour: done })
            // Back to the checklist after the last step; not when the tour handed over to the page (the Gallery is open).
            if (how === 'finished') setView('checklist')
          }}
        />
      )}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
    </OnboardingContext.Provider>
  )
}
