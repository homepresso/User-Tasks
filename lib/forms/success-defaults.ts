/**
 * The default finish for a new form: an animated thank-you page after a
 * submission. Shared by the form wizard (lib/forms/wizard/build.ts) and the
 * Agent's form creation (lib/assistants/tools/designer.ts draftOnlyArgs, so
 * forms_create and build_plan form items both get it), so the two stay in
 * step.
 *
 *  - `layout.submitted_page`: a check-mark page with a thank-you heading and
 *    the submission reference (lib/forms/submitted-page.ts).
 *  - `layout.animation`: expressive motion with a light confetti burst on the
 *    success page (lib/forms/motion.ts; reduced motion is always respected).
 *
 * Only what is missing is added: an explicit submitted_page (even one turned
 * off) or animation (even `none`) is kept as it is. MCP / REST forms_create
 * do NOT apply it — an omitted layout key there means "the platform default"
 * (no Submitted page, subtle motion) and API callers may rely on that.
 */
import type { FormAnimationConfig } from './motion'

export const DEFAULT_SUCCESS_HEADING = 'Thank you — your response was submitted'
export const DEFAULT_SUCCESS_MESSAGE = 'Your reference is {{submission.reference}}.'

export interface DefaultSubmittedPage {
  enabled: true
  icon: 'check_circle'
  heading: string
  subheading: string
  submit_another: { enabled: boolean }
  close: { enabled: true }
}

/** The thank-you page (heading / message fall back to the defaults). */
export function defaultSubmittedPage(opts: { heading?: string; message?: string; submitAnother?: boolean } = {}): DefaultSubmittedPage {
  return {
    enabled: true,
    icon: 'check_circle',
    heading: opts.heading || DEFAULT_SUCCESS_HEADING,
    subheading: opts.message || DEFAULT_SUCCESS_MESSAGE,
    submit_another: { enabled: opts.submitAnother === true },
    close: { enabled: true },
  }
}

/** The animation that goes with it: expressive, confetti on the success page. */
export function defaultFormAnimation(): FormAnimationConfig {
  return { style: 'expressive', confetti: true }
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * A new form's layout with the animated thank-you page added where the
 * layout doesn't say otherwise (null / missing layout → just these keys; the
 * service lays the fields out). The animation is added only when the form
 * ends on an enabled Submitted page.
 */
export function withDefaultSuccessPage(layout: unknown): Record<string, unknown> {
  let base: unknown = layout
  if (typeof base === 'string') { try { base = JSON.parse(base) } catch { base = null } }
  const out: Record<string, unknown> = isObject(base) ? { ...base } : {}
  if (out.submitted_page === undefined) out.submitted_page = defaultSubmittedPage()
  const page = out.submitted_page
  if (out.animation === undefined && isObject(page) && page.enabled !== false) out.animation = defaultFormAnimation()
  return out
}

/** Whether a layout ends on the default animated thank-you page (for the confirmation card). */
export function hasAnimatedSuccessPage(layout: unknown): boolean {
  if (!isObject(layout) || !isObject(layout.submitted_page) || layout.submitted_page.enabled === false) return false
  const a = layout.animation
  return isObject(a) && a.style === 'expressive'
}
