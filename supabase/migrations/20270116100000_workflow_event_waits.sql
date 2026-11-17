-- Event waits of extension workflow steps (ctx.runs.waitFor / ctx.runs.resume,
-- lib/extensions/event-waits.ts): one row per waiting step. The extension's
-- trigger pipeline resumes waiters by (tenant, extension, key, match key) —
-- one indexed lookup, no polling per run. Rows go when the step resumes, the
-- run is cancelled, or a resume finds the run no longer waiting.
create table if not exists public.workflow_event_waits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  workflow_id uuid references public.workflows(id) on delete cascade,
  node_id text not null,
  event_id text not null,
  extension_id text not null,
  wait_key text not null,
  match_key text not null,
  match jsonb not null default '{}'::jsonb,
  conditions jsonb,
  description text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workflow_event_waits_lookup on public.workflow_event_waits (tenant_id, extension_id, wait_key, match_key);
create index if not exists workflow_event_waits_run on public.workflow_event_waits (run_id, node_id);
create index if not exists workflow_event_waits_event on public.workflow_event_waits (event_id);

alter table public.workflow_event_waits enable row level security;

-- Read: members of the workspace who can see runs (the process view); writes: service role only.
drop policy if exists workflow_event_waits_read on public.workflow_event_waits;
create policy workflow_event_waits_read on public.workflow_event_waits
  for select using (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

revoke insert, update, delete on public.workflow_event_waits from anon, authenticated;
