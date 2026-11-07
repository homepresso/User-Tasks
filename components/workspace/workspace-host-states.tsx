import { Globe, Lock } from 'lucide-react'
import { Wordmark } from '@/components/brand/logo'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { SwitchAccountButton } from './switch-account-button'

/**
 * Pages of a workspace address (acme.usertasks.com) that is not usable as
 * it stands: no workspace has that address, or the signed-in person is not
 * a member. Rendered in the public frame (no shell, no workspace data).
 */

export function WorkspaceHostFrame({ children, homeHref }: { children: React.ReactNode; homeHref: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex h-14 items-center border-b border-border-subtle px-6">
        <a href={homeHref} aria-label="UserTasks home" className="rounded-md">
          <Wordmark size={24} />
        </a>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">{children}</main>
    </div>
  )
}

/** No workspace has this address (or it isn't a possible one). */
export function WorkspaceNotFoundView({ host, apexUrl }: { host: string; apexUrl: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-workspace-not-found>
      <EmptyState
        size="lg"
        icon={Globe}
        title={<><span className="mb-1 block text-xs font-medium text-fg-muted">404</span>No workspace at this address</>}
        description={<>There&rsquo;s no workspace at <span className="font-medium text-fg">{host}</span>. Check the address, or ask whoever shared the link for the right one. Workspace addresses can change in the workspace&rsquo;s settings.</>}
      >
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="sm"><a href={`${apexUrl}/login`}>Sign in</a></Button>
          <Button asChild size="sm" variant="secondary"><a href={apexUrl}>Go to UserTasks</a></Button>
        </div>
      </EmptyState>
    </div>
  )
}

/** Signed in, but not a member of the workspace at this address. */
export function WorkspaceNoAccessView({ workspaceName, host, email, switchHref, loginHref }: { workspaceName: string; host: string; email: string | null; switchHref: string; loginHref: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-workspace-no-access>
      <EmptyState
        size="lg"
        icon={Lock}
        title={<>You don&rsquo;t have access to {workspaceName}</>}
        description={
          <>
            {email ? <>You&rsquo;re signed in as <span className="font-medium text-fg">{email}</span>, which isn&rsquo;t a member of the workspace at </> : <>Your account isn&rsquo;t a member of the workspace at </>}
            <span className="font-medium text-fg">{host}</span>. Ask one of its admins to invite you, or sign in with another account.
          </>
        }
      >
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="sm"><a href={switchHref}>Go to my workspace</a></Button>
          <SwitchAccountButton loginHref={loginHref} />
        </div>
      </EmptyState>
    </div>
  )
}
