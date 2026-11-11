"use client"

import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/ui/page-header"
import { usePermissions } from "@/lib/permissions-context"
import { ProfileForm } from "./profile-form"
import { OrgList } from "./org-list"
import { PreferencesForm } from "./preferences-form"
import { WorkspaceThemeCard } from "./workspace-theme-card"
import { LogoUpload } from "./logo-upload"
import { WorkspaceAddressCard } from "./workspace-address-card"
import { AnonymousFormsCard } from "./anonymous-forms-card"
import { FormSignInCard } from "./form-sign-in-card"
import { FormAccessibilityCard } from "./form-accessibility-card"
import { TaskCompletionCard } from "./task-completion-card"
import { SettingsSection, SettingsSections } from "./settings-section"
import { InstallSelfTestButton } from "@/components/automations/install-self-test-button"
import { OnboardingSettingsCard } from "@/components/onboarding/getting-started/onboarding-settings-card"
import { settingsTabFrom, type SettingsTab } from "./settings-frame"

interface SettingsTabsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
  tenantId: string
  logoUrl: string | null
}

const HEADERS: Record<SettingsTab, { title: string; description: string }> = {
  profile: { title: "Profile", description: "How you appear to the rest of the workspace." },
  preferences: { title: "Preferences", description: "Defaults for your tasks and the hours you're available." },
  general: { title: "General", description: "The workspace address, logo and the theme everyone sees." },
  forms: { title: "Forms", description: "Workspace rules for accessibility checks, public links and the form sign-in page." },
  "task-completion": { title: "Task completion", description: "What people see after they action a task." },
  organizations: { title: "Organizations", description: "The workspaces you're a member of." },
}

/**
 * The /settings page tabs (Account and part of Workspace in the sub-nav).
 * The tab comes from `?tab=` so each one is a link in the Settings frame.
 */
export function SettingsTabs({ profile, tenantId, logoUrl }: SettingsTabsProps) {
  const params = useSearchParams()
  const { can } = usePermissions()
  // Workspace tabs need View settings; everyone else lands on their profile.
  const requested = settingsTabFrom(params.get("tab"))
  const workspaceTab = requested === "general" || requested === "forms" || requested === "task-completion"
  const tab: SettingsTab = workspaceTab && !can("settings.view") ? "profile" : requested
  const header = HEADERS[tab]

  return (
    <>
      <PageHeader title={header.title} description={header.description} />

      {tab === "profile" && <ProfileForm profile={profile} />}

      {tab === "preferences" && (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <PreferencesForm userId={profile.id} preferences={(profile.preferences as any) ?? {}} />
      )}

      {tab === "general" && (
        <SettingsSections>
          <SettingsSection title="Workspace address" description="The workspace's own web address. Friendly form links use it.">
            <WorkspaceAddressCard readOnly={!can("settings.edit")} />
          </SettingsSection>
          <SettingsSection tour="logo-upload" title="Workspace logo" description="Shown at the top of the sidebar for everyone in the workspace.">
            <LogoUpload tenantId={tenantId} currentLogoUrl={logoUrl} readOnly={!can("settings.edit")} />
          </SettingsSection>
          <SettingsSection tour="theme-card" title="Workspace theme" description="The brand theme everyone in this workspace sees.">
            <WorkspaceThemeCard />
          </SettingsSection>
          <SettingsSection tour="onboarding-settings" title="Getting started guide" description="The welcome and checklist new admins and members see in their first 30 days.">
            <OnboardingSettingsCard readOnly={!can("settings.edit")} />
          </SettingsSection>
          {can("settings.edit") && can("workflows.create") && can("workflows.activate") && (
            <SettingsSection tour="self-test" title="Platform self-test" description="Install the kitchen sink workflow, which runs every built-in workflow step and checks the results. Run it after upgrades to confirm everything works.">
              <InstallSelfTestButton />
            </SettingsSection>
          )}
        </SettingsSections>
      )}

      {tab === "forms" && (
        <SettingsSections>
          <SettingsSection title="Form accessibility" description="Check forms against WCAG 2.2 AA when they are saved.">
            <FormAccessibilityCard readOnly={!can("settings.edit")} />
          </SettingsSection>
          <SettingsSection title="Anonymous forms" description="Let people fill in forms through a public link, without signing in.">
            <AnonymousFormsCard readOnly={!can("settings.edit")} />
          </SettingsSection>
          <SettingsSection title="Form sign-in page" description="What people see when a form link needs them to sign in: your logo, one of ten designs and your own wording.">
            <FormSignInCard tenantId={tenantId} readOnly={!can("settings.edit")} />
          </SettingsSection>
        </SettingsSections>
      )}

      {tab === "task-completion" && (
        <SettingsSections>
          <SettingsSection title="Task completed screen" description="Shown in place of the task once someone completes it with an outcome: what they chose, what happens next and where to go. Task forms can override it in the form designer (Buttons & header).">
            <TaskCompletionCard readOnly={!can("settings.edit")} />
          </SettingsSection>
        </SettingsSections>
      )}

      {tab === "organizations" && <OrgList />}
    </>
  )
}
