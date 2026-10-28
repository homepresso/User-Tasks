import type { StaticImageData } from 'next/image'
import designer from '@/public/screenshots/designer.webp'
import runDetail from '@/public/screenshots/run-detail.webp'
import taskDetail from '@/public/screenshots/task-detail.webp'
import integrations from '@/public/screenshots/integrations.webp'
import decisionTable from '@/public/screenshots/decision-table.webp'
import logExport from '@/public/screenshots/log-export.webp'
import reports from '@/public/screenshots/reports.webp'
import tasksQueue from '@/public/screenshots/tasks-queue.webp'
import emailTemplate from '@/public/screenshots/email-template.webp'
import dataTable from '@/public/screenshots/data-table.webp'
import customStep from '@/public/screenshots/custom-step.webp'
import roles from '@/public/screenshots/roles.webp'
import apiKeys from '@/public/screenshots/api-keys.webp'
import themeDesigner from '@/public/screenshots/theme-designer.webp'
import themeDesignerDark from '@/public/screenshots/theme-designer-dark.webp'
import liveInstances from '@/public/screenshots/live-instances.webp'
import migrateInstances from '@/public/screenshots/migrate-instances.webp'
import migrateInstancesReview from '@/public/screenshots/migrate-instances-review.webp'
import runWorkflow from '@/public/screenshots/run-workflow.webp'
import cliLogin from '@/public/screenshots/cli-login.webp'
import cliEditWorkflow from '@/public/screenshots/cli-edit-workflow.webp'
import cliCrud from '@/public/screenshots/cli-crud.webp'
import cliLogDestinations from '@/public/screenshots/cli-log-destinations.webp'
import cliLogsTail from '@/public/screenshots/cli-logs-tail.webp'
import cliConfigDiff from '@/public/screenshots/cli-config-diff.webp'
import cliMigrateInstances from '@/public/screenshots/cli-migrate-instances.webp'
import packagesLibraryIncomplete from '@/public/screenshots/packages-library-incomplete.webp'
import packagesLibraryComplete from '@/public/screenshots/packages-library-complete.webp'
import packagesCompleteSetup from '@/public/screenshots/packages-complete-setup.webp'
import packagesNeedsConfiguration from '@/public/screenshots/packages-needs-configuration.webp'
import packagesWizardPackage from '@/public/screenshots/packages-wizard-package.webp'
import packagesWizardChanges from '@/public/screenshots/packages-wizard-changes.webp'
import packagesWizardConfigure from '@/public/screenshots/packages-wizard-configure.webp'
import packagesAuthored from '@/public/screenshots/packages-authored.webp'
import packagesEditor from '@/public/screenshots/packages-editor.webp'
import infrastructureChangeProvider from '@/public/screenshots/infrastructure-change-provider.webp'
import infrastructureSwitchPlan from '@/public/screenshots/infrastructure-switch-plan.webp'
import infrastructureSwitchProgress from '@/public/screenshots/infrastructure-switch-progress.webp'
import infrastructureDatabaseTest from '@/public/screenshots/infrastructure-database-test.webp'
import type { ScreenshotName } from './screenshot-names'

/** Static imports of public/screenshots (width, height and blur placeholder come from the files). */
export const SCREENSHOTS: Record<ScreenshotName, StaticImageData> = {
  'designer': designer,
  'run-detail': runDetail,
  'task-detail': taskDetail,
  'integrations': integrations,
  'decision-table': decisionTable,
  'log-export': logExport,
  'reports': reports,
  'tasks-queue': tasksQueue,
  'email-template': emailTemplate,
  'data-table': dataTable,
  'custom-step': customStep,
  'roles': roles,
  'api-keys': apiKeys,
  'theme-designer': themeDesigner,
  'theme-designer-dark': themeDesignerDark,
  'live-instances': liveInstances,
  'migrate-instances': migrateInstances,
  'migrate-instances-review': migrateInstancesReview,
  'run-workflow': runWorkflow,
  'cli-login': cliLogin,
  'cli-edit-workflow': cliEditWorkflow,
  'cli-crud': cliCrud,
  'cli-log-destinations': cliLogDestinations,
  'cli-logs-tail': cliLogsTail,
  'cli-config-diff': cliConfigDiff,
  'cli-migrate-instances': cliMigrateInstances,
  'packages-library-incomplete': packagesLibraryIncomplete,
  'packages-library-complete': packagesLibraryComplete,
  'packages-complete-setup': packagesCompleteSetup,
  'packages-needs-configuration': packagesNeedsConfiguration,
  'packages-wizard-package': packagesWizardPackage,
  'packages-wizard-changes': packagesWizardChanges,
  'packages-wizard-configure': packagesWizardConfigure,
  'packages-authored': packagesAuthored,
  'packages-editor': packagesEditor,
  'infrastructure-change-provider': infrastructureChangeProvider,
  'infrastructure-switch-plan': infrastructureSwitchPlan,
  'infrastructure-switch-progress': infrastructureSwitchProgress,
  'infrastructure-database-test': infrastructureDatabaseTest,
}
