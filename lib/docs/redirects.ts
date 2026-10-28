// Imported by next.config.ts, so keep this file free of other imports.

/**
 * Pages of the previous /docs/<slug> structure that moved. Pages whose slug
 * did not change (workflows, integrations, tasks, decision-tables, agents,
 * api, cli, observability, governance) keep their URL.
 */
export const LEGACY_DOC_REDIRECTS: Record<string, string> = {
  objects: '/docs/data-tables',
  templates: '/docs/email-templates',
  extensibility: '/docs/custom-steps',
  'github-sync': '/docs/config-as-code',
  reporting: '/docs/reports',
}
