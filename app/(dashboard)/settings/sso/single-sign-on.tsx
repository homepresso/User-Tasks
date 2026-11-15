"use client"

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { getWorkspaceSsoAction, setWorkspaceSsoAction } from '@/app/actions/workspace-sso'
import { errText, Field, OptionCheckbox, Select, unwrap } from './shared'

/**
 * Settings → SSO & Directory → Single sign-on: the workspace's automatic
 * sign-in (lib/providers/auth/sso/auto.ts). The identity providers
 * themselves are instance settings (auth.sso_providers / Supabase Auth).
 */
export function SingleSignOnCard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({
    queryKey: ['workspace-sso'],
    queryFn: () => unwrap(getWorkspaceSsoAction()),
  })
  const save = useMutation({
    mutationFn: (patch: { auto_sign_in?: boolean; sso_only?: boolean; idp?: string | null }) => unwrap(setWorkspaceSsoAction(patch)),
    onSuccess: (next) => queryClient.setQueryData(['workspace-sso'], next),
  })

  const providers = data?.providers ?? []
  const effective = providers.find((p) => p.id === data?.effective_idp) ?? null
  const disabled = !canEdit || save.isPending || !data

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <ShieldCheck size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Single sign-on
      </h3>
      <p className="text-xs text-fg-muted">
        Sign-in is handled by the instance&apos;s auth provider (Supabase Auth, or built-in auth with OIDC / SAML
        identity providers). Directory sync here handles provisioning — synced users sign in with their work
        account, and with built-in auth an LDAP connection can also let them sign in with their directory password.
      </p>

      {isLoading && !data ? <p className="text-xs mt-3 text-fg-muted">Loading…</p> : null}
      {error ? <InlineNotice tone="danger" className="mt-3" message={errText(error)} /> : null}

      {data ? (
        <div className="mt-4 space-y-3">
          <OptionCheckbox
            label="Sign in automatically with SSO when UserTasks is opened from another system"
            hint="E.g. the UserTasks button in SharePoint or a portal link: no sign-in page. The identity provider signs people in without asking when it can (Windows sign-in, an existing session), otherwise shows its own sign-in. UserTasks never takes the user name the other system sends."
            checked={data.auto_sign_in}
            disabled={disabled}
            onChange={(auto_sign_in) => save.mutate({ auto_sign_in })}
          />
          <OptionCheckbox
            label="SSO only: skip the sign-in page"
            hint={data.instance_sso_only
              ? 'On for every workspace of this instance (AUTH_SSO_ONLY).'
              : 'The sign-in page goes straight to the identity provider. It still shows after signing out, after an error, and at /login?local=1 (for administrators when the identity provider is down).'}
            checked={data.sso_only || data.instance_sso_only}
            disabled={disabled || data.instance_sso_only}
            onChange={(sso_only) => save.mutate({ sso_only })}
          />
          <div className="max-w-sm">
            <Field
              label="Identity provider"
              hint={effective ? `In effect: ${effective.name}.` : providers.length ? 'None applies yet: choose one.' : 'This instance has no identity provider that can sign in automatically.'}
            >
              <Select
                value={data.idp ?? ''}
                disabled={disabled || providers.length === 0}
                onChange={(value) => save.mutate({ idp: value || null })}
                options={[{ value: '', label: 'Automatic' }, ...providers.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` }))]}
              />
            </Field>
          </div>
          {save.error ? <InlineNotice tone="danger" message={errText(save.error)} /> : null}
        </div>
      ) : null}

      <p className="text-xs mt-4 text-fg-muted">
        Microsoft note: on the app registration used for <em>sign-in</em>, add the <code>email</code> and{' '}
        <code>xms_edov</code> optional claims so Microsoft reports verified emails — that is what links a
        sign-in to the account provisioned by directory sync instead of creating a duplicate.
      </p>
    </Card>
  )
}
