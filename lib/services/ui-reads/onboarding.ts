import { getOnboardingState } from '../onboarding'
import { defineRead, NO_ARGS } from './define'

/**
 * The getting-started guide (lib/services/onboarding.ts): the caller's own
 * checklist, choices and the yes / no done checks their permissions show.
 */
export const reads = {
  'onboarding.state': defineRead({ args: NO_ARGS, run: async (ctx) => getOnboardingState(ctx) }),
}
