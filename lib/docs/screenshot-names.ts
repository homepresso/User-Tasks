/**
 * Screenshots in public/screenshots/<name>.webp (captured by
 * scripts/screenshots). Docs reference them with `::image <name> | alt | caption`.
 * Kept separate from the static image imports (lib/docs/screenshots.ts) so
 * tests and the directive check don't need an image loader.
 */
export const SCREENSHOT_NAMES = [
  'designer',
  'run-detail',
  'task-detail',
  'integrations',
  'decision-table',
  'log-export',
  'reports',
  'tasks-queue',
  'email-template',
  'data-table',
  'custom-step',
  'roles',
  'api-keys',
  'theme-designer',
  'theme-designer-dark',
  'live-instances',
  'migrate-instances',
  'migrate-instances-review',
  'run-workflow',
  'cli-login',
  'cli-edit-workflow',
  'cli-crud',
  'cli-log-destinations',
  'cli-logs-tail',
  'cli-config-diff',
  'cli-migrate-instances',
  'packages-library-incomplete',
  'packages-library-complete',
  'packages-complete-setup',
  'packages-needs-configuration',
  'packages-wizard-package',
  'packages-wizard-changes',
  'packages-wizard-configure',
  'packages-authored',
  'packages-editor',
  'infrastructure-change-provider',
  'infrastructure-switch-plan',
  'infrastructure-switch-progress',
  'infrastructure-database-test',
] as const

export type ScreenshotName = (typeof SCREENSHOT_NAMES)[number]
