'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as wizard from '@/lib/services/form-wizard'

/*
 * The form wizard's pages (/forms/wizard, /forms/results/<id>): thin
 * wrappers over lib/services/form-wizard — forms.wizard, ownership, the
 * results audience, validation and rollback live there.
 */

function run<T>(label: string, fallback: string, fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

export async function getWizardOptions() {
  return run('getWizardOptions', 'Could not load the wizard.', (ctx) => wizard.getWizardOptions(ctx))
}

export async function listWizardProjects() {
  return run('listWizardProjects', 'Could not load your forms.', (ctx) => wizard.listWizardProjects(ctx))
}

export async function getWizardProject(id: string) {
  return run('getWizardProject', 'Could not open the form.', (ctx) => wizard.getWizardProject(ctx, id))
}

export async function saveWizardDraft(input: { id?: string | null; draft: unknown }) {
  return run('saveWizardDraft', 'Could not save your progress.', (ctx) => wizard.saveWizardDraft(ctx, input))
}

export async function discardWizardDraft(id: string) {
  return run('discardWizardDraft', 'Could not discard the draft.', (ctx) => wizard.discardWizardDraft(ctx, id))
}

export async function planWizardForm(spec: unknown) {
  return run('planWizardForm', 'Could not check the form.', async (ctx) => wizard.planWizardForm(ctx, spec))
}

export async function createWizardForm(spec: unknown, projectId?: string | null) {
  return run('createWizardForm', 'Could not create the form.', (ctx) => wizard.createWizardForm(ctx, spec, { projectId: projectId ?? null }))
}

export async function updateWizardForm(projectId: string, spec: unknown) {
  return run('updateWizardForm', 'Could not save the form.', (ctx) => wizard.updateWizardForm(ctx, projectId, spec))
}

export async function draftQuestionsWithAi(input: { description: string; template?: string | null }) {
  return run('draftQuestionsWithAi', 'Could not draft questions.', (ctx) => wizard.draftQuestionsWithAi(ctx, input))
}

export async function getWizardResults(projectId: string, query: wizard.WizardResultsQuery = {}) {
  return run('getWizardResults', 'Could not load the results.', (ctx) => wizard.getWizardResults(ctx, projectId, query))
}
