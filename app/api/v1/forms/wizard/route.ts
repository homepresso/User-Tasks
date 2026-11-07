import { apiRoute } from '@/lib/api/route'
import { createWizardFormEndpoint, listWizardFormsEndpoint } from '@/lib/api-schemas/form-wizard'
import { createWizardForm, listWizardProjects, planWizardForm } from '@/lib/services/form-wizard'

/** GET /api/v1/forms/wizard — the caller's wizard forms and drafts. */
export const GET = apiRoute(listWizardFormsEndpoint, async ({ ctx }) => {
  const projects = await listWizardProjects(ctx)
  return { projects, total: projects.length }
})

/** POST /api/v1/forms/wizard — create the form, data table, workflow and results page (or dry_run: the plan). */
export const POST = apiRoute(createWizardFormEndpoint, async ({ ctx, body }) =>
  body.dry_run ? planWizardForm(ctx, body.spec) : createWizardForm(ctx, body.spec, { projectId: body.project_id ?? null }))
