/**
 * The form page opened from a User Task (`?workflow=<id>&step=<node id>`,
 * also /embed/forms/<id>/design): which step's workflow data the designer
 * shows (lib/forms/workflow-data.ts). Pure; used by the server pages.
 */
export function stepFromQuery(query: Record<string, string | string[] | undefined>): { workflowId: string; stepId: string } | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const workflowId = one(query.workflow)
  const stepId = one(query.step)
  return /^[0-9a-f-]{36}$/i.test(workflowId) && /^[A-Za-z0-9_-]{1,100}$/.test(stepId) ? { workflowId, stepId } : null
}
