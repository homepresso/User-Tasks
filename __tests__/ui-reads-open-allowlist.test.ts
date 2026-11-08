/**
 * UI reads without a `perm` run for any signed-in member (lib/services/ui-reads
 * runUiRead). Each one must be deliberately open, with the reason here
 * (governance audit 2026-11) — a new read without a permission fails this test
 * until it is either gated or justified.
 */
import { describe, expect, it } from 'vitest'
import { UI_READS } from '@/lib/services/ui-reads'

const OPEN_READS: Record<string, string> = {
  'tasks.followedIds': 'Which of the given task ids the signed-in user follows (own task_followers rows only)',
  'tasks.myQueueRules': "The signed-in user's own queue rules",
  'tasks.queueRuleOptions': 'Picker labels for the queue rules editor; workflows / forms only with workflows.view / forms.view (else the workflows behind the caller\'s own tasks)',
  'tasks.queueRulesPreview': "Evaluates the caller's draft rules for a sample task assigned to themselves",
  'assistants.availability': "Whether the signed-in person may use the Agent here and which help — booleans for themselves plus an opaque hash of their own user + workspace (history key); no settings, key or other people's data",
  'agents.run': 'One agent run; RLS on agent_runs limits it to agents.view or the person it acted for / who started it',
  'automations.dataTableNames': 'Table names only (ids → names) to label references in task and form screens; no rows or columns',
  'forms.available': "The person's own Available forms menu (explicit grants + forms.submit, checked in the RPC)",
  'forms.ruleUser': "The signed-in user's own profile fields that form rules read",
  'forms.accessibilitySettings': 'Workspace accessibility rule level that every form renderer applies',
  'forms.anonymousWorkspace': 'Whether public form links are on (never the secret); the form page needs it',
  'forms.signInPage': 'The form sign-in page look (public branding)',
  'forms.friendlyLink': "A form's friendly link (its system name) for the share / open buttons; names only",
  'forms.qr': "A QR code image of a form's link; links only",
  'forms.controlRuntime': 'Custom form control runtime metadata (enabled controls only) that rendering a form needs',
  'governance.roleOptions': 'Role names for pickers (assignment, sharing); no permissions',
  'governance.teamOptions': 'Team names for pickers',
  'governance.userOptions': 'Member names / emails for pickers (assignment, redirect, mentions) — every member works with people',
  'home.followMetrics': "The person's own Home metrics",
  'home.navCounts': 'Own task / tracker counts; each count gated on its permission inside the service',
  'home.following': 'Runs the person follows (visibleRun / can_view_run_progress)',
  'home.runProgress': "A run's progress for someone who can view it (visibleRun)",
  'home.followedRunIds': 'Which of the given runs the person follows',
  'home.favoriteForms': "The person's favourite forms",
  'home.formDrafts': "The person's own form drafts",
  'home.preferences': "The person's own Home preferences",
  'home.layout': "The person's own Home layout; widgets filtered by permission in the service",
  'org.person': 'A person card: requireOrgViewFor (org.view, or their own line / reports)',
  'org.project': 'A project: requireProjectRead (projects.view or a member of it)',
  'org.myProjects': 'Projects the person is on',
  'settings.branding': 'Workspace logo for the shell',
  'settings.workspaceAddress': 'Workspace address (shown to every member; docs: governance/workspace-address)',
  'settings.workspaceAddressCheck': 'Whether an address is free (no data about other workspaces beyond availability)',
  'settings.documentOcrStatus': 'Whether OCR is configured (a yes/no for upload screens; no credentials)',
  'settings.memberships': "The person's own workspace memberships (workspace switcher)",
  'settings.teamMembers': 'Members of a team, for pickers',
  'settings.tenantUsers': 'Workspace members for pickers',
  'tasks.reports': "A manager's own direct / indirect reports; another root (the reporting-line view) only inside their own subtree or with tasks.view_all — checked in listReportTasks",
  'tasks.actAccess': 'How the person may act on one task (describeTaskAccess re-checks everything)',
  'tasks.isManager': 'Whether the person has direct reports (shows My team)',
  'tasks.teams': 'Team names for task assignment pickers',
  'tasks.teamMembers': 'Team members for task assignment pickers',
  'tasks.redirectUsers': 'People a task can be redirected to',
  'tasks.myProfile': "The person's own profile",
  'tasks.completionSettings': 'Workspace task-completion screen settings every task screen applies',
}

describe('ui reads without a permission', () => {
  const open = Object.entries(UI_READS).filter(([, def]) => !(def as { perm?: unknown }).perm).map(([name]) => name).sort()

  it('are exactly the deliberately open ones', () => {
    expect(open).toEqual(Object.keys(OPEN_READS).sort())
  })

  it('each has a reason', () => {
    for (const [name, reason] of Object.entries(OPEN_READS)) expect(reason.length, name).toBeGreaterThan(15)
  })

  it('build / admin areas are never open', () => {
    const forbiddenPrefixes = ['automations.builder', 'integrations.', 'governance.roles', 'governance.permission', 'settings.apiKeys', 'activity.', 'reports.']
    expect(open.filter((n) => forbiddenPrefixes.some((p) => n.startsWith(p)))).toEqual([])
  })
})
