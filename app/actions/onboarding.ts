'use server'

import { fromSession, isServiceError } from '@/lib/services/context'
import * as onboarding from '@/lib/services/onboarding'
import type { StoredOnboarding } from '@/lib/onboarding/model'

/*
 * The getting-started guide's choices ("Remind me later", "Don't show
 * again", visited items, finished tours): the caller's own
 * users.preferences.onboarding for the current workspace — nobody else's row
 * can be named. lib/services/onboarding.ts validates the choice.
 */
export async function saveOnboardingChoice(choice: unknown): Promise<{ ok: true; stored: StoredOnboarding } | { ok: false; error: string }> {
  try {
    return { ok: true, stored: await onboarding.saveOnboardingChoice(await fromSession(), choice) }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[saveOnboardingChoice]', error)
    return { ok: false, error: 'Could not save your choice. Please try again.' }
  }
}

/**
 * "Send feedback" (the welcome and the Help menu): sent through the contact
 * pipeline with the caller's workspace and account attached server-side;
 * rate limited per person (lib/services/feedback.ts).
 */
export async function sendFeedback(input: import('@/lib/services/feedback').FeedbackInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { sendFeedback: send } = await import('@/lib/services/feedback')
    await send(await fromSession(), input)
    return { ok: true }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[sendFeedback]', error)
    return { ok: false, error: 'Could not send your feedback. Please try again.' }
  }
}
