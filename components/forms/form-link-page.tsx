import { WorkspaceThemeProvider } from '@/components/providers/theme-provider'
import { PermissionsProvider } from '@/lib/permissions-context'
import { loadSessionWorkspaceTheme } from '@/lib/theme/server'
import { themeFontHrefs, themeStylesheet } from '@/lib/theme/to-css'
import { FontLinks } from '@/components/fonts/font-links'
import { EmbedFrame } from './embed-frame'
import { StandaloneForm } from './standalone-form'
import { AssistantHost } from '@/components/assistants/assistant-host'

/**
 * A form link page for a signed-in member (/f/<id> and /form/<system name>
 * — one rendering path): the form alone, no dashboard shell, sidebar or top
 * bar. The workspace theme (colours, fonts) and the form's own theme on top,
 * the member's permissions for the favourite heart and Save draft. Server
 * component.
 */
export async function MemberFormPage({ formId, query, embed, userId }: {
  formId: string
  query: Record<string, string | string[] | undefined>
  embed: boolean
  userId: string
}) {
  const [theme, permissions] = await Promise.all([
    loadSessionWorkspaceTheme(),
    import('@/lib/permissions-server').then((m) => m.getUserPermissions()).catch(() => new Set<string>()),
  ])
  const fontHrefs = themeFontHrefs(theme)
  const allowed = permissions.has('forms.submit')
  return (
    <>
      <FontLinks hrefs={fontHrefs} />
      <style id="workspace-theme" dangerouslySetInnerHTML={{ __html: themeStylesheet(theme) }} />
      <WorkspaceThemeProvider theme={theme}>
        <PermissionsProvider permissions={[...permissions]} userId={userId}>
          <FormLinkLayout>
            <EmbedFrame embed={embed}>
              {allowed ? (
                <>
                  <StandaloneForm formId={formId} query={query} surface="standalone" embed={embed} />
                  {!embed && <AssistantHost standalone />}
                </>
              ) : (
                <FormLinkNotice title="You can't open this form" body="Your role in this workspace doesn't include submitting forms. Ask an admin for access." />
              )}
            </EmbedFrame>
          </FormLinkLayout>
        </PermissionsProvider>
      </WorkspaceThemeProvider>
    </>
  )
}

/** The bare page of a form link: the canvas and the outer padding (dropped when embedded). */
export function FormLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-8 text-fg sm:py-12" data-form-link-layout>
      {children}
    </main>
  )
}

/** A short message in place of the form (no access, not found). */
export function FormLinkNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-border bg-panel p-8 text-center shadow-elev-1" role="status" data-form-link-notice>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-1.5 text-sm text-fg-muted">{body}</p>
    </div>
  )
}
