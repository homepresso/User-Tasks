/**
 * In-app feedback ("Send feedback" in the welcome and the Help menu):
 * delivered through the contact pipeline (lib/contact/chirpme) server-side,
 * with the workspace and the person attached from the session — never from
 * the browser. Rate limited per person.
 */

import { z } from 'zod'
import { dbError, serviceRoleClient } from './_shared'
import { ServiceError, type ServiceContext } from './context'
import { contactDeliveryConfigured, deliverChirp, escapeHtml } from '@/lib/contact/chirpme'
import { rateLimit } from '@/lib/rate-limit'
import { publicBaseUrl } from '@/lib/deployment'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client */

export const FEEDBACK_CATEGORIES = ['idea', 'problem', 'praise', 'other'] as const
export const FEEDBACK_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 }

export const feedbackSchema = z.object({
  message: z.string().trim().min(5, 'Tell us a little more (at least 5 characters).').max(5000),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  /** The page they were on (a path; sent only when they leave "Include the page I'm on" ticked). */
  page: z.string().max(300).regex(/^\/[^\s]*$/).optional(),
})
export type FeedbackInput = z.input<typeof feedbackSchema>

export function feedbackAvailable(): boolean {
  return contactDeliveryConfigured()
}

export async function sendFeedback(ctx: ServiceContext, input: unknown): Promise<{ sent: true }> {
  if (!ctx.actorId) throw ServiceError.forbidden('Feedback needs a signed-in person')
  const parsed = feedbackSchema.safeParse(input)
  if (!parsed.success) throw ServiceError.validation(parsed.error.issues[0]?.message ?? 'Invalid feedback')
  if (!feedbackAvailable()) throw new ServiceError('internal', 'Feedback isn’t set up on this instance.', { status: 503 })
  const limit = await rateLimit(`feedback:${ctx.actorId}`, FEEDBACK_LIMIT)
  if (!limit.ok) throw new ServiceError('rate_limited', 'You’ve sent a lot of feedback in the last hour. Please try again later.')

  const db = await serviceRoleClient(ctx)
  const [userRes, tenantRes] = await Promise.all([
    (db as any).from('users').select('email, display_name').eq('id', ctx.actorId).maybeSingle(),
    (db as any).from('tenants').select('name, slug').eq('id', ctx.tenantId).maybeSingle(),
  ])
  if (userRes.error) throw dbError(userRes.error)
  const who = String(userRes.data?.display_name || userRes.data?.email || ctx.actorId)
  const email = String(userRes.data?.email ?? '')
  const workspace = String(tenantRes.data?.name ?? ctx.tenantId)
  const { message, category, rating, page } = parsed.data
  const stars = rating ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : null
  const rows = [
    ['From', `${who}${email ? ` (${email})` : ''}`],
    ['User id', ctx.actorId],
    ['Workspace', `${workspace}${tenantRes.data?.slug ? ` (${tenantRes.data.slug})` : ''}`],
    ['Workspace id', ctx.tenantId],
    ...(category ? [['Category', category]] : []),
    ...(stars ? [['Rating', stars]] : []),
    ...(page ? [['Page', page]] : []),
  ]
  const result = await deliverChirp({
    title: `UserTasks feedback — ${category ?? 'general'}${stars ? ` ${stars}` : ''}`,
    body: `${who} (${workspace}): ${message.slice(0, 140)}`,
    url: `${publicBaseUrl()}${page ?? '/home'}`,
    detail: `<h2>In-app feedback</h2>${rows.map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join('')}<h3>Message</h3><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    notificationIcon: 'feedback',
    subTab: 'Feedback',
    subTabColor: '#A78BFA',
  }, 'feedback')
  if (!result.ok) throw new ServiceError('internal', 'We couldn’t send your feedback. Please try again.', { status: 502 })
  return { sent: true }
}
