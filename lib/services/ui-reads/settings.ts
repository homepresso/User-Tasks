import { z } from 'zod'
import { getDb, ServiceError } from '../context'
import { hasExtensibilityFeatureAccess } from '@/lib/extensibility-access'
import type { Database } from '@/lib/database.types'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'
import { resolveStorageUrl } from '@/lib/storage/refs'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/**
 * Settings pages (branding, API keys, invitations, MCP, webhook dead letters),
 * Team and Extensibility pages, and the shared people pickers (memberships,
 * team members, tenant users).
 */

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

export type MembershipWithTenant = Row<'user_memberships'> & {
  tenant: Pick<Row<'tenants'>, 'id' | 'name' | 'slug' | 'branding'>
}
export type TeamMemberRow = Row<'user_teams'> & {
  user: Pick<Row<'users'>, 'id' | 'display_name' | 'email' | 'avatar_url' | 'role'>
}
export type TenantUser = Pick<Row<'users'>, 'id' | 'display_name' | 'email' | 'avatar_url' | 'role'>

export const reads = {
  /** Settings landing page: the tenant's logo. */
  'settings.branding': defineRead({
    args: z.object({ tenantId: id }),
    run: async (ctx, { tenantId }) => {
      const { data } = await (getDb(ctx) as any).from('tenants').select('id, branding').eq('id', tenantId).maybeSingle()
      return { logoUrl: resolveStorageUrl(((data?.branding as any)?.logo_url ?? null) as string | null) }
    },
  }),

  /** API keys page: keys plus the scope pickers the key editor offers. */
  'settings.apiKeysPage': defineRead({
    args: NO_ARGS,
    perm: 'settings.manage_api_keys',
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [apiKeys, workflowSources, webhooks, workflows, tables, users] = await Promise.all([
        db.from('api_keys').select('*').order('created_at', { ascending: false }),
        db.from('workflow_sources').select('id, display_name, engine_type').order('display_name'),
        db.from('workflow_webhooks').select('id, slug, workflow:workflows(name)').order('slug'),
        db.from('workflows').select('id, name, is_active').order('name'),
        db.from('custom_tables').select('id, name, slug').order('name'),
        db.from('users').select('id, display_name, email').order('display_name'),
      ])
      return {
        apiKeys: (apiKeys.data ?? []) as Row<'api_keys'>[],
        workflowSources: (workflowSources.data ?? []) as any[],
        webhooks: (webhooks.data ?? []) as any[],
        workflows: (workflows.data ?? []) as any[],
        tables: (tables.data ?? []) as any[],
        users: (users.data ?? []) as any[],
      }
    },
  }),

  /** Pending invitations with the inviter's name. */
  'settings.invitations': defineRead({
    args: NO_ARGS,
    perm: 'team.invite',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('invitations')
        .select('*, inviter:users!invitations_invited_by_fkey(display_name)')
        .is('accepted_at', null)
        .order('created_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  /** MCP settings: recent active keys, tenant slug, MCP servers (tool categories come from /api/mcp). */
  'settings.mcp': defineRead({
    args: z.object({ tenantId: id }),
    perm: 'settings.view',
    run: async (ctx, { tenantId }) => {
      const db = getDb(ctx) as any
      const [apiKeys, tenant, mcpServers] = await Promise.all([
        db.from('api_keys')
          .select('id, name, key_prefix, is_revoked, created_at')
          .eq('is_revoked', false)
          .order('created_at', { ascending: false })
          .limit(5),
        db.from('tenants').select('slug').eq('id', tenantId).maybeSingle(),
        db.from('mcp_servers').select('*').order('created_at', { ascending: false }),
      ])
      return {
        apiKeys: (apiKeys.data ?? []) as any[],
        tenantSlug: ((tenant.data as any)?.slug ?? '') as string,
        mcpServers: (mcpServers.data ?? []) as any[],
      }
    },
  }),

  /** Webhook delivery: latest 50 failed deliveries. */
  'settings.deadLetters': defineRead({
    args: NO_ARGS,
    perm: 'settings.manage_webhooks',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('dead_letter_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      return (data ?? []) as Row<'dead_letter_events'>[]
    },
  }),

  /** Team page: teams with member counts. */
  'settings.teams': defineRead({
    args: NO_ARGS,
    perm: 'team.view_members',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('teams')
        .select('*, member_count:user_teams(count)')
        .order('name')
      return (data ?? []) as any[]
    },
  }),

  /** Extensibility page: custom workflow activities. Same gate as the page (incl. its compatibility path). */
  'settings.workflowActivities': defineRead({
    args: NO_ARGS,
    perm: ['extensibility.view', 'settings.edit'],
    run: async (ctx) => {
      if (ctx.permissions !== null && !hasExtensibilityFeatureAccess(ctx.permissions)) {
        throw ServiceError.forbidden("Forbidden: you lack the 'extensibility.view' permission")
      }
      const { data } = await (getDb(ctx) as any).from('custom_workflow_activities')
        .select('*')
        .order('updated_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  /** The signed-in user's active workspaces (org switcher). */
  'settings.memberships': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      if (!ctx.actorId) return [] as MembershipWithTenant[]
      // RLS also shows co-members' rows in shared workspaces; the switcher wants only mine.
      const rows = (check(await (getDb(ctx) as any).from('user_memberships')
        .select('*, tenant:tenants(id, name, slug, branding)')
        .eq('user_id', ctx.actorId)
        .eq('is_active', true)
        .order('is_home', { ascending: false })) ?? []) as MembershipWithTenant[]
      // A membership whose workspace isn't readable embeds `tenant: null`; skip it.
      return rows.filter((m) => m.tenant !== null)
    },
  }),

  /** A team's members (team page, assignee pickers). */
  'settings.teamMembers': defineRead({
    args: z.object({ teamId: id }),
    run: async (ctx, { teamId }) => (check(await (getDb(ctx) as any).from('user_teams')
      .select('*, user:users(id, display_name, email, avatar_url, role)')
      .eq('team_id', teamId)) ?? []) as TeamMemberRow[],
  }),

  /** Team page: every member's manager in the current workspace. */
  'settings.reportingLines': defineRead({
    args: NO_ARGS,
    perm: 'team.view_members',
    run: async (ctx) => {
      const { listReportingLines } = await import('../manager-tasks')
      return listReportingLines(ctx)
    },
  }),

  /** Active users visible to the signed-in user (user and assignee pickers). */
  'settings.tenantUsers': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (check(await (getDb(ctx) as any).from('users')
      .select('id, display_name, email, avatar_url, role')
      .is('deleted_at', null)
      .order('display_name')) ?? []) as TenantUser[],
  }),
} satisfies Record<string, UiRead<any, any>>
