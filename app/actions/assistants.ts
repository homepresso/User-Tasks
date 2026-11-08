'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as assistants from '@/lib/services/assistants'
import type { AssistantSettingsInput } from '@/lib/assistants/types'

/*
 * Settings → Agent server actions: thin wrappers over
 * lib/services/assistants (assistants.manage, checked there). The key is
 * write-only — never sent back to the browser — and every change / test is
 * audited by the service.
 *
 * Expected failures are returned as { ok: false, error } so their messages
 * survive production builds, where thrown Server Function errors are redacted.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}

const PATH = assistants.ASSISTANTS_SETTINGS_PATH

export async function updateAssistantSettingsAction(input: AssistantSettingsInput) {
  const result = await run(async () => assistants.updateAssistantSettings(await fromSession(), input))
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function removeAssistantKeyAction() {
  const result = await run(async () => assistants.removeAssistantKey(await fromSession()))
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function testAssistantConnectionAction() {
  return run(async () => assistants.testAssistantConnection(await fromSession()))
}

export async function testModelRuleAction(ruleId: string) {
  const result = await run(async () => assistants.testModelRuleConnection(await fromSession(), String(ruleId ?? '')))
  if (result.ok) revalidatePath(PATH)
  return result
}
