'use client'

import { useEffect } from 'react'
import { LAST_SEEN_STORAGE_PREFIX, LAST_SEEN_TOUCH_INTERVAL_MS } from '@/lib/last-seen-constants'

type LastSeenHeartbeatProps = {
  userId: string
  enabled?: boolean
}

function readLastTouchedAt(userId: string) {
  if (typeof window === 'undefined') return 0
  try {
    return Number(localStorage.getItem(`${LAST_SEEN_STORAGE_PREFIX}${userId}`) ?? 0)
  } catch {
    return 0
  }
}

function writeLastTouchedAt(userId: string, timestamp: number) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${LAST_SEEN_STORAGE_PREFIX}${userId}`, String(timestamp))
  } catch {}
}

export function LastSeenHeartbeat({ userId, enabled = true }: LastSeenHeartbeatProps) {
  useEffect(() => {
    if (!enabled || !userId) return

    let inFlight = false

    const touch = async (force = false) => {
      if (inFlight) return
      const now = Date.now()
      const lastTouchedAt = readLastTouchedAt(userId)
      if (!force && now - lastTouchedAt < LAST_SEEN_TOUCH_INTERVAL_MS) return

      inFlight = true
      writeLastTouchedAt(userId, now)
      try {
        await fetch('/api/auth/heartbeat', {
          method: 'POST',
          cache: 'no-store',
          keepalive: true,
        })
      } catch {
        writeLastTouchedAt(userId, lastTouchedAt)
      } finally {
        inFlight = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void touch()
      }
    }

    const handleFocus = () => {
      void touch()
    }

    void touch()
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void touch()
      }
    }, LAST_SEEN_TOUCH_INTERVAL_MS)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, userId])

  return null
}

