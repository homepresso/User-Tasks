import type { StaticImageData } from 'next/image'
import designer from '@/public/screenshots/designer.webp'
import runDetail from '@/public/screenshots/run-detail.webp'
import taskDetail from '@/public/screenshots/task-detail.webp'
import taskAttachments from '@/public/screenshots/task-attachments.webp'
import formLazyLoad from '@/public/screenshots/form-lazy-load.webp'
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
import documentsRead from '@/public/screenshots/documents-read.webp'
import documentsDataPicker from '@/public/screenshots/documents-data-picker.webp'
import documentsTestRun from '@/public/screenshots/documents-test-run.webp'
import documentsCompare from '@/public/screenshots/documents-compare.webp'
import documentsCompareReport from '@/public/screenshots/documents-compare-report.webp'
import formsDesigner from '@/public/screenshots/forms-designer.webp'
import formsLabel from '@/public/screenshots/forms-label.webp'
import formsLookup from '@/public/screenshots/forms-lookup.webp'
import formsButtons from '@/public/screenshots/forms-buttons.webp'
import formsTheme from '@/public/screenshots/forms-theme.webp'
import formsPage from '@/public/screenshots/forms-page.webp'
import formsAvailableMenu from '@/public/screenshots/forms-available-menu.webp'
import formsHeaderMenu from '@/public/screenshots/forms-header-menu.webp'
import formsTrigger from '@/public/screenshots/forms-trigger.webp'
import formsDataPicker from '@/public/screenshots/forms-data-picker.webp'
import formsPhone from '@/public/screenshots/forms-phone.webp'
import formsSteps from '@/public/screenshots/forms-steps.webp'
import formsTabs from '@/public/screenshots/forms-tabs.webp'
import formsStepsDesigner from '@/public/screenshots/forms-steps-designer.webp'
import formsApplicationMode from '@/public/screenshots/forms-application-mode.webp'
import formsApplicationModeDesigner from '@/public/screenshots/forms-application-mode-designer.webp'
import formsButtonDesigner from '@/public/screenshots/forms-button-designer.webp'
import formsSubmittedPage from '@/public/screenshots/forms-submitted-page.webp'
import formsDataTable from '@/public/screenshots/forms-data-table.webp'
import formsDataTableDesigner from '@/public/screenshots/forms-data-table-designer.webp'
import formsDataTableCollections from '@/public/screenshots/forms-data-table-collections.webp'
import formsDynamicProperties from '@/public/screenshots/forms-dynamic-properties.webp'
import formsTableChanges from '@/public/screenshots/forms-table-changes.webp'
import formsTableChangesRule from '@/public/screenshots/forms-table-changes-rule.webp'
import workflowsDesigner from '@/public/screenshots/workflows-designer.webp'
import workflowsProcessViewer from '@/public/screenshots/workflows-process-viewer.webp'
import workflowsSaveTest from '@/public/screenshots/workflows-save-test.webp'
import integrationsOpenapiImport from '@/public/screenshots/integrations-openapi-import.webp'
import integrationsDataPicker from '@/public/screenshots/integrations-data-picker.webp'
import integrationsCustomReference from '@/public/screenshots/integrations-custom-reference.webp'
import integrationsCustomReferenceWrite from '@/public/screenshots/integrations-custom-reference-write.webp'
import mediaDesigner from '@/public/screenshots/media-designer.webp'
import mediaRedactSettings from '@/public/screenshots/media-redact-settings.webp'
import mediaRedactBeforeAfter from '@/public/screenshots/media-redact-before-after.webp'
import mediaTranscribe from '@/public/screenshots/media-transcribe.webp'
import mediaTestRun from '@/public/screenshots/media-test-run.webp'
import mediaAgent from '@/public/screenshots/media-agent.webp'
import mediaTranscribeDetail from '@/public/screenshots/media-transcribe-detail.webp'
import mediaBleepDetail from '@/public/screenshots/media-bleep-detail.webp'
import mediaTestRunDetail from '@/public/screenshots/media-test-run-detail.webp'
import mediaFoiaReview from '@/public/screenshots/media-foia-review.webp'
import mediaClaimBeforeAfter from '@/public/screenshots/media-claim-before-after.webp'
import formsControlHarness from '@/public/screenshots/forms-control-harness.webp'
import formsCsatSurvey from '@/public/screenshots/forms-csat-survey.webp'
import formsPulseQuestionnaire from '@/public/screenshots/forms-pulse-questionnaire.webp'
import formsTrainingQuiz from '@/public/screenshots/forms-training-quiz.webp'
import formsInspectionChecklist from '@/public/screenshots/forms-inspection-checklist.webp'
import formsEventDashboard from '@/public/screenshots/forms-event-dashboard.webp'
import formsContractReview from '@/public/screenshots/forms-contract-review.webp'
import formsRules from '@/public/screenshots/forms-rules.webp'
import formsRulesRuntime from '@/public/screenshots/forms-rules-runtime.webp'
import formsParams from '@/public/screenshots/forms-params.webp'
import formsRuleVariables from '@/public/screenshots/forms-rule-variables.webp'
import formsVariablePicker from '@/public/screenshots/forms-variable-picker.webp'
import formsPrefillFromUrl from '@/public/screenshots/forms-prefill-from-url.webp'
import formsMessages from '@/public/screenshots/forms-messages.webp'
import homeActivity from '@/public/screenshots/home-activity.webp'
import homeLayout from '@/public/screenshots/home-layout.webp'
import homeSubmissions from '@/public/screenshots/home-submissions.webp'
import homeViewFlow from '@/public/screenshots/home-view-flow.webp'
import type { ScreenshotName } from './screenshot-names'

/** Static imports of public/screenshots (width, height and blur placeholder come from the files). */
export const SCREENSHOTS: Record<ScreenshotName, StaticImageData> = {
  'designer': designer,
  'run-detail': runDetail,
  'task-detail': taskDetail,
  'task-attachments': taskAttachments,
  'form-lazy-load': formLazyLoad,
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
  'documents-read': documentsRead,
  'documents-data-picker': documentsDataPicker,
  'documents-test-run': documentsTestRun,
  'documents-compare': documentsCompare,
  'documents-compare-report': documentsCompareReport,
  'forms-designer': formsDesigner,
  'forms-label': formsLabel,
  'forms-lookup': formsLookup,
  'forms-buttons': formsButtons,
  'forms-theme': formsTheme,
  'forms-page': formsPage,
  'forms-available-menu': formsAvailableMenu,
  'forms-header-menu': formsHeaderMenu,
  'forms-trigger': formsTrigger,
  'forms-data-picker': formsDataPicker,
  'forms-phone': formsPhone,
  'forms-steps': formsSteps,
  'forms-tabs': formsTabs,
  'forms-steps-designer': formsStepsDesigner,
  'forms-application-mode': formsApplicationMode,
  'forms-application-mode-designer': formsApplicationModeDesigner,
  'forms-button-designer': formsButtonDesigner,
  'forms-submitted-page': formsSubmittedPage,
  'forms-data-table': formsDataTable,
  'forms-data-table-designer': formsDataTableDesigner,
  'forms-data-table-collections': formsDataTableCollections,
  'forms-dynamic-properties': formsDynamicProperties,
  'forms-table-changes': formsTableChanges,
  'forms-table-changes-rule': formsTableChangesRule,
  'workflows-designer': workflowsDesigner,
  'workflows-process-viewer': workflowsProcessViewer,
  'workflows-save-test': workflowsSaveTest,
  'integrations-openapi-import': integrationsOpenapiImport,
  'integrations-data-picker': integrationsDataPicker,
  'integrations-custom-reference': integrationsCustomReference,
  'integrations-custom-reference-write': integrationsCustomReferenceWrite,
  'media-designer': mediaDesigner,
  'media-redact-settings': mediaRedactSettings,
  'media-redact-before-after': mediaRedactBeforeAfter,
  'media-transcribe': mediaTranscribe,
  'media-test-run': mediaTestRun,
  'media-agent': mediaAgent,
  'media-transcribe-detail': mediaTranscribeDetail,
  'media-bleep-detail': mediaBleepDetail,
  'media-test-run-detail': mediaTestRunDetail,
  'media-foia-review': mediaFoiaReview,
  'media-claim-before-after': mediaClaimBeforeAfter,
  'forms-control-harness': formsControlHarness,
  'forms-csat-survey': formsCsatSurvey,
  'forms-pulse-questionnaire': formsPulseQuestionnaire,
  'forms-training-quiz': formsTrainingQuiz,
  'forms-inspection-checklist': formsInspectionChecklist,
  'forms-event-dashboard': formsEventDashboard,
  'forms-contract-review': formsContractReview,
  'forms-rules': formsRules,
  'forms-rules-runtime': formsRulesRuntime,
  'forms-params': formsParams,
  'forms-rule-variables': formsRuleVariables,
  'forms-variable-picker': formsVariablePicker,
  'forms-prefill-from-url': formsPrefillFromUrl,
  'forms-messages': formsMessages,
  'home-activity': homeActivity,
  'home-layout': homeLayout,
  'home-submissions': homeSubmissions,
  'home-view-flow': homeViewFlow,
}
