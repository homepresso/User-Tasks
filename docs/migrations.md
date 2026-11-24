# Database migrations

`supabase/migrations/` builds the whole UserTasks schema from an empty
Supabase database — or, through `usertasks-admin db migrate`, from an empty
plain PostgreSQL database (see
[Infrastructure: Database](infrastructure.md#database)):

**Upgrades never remove data.** Every migration after `20261029000000` is additive: nothing that runs while it is applied drops a table, column or schema, or deletes or truncates rows (housekeeping inside functions runs later and is reviewed as code). `__tests__/migration-safety.test.ts` enforces this on every build. A statement that really must remove something needs `-- migration-safety: reviewed — <reason>` on a line above it, and the release notes must say so.

| Migration | Contents |
|-----------|----------|
| `20261014000000_compat_bootstrap.sql` | what Supabase ships and the chain assumes, created only on non-Supabase PostgreSQL: roles `anon` / `authenticated` / `service_role` / `authenticator`, `auth.uid()` / `role()` / `jwt()` / `email()` over `request.jwt.claims`, a minimal `auth.users`, the `extensions` schema with `pgcrypto` (or a fallback `gen_random_bytes`). A no-op on Supabase |
| `20261015000000_baseline.sql` | `supabase db dump -s public,app_cron` of production on 2026-10-15 (still includes the retired feature tables) |
| `20261015000001_auth_triggers.sql` | `on_auth_user_created` trigger on `auth.users` |
| `20261015000002_cron_jobs.sql` | pg_cron + pg_net, the original 13 `usertasks-*` jobs (re-runnable; superseded by `20261103100000_cron_consolidation.sql`) |
| `20261015000003_storage_realtime.sql` | public `task-files` and `logos` buckets + policies, Realtime publication tables |
| `20261015000004_strip_back.sql` | drops the retired features (cases, channels, messages, forms/pages, kanban, documents, apps, metering, …) |
| `20261023000000_oauth_first_party_cli.sql` | `oauth_clients.is_first_party`, relaxed tenant-bound CHECK, seeds the global `usertasks-cli` OAuth client (browser login for the CLI) |
| `20261024000000_event_stream.sql` | `event_stream` outbox, normalization triggers on the source tables, `purge_event_stream`, `workflow_logs (tenant_id, created_at)` index |
| `20261024000001_observability_permission.sql` | `observability.view` for Owner/Admin roles, `events:read` scope for the CLI client |
| `20261024000002_log_destinations.sql` | `log_destinations` table (service role only) |
| `20261024000003_log_shipper.sql` | `claim_next_log_destination`, purge marks, `usertasks-ship-events` pg_cron job, queue worker RPCs service-role only |
| `20261024000004_enqueue_workflow_tenant_check.sql` | tenant checks in `enqueue_workflow` and other exposed SECURITY DEFINER functions |
| `20261025000000_record_workflow_run.sql` | `record_workflow_run` RPC (atomic run count / stats) |
| `20261026000000_queue_dispatch.sql` | `claim_jobs` / `release_jobs` batch claim, `idx_queue_claim`, slim `complete_job`, `enqueue_workflow_batch`, `purge_queue_history` |
| `20261027000000_rls_initplan.sql` | RLS policies rewritten to evaluate auth/tenant helpers once per statement (initplans), redundant policies dropped, `workflow_logs` insert limited to member tenants, `user_memberships` recursion fixed, `search_path` on SECURITY DEFINER functions, `create_task_with_subtasks` assignee check |
| `20261027000001_perf_indexes.sql` | indexes for task/run/log lists, assignees and trigram title search (`pg_trgm`); duplicate indexes dropped |
| `20261028000000_perf_api_reports.sql` | `workflows.node_count` (trigger-maintained), `tag_definitions` insert policy, run-report RPCs |
| `20261029000000_drop_integration_endpoints.sql` | drops the legacy `integration_endpoints` table and the unused `integration_references.endpoint_id` column |
| `20261103100000_cron_consolidation.sql` | replaces every `usertasks-*` pg_cron job with `usertasks-tick` (every minute, `/api/cron/tick`) and `usertasks-cron-housekeeping` (daily, pure SQL); tick lease/history tables in `app_cron`, `cron_tick_*` RPCs; purges `cron.job_run_details` older than 2 days |
| `20261103400000_packages.sql` | `packages`, `package_versions`, `package_installs`, `package_install_assets`, `package_signing_keys` (service role only); `packages.view` / `packages.manage` / `packages.install` for Owner/Admin/Manager (seed_tenant_roles + existing roles); `packages:read` / `packages:write` scopes for the CLI client |
| `20261105000000_realtime_notify.sql` | `app_realtime` schema: statement-level NOTIFY triggers (`usertasks_realtime`) on the realtime tables for the SSE realtime provider, idle unless a listener checked in (`mark_listening`); the Supabase publication is unchanged |
| `20261109500000_instance_housekeeping.sql` | instance housekeeping: `housekeeping.*` instance settings (key check), `app_cron.run_housekeeping()` (batched purge of `cron.job_run_details`, `net._http_response`, expired `app_cache.entries` / `app_auth` rows), `app_cron.housekeeping_runs`, `instance_housekeeping_run` / `instance_housekeeping_status` RPCs (service role only); pg_cron `usertasks-housekeeping` (every 15 min) and `usertasks-cron-housekeeping` now the daily forced pass; one bounded pass at apply time |
| `20261109000000_directory_sync_providers.sql` | directory sync providers `ldap` / `google` / `scim` on `directory_links` / `directory_sync_runs` (+ run `mode`), `scim_tokens`, `scim_resources`, `scim_group_members` (service role only), `cron_tick_probe()` counts LDAP / Google connectors |
| `20261115000000_forms.sql` | reusable task forms: `forms`, `form_versions` (immutable snapshots, published workflows pin one), `form_themes` (members read their workspace's rows; service-role writes), permissions `forms.view` / `forms.edit` / `forms.delete` (all for Owner/Admin/Manager, view for Member/Viewer; `seed_tenant_roles` updated) |
| `20261116000000_form_submissions.sql` | form buttons and headers: `forms.buttons` / `forms.header` / `forms.submission_retention_days` (and on `form_versions`); `form_submissions` (submitters read their own, `forms.edit` reads all; service-role writes; an event-stream trigger emits `form.submitted`); permission `forms.submit` for every system role (`seed_tenant_roles` updated) |
| `20261117000000_community_gallery.sql` | community gallery: `gallery_submissions` (moderation queue; a user reads their own), `community_packages` / `community_package_versions` (anyone reads listed rows), `gallery_abuse_reports` (moderators via the service only); no client writes; `gallery_record_download()` (service role); private `gallery-community` storage bucket. Only used where the community gallery is enabled (usertasks.com, or `GALLERY_COMMUNITY=on`) |
| `20261121000000_instance_doctor_snapshot.sql` | `instance_doctor_snapshot()` (service role only, SECURITY DEFINER, read only): the facts `usertasks-admin doctor` / Settings → Infrastructure check in the database (version, roles, extensions, newest migration, `supabase_realtime` table count, `usertasks-*` pg_cron jobs without commands, whether the Vault secrets exist, scheduler leader, last tick, failing jobs, encrypted-setting count), so the Supabase provider needs no `DATABASE_URL` for them |
| `20261201000000_form_controls.sql` | custom form controls (web components): `form_controls` (one per tag per workspace: name, icon, latest version, `enabled`, `trusted` — instance admins only, `approved_hosts`) and `form_control_versions` (immutable: manifest, ES module snapshot, SHA-256, size, source / URL, signature record). Members read their workspace's rows; service-role writes. Additive and idempotent; the app works without it until someone opens Extensibility → Form controls |
| `20261202000000_form_control_bundle_size.sql` | custom form controls: modules up to 2 MB (the `form_control_versions.bundle` CHECK widened from 1 MB; the official PDF viewer bundles pdf.js with its worker). Additive and idempotent; before it is applied, uploads and gallery installs of 1-2 MB controls fail with a database error |
| `20261203000000_custom_actions.sql` | custom workflow actions: `custom_workflow_activities` gains `enabled` (kill switch), `runtime` (`module` / `legacy`), `approved_hosts`, `data_grants`, `sha256`, `signature`, `origin`; `custom_workflow_activity_versions` (immutable: manifest, module snapshot, SHA-256, size, origin, signature); `custom_workflow_activity_secrets` (app-encrypted values of declared secrets; no client grants — service role only). Members read their workspace's actions and versions; client writes to `custom_workflow_activities` are revoked (the old `tenant_isolation` policy let any member write) — the server writes after its permission checks. Additive and idempotent; apply it before deploying the code (until then Extensibility → Workflow actions and custom action steps fail with a database error) |
| `20261206000000_esign.sql` | e-signature connectors (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow, BoldSign): `esign_envelopes` (send ledger per integration + client reference — a retried send returns the envelope already sent), `esign_waits` (Wait for Signature steps: the paused run's event, envelope, next poll, deadline, lease), `esign_events` (verified webhook delivery keys for replay protection and once-only triggers), all RLS on with no client grants — service role only; `claim_due_esign_waits()` (SKIP LOCKED, service role only); `cron_tick_probe()` gains `esign_waits` for the every-minute `esign-poll` job. Additive and idempotent; apply it before deploying the code (until then Send for Signature runs without the idempotency ledger and Wait for Signature steps fail to register) |
| `20261222000000_task_attachments.sql` | task attachments: `task_attachments` (files on a task's Attachments tab: name, free-text type, description, storage key in the private `form-files` bucket tied to the row by a CHECK, file name, verified MIME type, size, SHA-256, uploader / run, `uploading` / `ready`, soft delete; `tenant_id` and `form_id` follow the task by trigger; a held form blocks soft deletes by trigger), RLS (readers of the task SELECT; work access on the open task INSERTs as `uploading` only; soft delete by the uploader or `tasks.delete`; no DELETE) via `task_attachment_access(task_id)` (SECURITY DEFINER); `task_attachment_purges` (stored objects of hard-deleted rows for the cleanup job; service role only); lifecycle event types `attachment_added` / `attachment_deleted`. Additive and idempotent; apply it before deploying the code (until then the Attachments tab and the Add Task Attachment step fail with a database error) |
| `20261223000000_workspace_subdomains.sql` | workspace addresses and friendly form links: `tenants.subdomain` (a–z, 0–9, hyphens, 3–40, unique among live workspaces, reserved names refused; backfilled from the slug where valid, and defaulted from it for new workspaces), `tenant_subdomain_history` (retired addresses redirect for a year), `forms.system_name` (unique per workspace, defaulted and backfilled from the form name), `form_system_name_history` (renamed forms redirect); both history tables RLS on with no client grants — service role only. Additive and idempotent; apply it before deploying the code (until then Settings → General and form Settings fail to load the address and system name) |
| `20261226100000_governance_audit.sql` | governance audit ([report](governance/audit-2026-11.md)): system roles only — Viewer and Member lose `workflows.view` / `forms.view`, Owner / Admin / Manager / Member gain `workflows.view_queue` (new; `workflows.view_runs` implies it in the app), `seed_tenant_roles` updated; custom roles untouched. `rls_perm_tenant_ids(text[])` helper and permission-gated INSERT / UPDATE / DELETE policies on `roles`, `user_roles`, `api_keys` (SELECT: key managers or your own keys), `invitations` (SELECT too: `team.invite`), `oauth_clients`, `object_permissions`, `tenant_connectors`, `deletion_queue`, `directory_links` / `directory_sync_runs`, GitHub sync templates / deployments / runs, `workflows`, `workflow_versions`, `workflow_webhooks`, `workflow_sources`, `custom_tables`, `custom_table_rows`, `integrations` (+ references, objects, object sources), `decision_tables`, `email_templates`, `retention_policies`, `mcp_servers`, `teams` / `user_teams`, `workflow_logs` deletes; `oauth_tokens` / `oauth_authorization_codes` / `oauth_connect_states` service role only; `object_audit_log` / `integration_call_logs` append-only; `get_user_permissions` not executable by anon. Additive and idempotent (short per-table locks, `lock_timeout = 5s` — re-run on timeout). **Apply it before deploying the code**: the code checks `workflows.view_queue` for the queue and run lists, which existing system roles only hold once it has run (`workflows.view_runs` still implies it, so Owner / Admin / Manager keep the queue either way) |
| `20261224000000_org_structure.sql` | organization structure: people attributes on `user_memberships` (`job_title`, `department`, `location`, `employee_id`, `cost_center`, `profile_source` `manual` / `directory`, `profile_updated_at`); `org_units` (company / division / department / unit or custom kind, parent in the same workspace with loops refused by trigger, head, `source` + `external_id` unique per workspace for imports, `detached`) and `org_unit_members` (role, one primary unit per person, source); `projects` (key unique per workspace ignoring case, status, owner, sponsor, owning team, org unit, dates, colour, `archived_at`), `project_members` (role, allocation %), `project_teams`; `teams.lead_user_id` / `org_unit_id` / `colour` / `kind` and a team-loop trigger; member tables' `tenant_id` follows the parent row; a departing member leaves units and projects. RLS: members read their workspace's rows; writes need `org.manage` / `projects.manage`. Permissions `org.view` / `projects.view` (every system role and custom roles with `team.view_members`), `org.manage` (Owner / Admin), `projects.manage` (Owner / Admin / Manager), `seed_tenant_roles` updated. Additive and idempotent; apply it before deploying the code (until then the Organization page, `/api/v1/org/*`, `/api/v1/projects/*`, team saves and directory sync with the org switches fail with a database error) |
| `20261226000000_task_followers.sql` | Task tracker → Following: `task_followers` (a person's followed tasks; `tenant_id` follows the task; RLS: own rows in member workspaces, INSERT only for a task they can see), `task_view_access(task, user)` (the "can see this task" rule: assignee, collaborator, team member of an unassigned team task, manager of an assignee, assigner, `tasks.view_all` / `tasks.manage_queue`; end users can only ask about themselves), `list_followed_tasks(user, tenant)` (follows whose task is not deleted and still visible). Additive and idempotent; until applied the Following tab and follow buttons report a database error |
| `20261228000000_followed_run_tasks.sql` | Task tracker → Following via runs: `list_followed_run_tasks(user, tenant, include_closed)` — the tasks of the runs a person follows (`run_followers`) that they may still see (`can_view_run_progress`); open tasks of live runs unless `include_closed`. Additive and idempotent; until applied the Following tab lists directly followed tasks only |
| `20261221000000_theme_defaults_refresh.sql` | UI foundations: stored `workspace_themes` rows (full themes only; stubs and form themes untouched) that still hold the untouched old defaults are refreshed — Google DM Sans + Space Mono → Inter + JetBrains Mono; display (Fraunces) headings → sans on Gallery / Atelier / Noir; Gallery / Atelier dark palette that still equals the light one → the new Noir-derived dark palette. The previous theme of each changed row is kept in `workspace_theme_refresh_backup` (service role only; rollback statement in the file). Additive and idempotent; safe before or after the code (the code renders either) |
| `20261216000000_custom_reference_writes.sql` | custom reference writes: `custom_reference_writes`, the idempotency ledger of Create / Execute references with an idempotency key (tenant, reference, SHA-256 of the key; state, status and truncated result kept 24 hours; unique per key), and `purge_custom_reference_writes()` (rows older than 7 days). RLS on with no client grants — service role only. Additive and idempotent; until it is applied, writes run without the ledger (the key is still sent to the API as a header) |
| `20261213000000_forms_governance.sql` | forms in governance: `forms.retention_policy_id` (FK, `ON DELETE SET NULL`) / `retention_applied_at` — the policy governing the form's submissions — and the legal hold (`legal_hold`, `legal_hold_reason` ≤ 500, `legal_hold_at`, `legal_hold_by`); partial index `idx_forms_retention_policy`; `retention_policies.applies_to` allows `forms`, `retention_review_events` / `retention_execution_events` `target_type` allow `form` (each CHECK is read from the live constraint and added to, keeping values other migrations allowed). No new tables or policies. Additive and idempotent; apply it before deploying the code (until then assigning a policy to a form, legal holds and the Governance → Retention forms list fail with a database error, and the Keep submissions cleanup skips forms) |
| `20261209000000_available_forms.sql` | Available forms: `forms.available_in_menu` (not versioned) and `list_available_forms(p_tenant_id, p_user_id)` (SECURITY INVOKER: available forms the person holds `forms.submit` for and has an explicit `object_permissions` grant on — directly, through a team or a role; signed-in callers only read their own menu; anon has no EXECUTE); `object_permissions.object_type` allows `form` again; the `NULLS NOT DISTINCT` unique constraints (one grant row per object) replaced by partial unique indexes (one grant per grantee); partial index `idx_forms_available_in_menu` |
| `20261127000000_global_search_indexes.sql` | header search box: `pg_trgm` GIN indexes on `workflow_runs.title`, `form_submissions.form_name` and `form_files.name` for the ILIKE name searches (runs, submissions and files sections). Adds indexes only and is re-runnable; on a large database build them `CONCURRENTLY` first (same names). The code works without it (searches of those three tables are just slower on big workspaces) |
| `20261126000000_media_jobs.sql` | Media steps: `media_jobs` (background jobs of long Transcribe / Analyze Video / Redact Video / Media Utilities steps and provider jobs being polled: the step's resolved settings with file references — never media bytes or secrets — resumable `state`, `run_after`, `deadline_at`, lease; RLS on, no client grants — service role only), `claim_next_media_job()` (SKIP LOCKED, service role only), `cron_tick_probe()` gains `media_jobs` for the every-minute `process-media` job. Adds objects only; apply it before deploying the code (saved runs of a long media step fail to queue until it is applied; short media runs inline either way) |
| `20261124000000_agents_decisions.sql` | AI agents: per-table data grants — `agents.output_config.data_access` (and every `agent_versions.snapshot`) rewritten to the explicit shape: no `data_access` or `mode: all` → `{mode: all, legacy: true}` (unchanged access: read / insert / update every table), `mode: selected` → one grant per listed table with read / insert / update (new agents get none); run records restricted — `agent_runs`, `agent_eval_runs`, `agent_queue` SELECT need `agents.view` in the row's workspace, or being the run's `actor_id` / new `initiated_by` (runs) or `created_by` (eval runs, queue jobs); the `agent_runs` realtime NOTIFY trigger carries `actor_id` / `initiated_by`; cost — `agent_runs.cost_amount` / `cost_currency` / `cost_status` (`priced` / `unknown`) / `price` (the price used), `agent_eval_runs.cost`, `agent_cost_settings` (workspace price overrides and budgets; members read, service-role writes), `agent_usage_totals()` (service role only), index `agent_runs (tenant_id, started_at)`; `agent.run.*` events carry the cost. Apply it before deploying the code (the code also writes runs without the new columns until it is applied) |
| `20261123000000_infra_switch_lease.sql` | Settings → Infrastructure without `DATABASE_URL`: `app_switch.lease` (one-row lease in a private schema, no grants) with `instance_switch_lease_acquire` / `instance_switch_lease_release` / `instance_switch_busy` (service role only, SECURITY DEFINER) so config-only switches, settings edits and rollbacks over the service-role API take turns with `usertasks-admin` (which holds the session advisory lock); `instance_provider_switches.area` may be `instance` (audit rows for the cloud lock, `instance.allow_ui_switching`) |
| `20261122000000_agents_product.sql` | AI agents: INSERT / UPDATE / DELETE on `agents`, `agent_runs`, `agent_queue` revoked from anon / authenticated (the server writes after its permission checks; reads unchanged); `agents.version`; `agent_versions` (a snapshot per saved version); `agent_runs.steps` (step trace), `files`, `agent_version`, `approval_event_id`, `eval_run_id`, index `(agent_id, started_at)`; `agent_queue.kind` (`run` / `resume`), `resume_run_id`, `options`; `agent_eval_cases`, `agent_eval_runs` (members read their workspace's rows; service-role writes) |
| `20261120000000_form_files.sql` | form attachments: `form_files` (uploaded files of Attachments fields and start-form inputs: storage key, verified type, checksum, uploader, upload context form / task / start / test, uploading / pending / bound / orphaned; FKs to tasks / form submissions / forms / workflows / workflow runs set NULL on delete; RLS on, no client grants — service role only); private `form-files` storage bucket (Supabase Storage only) |
| `20261114000000_user_jobs.sql` | background jobs: `user_jobs` (owner reads own jobs, `settings.edit` reads the workspace's; service-role writes), `user_jobs_claim` / `user_jobs_actor` RPCs (service role only), `notifications.job_id`, realtime (NOTIFY triggers + `supabase_realtime` publication), private `job-results` storage bucket (Supabase Storage only) |
| `20261129000000_workflow_run_variables.sql` | `workflow_runs.variables` (nullable jsonb): the bounded, redacted copy of a run's variables the engine writes when the run completes, fails or pauses — workflow variable columns in reports (`vars.*`). Adds a column only; safe before or after the code. No backfill (older runs show blanks) |
| `20261113000000_package_events.sql` | `package_events` (package history: install / upgrade / reconfigure / uninstall incl. failed attempts, applied plan; service role only), backfilled from `object_audit_log` package_install rows and current `package_installs` |
| `20270112000000_extension_framework.sql` | extension framework (Settings → Extensions): `instance_extensions` (per-instance extension state, settings, encrypted secrets; service role only), `tenant_extensions` (per-workspace enable / disable, settings, encrypted secrets; members read their current workspace's rows, service-role writes), `extension_trigger_dedupe` and `extension_event_cursors` (service role only), `notifications.href`, and `supabase_migrations.usertasks_extension_migrations` (extension migration history). Additive and idempotent; the public build never reads these tables. Independent of the licensing migration below (either order works) |
| `20270112000100_licensing.sql` | paid-extension licensing ([licensing.md](licensing.md)): `tenant_entitlements` (workspace entitlements to paid extensions: features, numeric limits such as `sharepoint.farms`, status, source `admin` / `trial` / `stripe` / `licence`, dates; one row per workspace and extension; members read their current workspace's rows, service-role writes), `licence_events` (instance-level licence audit trail; service role only), and the `instance.id` instance setting (seeded once, never overwritten). Installed licence files live in `instance_settings` (`instance.licences`). Additive and idempotent; safe before or after the code (until applied: no cloud entitlements, licence events only in the server log) |
| `20270113100000_directory_sources.sql` | directory sources contributed by extensions (lib/directory-sync/sources.ts): `directory_sources` (per-workspace sync state of a source `ext.<id>.<key>`) and `directory_entries` (the people a source lists, their match keys, claims and source groups; pending until first sign-in) — both service role only; `teams.source` / `source_label` (teams kept by a source are read-only); the `directory_links` / `directory_sync_runs` provider checks accept `ext.<id>.<key>`. Additive and idempotent; safe before or after the code (until applied, sources cannot sync and teams are read without the new columns) |
| `20270114000000_workflow_run_facts.sql` | multi-agent workflows (docs: AI agents → Multi-agent workflows): `workflow_run_facts` — the shared blackboard of a workflow run's agents, one row per (run, key) upserted atomically (last writer wins per key, writer and time recorded), so Run Agent steps running at the same time (parallel branches, inline or queued) see each other's facts; deleted with the run; members read their workspaces' rows, service-role writes. Additive and idempotent; safe before or after the code (until applied, facts are shared between steps through `agent_context` only, as before) |
| `20270114400000_provision_auth_user_in_workspace.sql` | `provision_auth_user_in(user, email, name, provider, workspace)`: the first SSO sign-in of someone an organisation brought in (the IdP's `defaultOrg`, or a directory source's pending entry) creates the account in that workspace, with no personal workspace. A new function only (service role). Additive and idempotent; safe before or after the code (until applied, those accounts get a personal workspace as before and their home is moved to the organisation) |
| `20270115000000_run_and_submission_stats.sql` | `workflow_run_stats(tenant, workflow_ids, since, until)` and `form_submission_stats(tenant, form_ids, since, until)` (service role only, SECURITY INVOKER, read only): run counts, avg / p95 duration of completed runs, runs per UTC day and runs running / waiting / queued now for a set of workflows; submission counts per form and per UTC day plus the last submission — the aggregates behind the extension SDK's `ctx.workflows.stats` and `ctx.forms.submissionStats`. Additive and idempotent; until it is applied those fall back to a bounded read |
| `20270115300000_task_reads.sql` | unread tasks: `tasks.routed_at` (when the task last reached its holders — created, assignee / team changed, or back to work from completed / cancelled / draft; kept by trigger `trg_tasks_routed_at`, added with a constant default so there is no table rewrite), `task_reads` (one row per person and task: `seen_at`; PK `(task_id, user_id)`, FKs cascade; `tenant_id` follows the task; RLS: own rows in member workspaces, INSERT / UPDATE only for a task they can see), `task_unread_ids(user, tenant, task_ids)` (the rule as one indexed query), `task_unread_count`, `mark_tasks_read`, `nav_task_counts` gains `unread`; indexes `idx_task_assignees_task_user` and `idx_tasks_team_unassigned_unread` (on a large live database, build them first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` as written in the file; the migration then skips them). On first apply the open tasks of their current holders are marked read (so an upgrade doesn't turn every task bold). Additive and idempotent; safe before or after the code (until applied, nothing shows as unread and the mark endpoints report a database error) |
| `20270116050000_team_origin.sql` | where a team comes from, for the source badge in the assignee pickers, the Teams page, `/api/v1/teams`, MCP and the CLI (lib/teams/origin.ts): `teams.origin` (`internal` by default — added with a constant default, so there is no table rewrite — or `active_directory`, `ldap`, `entra`, `okta`, `google`, `scim`, `sharepoint`, `extension`), `teams.external_id` (the group's id in that directory) and index `teams_tenant_origin_idx`. Backfilled from `teams.source` (extension directory sources; SharePoint by id or label) and from `directory_links` group rows of the built-in directory sync (LDAP counts as Active Directory when the connection uses the Active Directory flavour); everything else stays `internal`. RLS unchanged. Additive and idempotent; safe before or after the code (until applied, teams read their origin from `teams.source` or as Internal, and sync runs skip tagging) |
| `20270116080000_completed_task_search_indexes.sql` | server-side task search (lib/services/task-search.ts: the app's My tasks / Following "Completed" and "All" views and the embeddable task list): partial indexes `idx_tasks_actioned_completed` (`actioned_by, completed_at DESC, id` — the "completed by me" branch had no index) and `idx_tasks_assignee_completed` (`assignee_id, completed_at DESC, id` for completed rows — keyset pages in index order). Indexes only; re-runnable. On a large database create them with `CREATE INDEX CONCURRENTLY` first (same names) and this migration is then a no-op. Safe before or after the code (until applied, the completed views work but read more rows) |
| `20270116110000_data_table_views.sql` | Data grid views with per-column controls (lib/grid/column-model.ts, lib/services/data-table-views.ts): `custom_tables.views` (jsonb array, default `[]` — a constant default, so there is no table rewrite): per view the columns shown, each column's control (text, dropdown, autocomplete, multi-select, people, signature pad, file, currency, rich text, calculated…), its data binding (options from a data table or an API reference with filter, sort, value / display fields), editable / read-only, required and width, plus inline editing (all rows), add / delete rows and the page size. RLS unchanged (the table's own). Additive and idempotent. Apply before or after the code: until applied, the Data grid shows the built-in "All columns" view (read-only cells, as today), saving a view or an inline cell edit answers "apply migration 20270116110000", and config export leaves views out |
| `20270116120000_team_requests.sql` | team requests log (lib/contact/team-requests.ts `notifyTeam`, Settings → Requests for instance admins): `team_requests` (kind contact / feedback / docs_feedback / beta_signup / trial / other, title, summary, name, email, company, reply_to, url, `facts` jsonb, the escaped `detail_html` the ChirpMe notification carried, status new / in_progress / handled / spam, handled_by / handled_at, note, `delivery` jsonb with the ChirpMe and team email outcome; indexes on (status, created_at), (kind, created_at), created_at and lower(email)) and `team_request_events` (the audit trail of status and note changes). Instance level, RLS on with no policies and no grants to anon / authenticated: service role only. Additive and idempotent. Apply before or after the code: until applied, each request still goes to ChirpMe (the failed insert is logged) and Settings → Requests says the migration is missing |
| `20270117090000_licence_trials.sql` | self-serve 30-day trial licences issued by usertasks.com ([licensing.md](licensing.md), `POST /api/public/trials/sharepoint`): `licence_trials` (one row per trial: SKU, farm id, optional instance id, requester name / work email / email domain / company, source website or product, issue and expiry dates, the signed licence, terms accepted, a salted IP hash, e-mail / re-send times; unique per SKU + farm and per SKU + email domain; service role only, RLS on with no policies). Only usertasks.com (cloud) writes it; self-hosted installations never do. Additive and idempotent. Until applied the trial endpoint answers "Trials aren't available yet" |
| `20270119090000_data_table_grouping.sql` | Data table grouping and child records (lib/grid/grouping.ts, lib/services/data-table-grouping.ts): `custom_tables.child_relations` (jsonb array, default `[]`, a constant default so there is no table rewrite: `[{ id, table_id, lookup_column, label, roots_only }]`, rows of `table_id` linked to a row of this table by a lookup column); `data_table_row_matches` (the grid / API row filter), `data_table_row_groups` (group counts and sums by one or two columns over the whole filtered result) and `data_table_rows_page` (a filtered, searched, sorted page with the exact total). All three are SECURITY INVOKER, so the caller's RLS on `custom_table_rows` applies. EXECUTE is granted to authenticated and service_role, not anon. Additive and idempotent. You can apply it before or after the code: until it is applied, grid groups are counted from the newest 2,000 rows (the grid says so) and child records can't be saved ("apply migration 20270119090000") |
| `20270120090000_apps.sql` | App builder (lib/services/apps.ts, lib/services/app-access.ts): `apps` (slug unique per workspace, name, subtitle, description, icon, colour, `menu` jsonb, `settings` jsonb), `app_pages` (slug unique per app, title, icon, position, `layout` jsonb `{ widgets }`, `filters` jsonb), `app_audience` (user / team / role, `app_role` viewer or contributor) and `app_editors`; child rows take `tenant_id` from their app (trigger). `public.app_access(app)` (SECURITY DEFINER: edit = apps.manage or a named editor; view = apps.view + the audience names the caller, a team or a role of theirs). RLS: SELECT where app_access allows it (audience and editor lists: edit access only), current workspace or the unified view; SELECT is the only grant to authenticated (writes go through the service). Permissions `apps.view` (every role, existing ones included) and `apps.manage` (Owner, Admin, Manager; seed_tenant_roles re-created); `apps:read` / `apps:write` added to the usertasks-cli client. Additive and idempotent. Apply before the code: until it is applied, /apps and the Apps menu show no apps and the API answers "relation public.apps does not exist" (500) |
| `20270121150000_tag_styles.sql` | Tag colours (lib/services/tags.ts, lib/tags/palette.ts): `tag_styles` (tag name per workspace, unique case-insensitively through the generated `name_key`; `color` a palette token or NULL for the automatic colour — never hex; optional `description`), RLS: SELECT for members (current workspace or the unified view), INSERT / UPDATE / DELETE with `tags.manage` in the current workspace. Existing `tag_definitions` rows are copied in with each hex mapped to the nearest token (`tag_definitions` is kept, unused). `tag_key`, `tag_array_rename`, `tag_usage(tenant)` (tags in use by object type) and `tag_objects(tenant, tag, type, limit, offset)` (the objects carrying a tag, paged) — both SECURITY INVOKER, EXECUTE for authenticated and service_role, so RLS applies — and `rename_tag(tenant, from, to, actor)` (rename / merge across tasks, workflows, forms, integrations, references, agents and workflow activities plus the style) and `remove_tag(tenant, tag)` (remove from every object, drop the style), each one transaction, SECURITY DEFINER with EXECUTE for service_role only. Permission `tags.manage` (Owner, Admin, Manager; seed_tenant_roles re-created; existing system roles updated). Additive and idempotent. Apply before or after the code: until it is applied every tag shows its automatic colour and saving a colour answers "apply migration 20270121150000" (503) |
| `20270122100000_assistant_baseten.sql` | Settings → Agent: `assistant_settings.provider` also accepts `baseten` (the Agent's own provider list, lib/assistants/types.ts). The customer's own Baseten key, encrypted like every provider's. Additive and idempotent. Apply before or after the code: until it is applied, saving Baseten as the Agent's provider is refused by the database |
| `20270122150000_tags_everywhere.sql` | Tags on every object type (lib/services/object-tags.ts, lib/services/tags.ts): `tags text[] NOT NULL DEFAULT '{}'` plus a GIN index on `custom_tables` (data tables), `reports`, `decision_tables` (business rules), `email_templates`, `form_controls`, `apps` and `packages` (authored packages). RLS unchanged (tags are written through each object's own update service and edit permission). Re-creates `tag_usage` / `tag_objects` (SECURITY INVOKER, EXECUTE for authenticated and service_role; every new type except `packages`, which has no client grant and is counted by the service behind `packages.view`) and `rename_tag` / `remove_tag` (SECURITY DEFINER, service_role only; every type) from 20270121150000, only adding the new types. Additive and idempotent; adding a column with a constant default is metadata-only. Apply before or after the code: until it is applied these objects read as untagged, saving real tags on them answers "apply migration 20270122150000" (503) and list `tag` filters on them do too. Apply after 20270121150000 |
| `20270123090000_app_drafts.sql` | App drafts and publishing (lib/services/app-versions.ts, lib/apps/versions.ts): the `apps` / `app_pages` rows become the working draft; `apps.published_version` / `published_at` / `published_by` (the live version; NULL = never published, editors only), `has_draft_changes`, `draft_updated_at` / `draft_updated_by`; `app_versions` (immutable published snapshots: version per app, `snapshot` jsonb of the header, menu, settings and pages, card `summary`, `note`, `source` publish / initial / import, publisher; `tenant_id` from the app by trigger; UPDATE refused by trigger). Every existing app is snapshotted and published as version 1 (nothing changes for anyone). `app_published_version(app)` (SECURITY DEFINER). RLS: `apps` / `app_pages` SELECT now for the app's editors only (`app_access = 'edit'`); `app_versions` SELECT for editors (every version) and the audience (the published version only); SELECT is the only client grant. Slug, audience and editors are not versioned. Plain PostgreSQL; additive and idempotent. **Deploy the code first, then apply it**: the code works without it (every save is live, as before, and the draft endpoints answer 409); applied before the code, edits made with the old code after the version-1 snapshot would not reach the audience until those apps are published again |
| `20270123100000_report_rollups.sql` | Report rollups and Settings → Query ([Query settings](query-settings.md)): `report_rollup_runs` (tenant × workflow × UTC day × shard: runs started that day by status, completed durations, trace-derived node visits / edge traversals, a duration histogram; runs completed that day on time / late against `sla_due_at`, cycle time sum + histogram), `report_rollup_nodes` (node visits per workflow-day), `report_rollup_tasks` (top-level tasks created per day by status and completed per day on time / late / no due date, time to complete; per workflow × team × assignee, zero uuid = none), `report_rollup_submissions` (per form-day), `report_rollup_state` (per-tenant backfill coverage) and `report_rollup_dirty` (queued day ranges). AFTER row triggers on `workflow_runs`, `tasks` and `form_submissions` upsert deltas (new − old contribution) in the same transaction, under transaction-scoped shared advisory locks per (tenant, day); `usertasks.report_rollups` = `defer` / `off` for bulk jobs; workflow / form delete triggers drop their rows. Maintenance (service role): `report_rollup_rebuild`, `_backfill_next`, `_reconcile_next`, `_drain_next`, `_request_rebuild`, `_pending`, `_status`. Reads (SECURITY INVOKER; authenticated + service role): `report_rollup_run_days`, `_run_hists`, `_node_visits`, `_run_now`, `_task_days`, `_task_hists`, `_submission_days`, `_form_last`, `_tenant_freshness` — whole UTC days from the rollups, partial edge days live. RLS: run / node rows with `workflows.view_runs`, submission rows with `forms.edit`, task rows with `tasks.view_all` or the caller's own / team rows; state and dirty service role only; no client writes. Indexes `workflow_runs (tenant_id, completed_at)`, `tasks (tenant_id, completed_at)`, `form_submissions (tenant_id, created_at)` (create them CONCURRENTLY first on large installs). Additive and idempotent; plain SQL (Supabase and PostgreSQL 14+). Apply before or after the code: until it is applied every report reads real time; after it, reads use the rollups per workspace once the scheduler's `report-rollups` job (or `usertasks-admin rollups backfill`) has backfilled it |
| `20270124090000_queue_leases.sql` | Workflow queue leases and stuck-job recovery: `workflow_queue.lease_expires_at`, `run_id`, `lease_lost_count`, `last_lease_lost_at`, `last_lease_owner` (+ partial index on processing jobs); `queue_job_lease_expired` (lease past, or no lease and locked over 15 minutes ago); `recover_expired_jobs` (stuck `processing` jobs back to `failed` with the usual back-off and a "Worker lost" error, or `dead` after `max_attempts` with the interrupted run marked failed; a resume job whose run already moved on is not retried); `claim_jobs(worker, limit, lease_seconds)` replaces the two-argument version and recovers first (as does `claim_next_job`); `renew_job_leases`; `complete_leased_job` / `fail_leased_job` (fenced on the lease holder); `release_jobs`, `complete_job`, `fail_job` clear the lease; `recover_queue_job` (Workflow queue → Retry / Cancel of a stuck job, force-cancel of a live one); `get_queue_health`. `claim_next_job` / `fail_job` lose their old anon / authenticated grants (service role only, like the other worker RPCs). Plain SQL, no pg_cron; additive and idempotent. Apply before or after the code: old code keeps working (no lease = the 15-minute rule) and new code falls back to the old RPCs until it is applied |
| `20270125090000_webhook_secret_sha256.sql` | Inbound webhook secrets checked without bcrypt: `workflow_webhooks.api_key_sha256` (hex SHA-256, format CHECK). New and rotated secrets get it at once; existing rows verify once with their bcrypt `api_key_hash` and the inbound route writes the SHA-256 (lazy upgrade). `api_key_hash` is kept and still written, so an older release verifies after a rollback. Additive and idempotent; plain SQL. Apply before or after the code: until it is applied every inbound request bcrypt-verifies as before (with a short in-process cache of successful checks) |
| `20270125100000_run_checkpoints.sql` | Run checkpoints, step idempotency and queued hand-offs: `workflow_runs.checkpoint` (the running segment's base and completed / started steps; cleared at pause and end), `checkpoint_run_step(run, segment, completed, started)` (merges into the running segment only), `workflow_step_effects` (performed emails / data-table writes by idempotency key; service role only; `purge_step_effects`, daily after 30 days), `workflow_run_event_relay` (events of queued designer test runs; service role only; `purge_run_event_relay`), `processing_notify(kind)` (NOTIFY `usertasks_processing`; service role only), `recover_expired_jobs` v2 (a stuck resume job is requeued — the processor continues the run from its checkpoint or closes it as interrupted — instead of dead), `complete_leased_job` keeps a request/response run's HTTP `response` (≤ 4 MB). RLS snapshot: two new service-role-only tables. Plain SQL; additive and idempotent. Needs `20270124090000`. Apply before or after the code: without it runs simply have no checkpoints (recovered runs are closed as interrupted and restarted) |
| `20270126120000_email_template_variables.sql` | Declared email template variables: `email_templates.variables jsonb NOT NULL DEFAULT '[]'` (`[{ name, label?, type?, description?, sample?, required? }]`, auto-detected by the template editor on save; the workflow designer shows them as a mapping table on Send Email / User Task notification steps). RLS unchanged. Additive and idempotent; a constant default is metadata-only. Apply before or after the code: until it is applied templates read as having no declarations (variables are still detected from the content) and saves skip storing them |
| `20270126130000_ai_cost_breakdown.sql` | AI cost breakdowns: `assistant_usage.source` and `assistant_usage.cached_tokens`, plus a service-role-only grouping function for Agents → Costs & budgets and `GET /agents/usage` breakdowns. Additive. Apply before or after the code: until it is applied the page sums the newest 50,000 records per table (and says so), and PDF import / redaction calls show under the in-product Agent |
| `20270126140000_form_submissions_one_response.sql` | One response per person, atomically: `form_submissions.single_response boolean NOT NULL DEFAULT false` and a partial unique index on `(tenant_id, form_id, submitted_by) WHERE single_response AND submitted_by IS NOT NULL`, so two racing responses to a "one response per person" wizard form can't both count (the second is refused). RLS unchanged. Additive and idempotent. Apply before or after the code: until it is applied the flag is left out (a warning is logged) and the earlier read check applies alone |
| `20270127090000_tenant_delete_fk_actions.sql` | Deleting a workspace (`DELETE FROM tenants`, service role only — members have no delete policy) works: the tenant keys of `agent_queue`, `agent_runs`, `agents`, `task_assignees`, `task_escalations`, `task_reminders`, `task_responses`, `workflow_logs` and `workflow_versions` become `ON DELETE CASCADE` like every other table's (they still had the baseline's NO ACTION, so the workspace's own rows — and through them its tasks, runs and run versions — blocked the delete), and `users.current_tenant_id` becomes `ON DELETE SET NULL` (a member of another workspace whose current workspace it was keeps their account; NULL is the existing "no current workspace" value). Keys between rows (`created_by`, `user_id`, `version_id` …) and `users.tenant_id` (CASCADE) are unchanged. No data changes; RLS unchanged. Idempotent (each key found by its column, replaced `NOT VALID`, then validated). Apply before or after the code: `lib/gallery/verify-core.ts` still empties the non-cascading tables first, so it works either way |
| `20270128100000_repair_signup_workspaces.sql` | Data repair for cloud workspaces from the July–11 Nov 2026 beta self-signup: the single founder (users.role already owner, membership 'member', no owner) becomes owner of their own workspace; the empty leftover personal workspaces those signups created are deleted. Targets named explicitly and guarded on current state, so a no-op elsewhere and safe to re-run |
| `20270128110000_default_theme_onyx.sql` | New workspaces are seeded with the Onyx theme instead of Basecamp (`seed_workspace_theme`). Existing workspaces keep their theme. Replaces a function only; safe to re-run |
| `20270129090000_instance_admin.sql` | Instance admin ("cloud admin") operations (`lib/services/instance-admin`, `/api/v1/instance/*`): `instance_admin_audit` (every on-behalf action of an instance admin: who, target workspace / person, action, reason, outcome, detail, channel, idempotency key; RLS on, service role only, no foreign keys so it outlives workspaces and people), `instance_admin_daily_counts()` and `instance_admin_workspace_stats()` (per-day / per-workspace counts and sums of runs, tasks, agent runs, AI requests and cost, signups, people, members, invitations, assets, queue, storage bytes — counts only, no content), and Supabase-Auth-only helpers `instance_admin_auth_state()` (last sign-in, ban, confirmation, open sessions, verified MFA factors, sign-in providers), `instance_admin_locked_users()` and `instance_admin_revoke_sessions()` (sign out everywhere: deletes the person's `auth.sessions`; access tokens live until they expire). Every function is service-role only (`SECURITY DEFINER` ones read `auth.*` through dynamic SQL and return nothing where `auth.*` does not exist). Additive and idempotent. Apply before or after the code: until it is applied the reads fall back to capped plain queries, the audit trail is empty with a note, and **every on-behalf action is refused (503)** — nothing happens unaudited |

Supabase-only statements are guarded so the same files run on plain
PostgreSQL: storage buckets and policies (`0003`, `20261031000000`,
`20261102000000`) run only when the `storage` schema exists, and the pg_cron
jobs (`0002`) only when `pg_cron` and `pg_net` can be created (the later
pg_cron sections already were). On Supabase the guarded statements are the
same ones as before, and every one of these files was already applied in
production before it was edited, so nothing re-runs there.

The 92 older incremental migrations the baseline replaced (formerly in
`supabase/migrations_archive/`, never applied) were removed in Perf phase 6;
they remain in git history before that commit.

## Fresh install

```bash
# local stack
npx supabase start
npx supabase db reset          # applies supabase/migrations/

# hosted project
npx supabase link --project-ref <ref>
npx supabase db push --linked
```

Then create the Vault secrets `cron_secret` and `app_base_url`
(see [self-hosting.md](self-hosting.md#3-scheduled-jobs-pg_cron--vault)).
Regenerate types with `npm run db:types:local` or `npm run db:types`.

New schema changes: `npx supabase migration new <name>`. Keep new
migrations portable: guard anything that needs Supabase-only schemas
(`storage`, `vault`, `cron`, `net`, `auth.identities`) with
`to_regclass(...)` / `to_regnamespace(...)` checks, and don't name the
`postgres` role.

Any other PostgreSQL:

```bash
DATABASE_URL=postgresql://owner:…@host:5432/usertasks npm run admin -- db migrate
npm run admin -- db status
```

## Adopting the compat bootstrap on production (maintainers)

`20261014000000_compat_bootstrap.sql` sorts before the baseline, so
`supabase db push` refuses it on a project that already has later versions
("Found local migration files to be inserted before the last migration on
remote database"). It does nothing on Supabase; record it as applied once,
before the next push:

```bash
npx supabase migration repair --status applied 20261014000000 --linked
npx supabase db push --linked --dry-run   # must not list 20261014000000 or any older file
```

(`supabase db push --include-all` would also be safe — the file is a no-op
there — but repair keeps the history explicit.) The other files edited for
portability (`0002`, `0003`, `20261031000000`, `20261102000000`) are already
in production's history and are not re-run; on a fresh Supabase project they
produce exactly what they did before (verified by applying the old and new
versions to a Supabase database and comparing policies, buckets, cron jobs,
roles and `auth` / `extensions` objects).

## One-time adoption on the existing production project (maintainers)

Production already has the baseline schema, but its migration history holds
44 dashboard-applied versions that do not match any file. Run once, from a
clean checkout of this branch, with the project linked:

```bash
# 0. Back up data first (backups/ is gitignored)
npx supabase db dump --linked --data-only --use-copy -f backups/$(date +%Y%m%d)_data.sql

# 1. Forget the old remote history (does not touch the schema)
npx supabase migration repair --linked --status reverted \
  20260328141628 20260328192350 20260328223103 20260328234040 20260329001526 \
  20260329135925 20260329193247 20260329231138 20260330145322 20260330151316 \
  20260330153747 20260331014804 20260331024032 20260331143233 20260401141422 \
  20260401142448 20260401150516 20260401150743 20260403025321 20260404124155 \
  20260404132721 20260404141221 20260404150246 20260404170250 20260404182524 \
  20260404191210 20260404194546 20260405114213 20260405132949 20260405134416 \
  20260405181954 20260410210357 20260410232336 20260411002636 20260411003305 \
  20260411003948 20260411004608 20260411010158 20260411011155 20260411131835 \
  20260414212424 20260414215900 20260414224246 20260416143517

# 2. Record the baseline and outside-schema migrations as applied (not run)
npx supabase migration repair --linked --status applied \
  20261015000000 20261015000001 20261015000002 20261015000003

# 3. Check, then apply the strip-back and later migrations
#    (see "Pending on production" below for the full list and the order of
#    the deploy, the CONCURRENTLY index builds and the push)
npx supabase migration list --linked     # local and remote match except 20261015000004 and later
npx supabase db push --linked --dry-run  # should list 20261015000004 … 20261029000000 (13 files)
npx supabase db push --linked

# 4. Regenerate types from production
npm run db:types
```

Notes:

- `20261015000004_strip_back.sql` is the point of no return for retired
  feature data. It sets `lock_timeout = 10s` and ends idle-in-transaction
  sessions holding locks. If it times out, run it again.
- It deletes the `storage.objects` rows under `task-files/documents/`. The
  files stay in the storage backend until you empty that folder from the
  dashboard. `kanban-boards/` images are left for you to clean up by hand.
- `20261023000000_oauth_first_party_cli.sql` is idempotent and independent
  of the strip-back. Until it is applied, the discovery document omits
  `usertasks_cli_client_id` and `usertasks login` falls back to dynamic
  client registration (shown as an unverified app on the consent page).
- 0001–0003 are idempotent, so running them on production is also safe.
  To remove any `usertasks-*` jobs created from the dashboard and reschedule
  the canonical set, run `20261103100000_cron_consolidation.sql` in the SQL
  editor (not `20261015000002_cron_jobs.sql`, which brings back the 13
  separate jobs).

## Pending on production

Production has the baseline schema (`20261015000000`–`0003`, recorded as
applied in step 2 above). Everything after it is pending, from four unmerged
branches stacked on each other (`strip-back` → `cli` → `log-export` →
`perf`). `supabase db push` applies them in this order:

| # | Migration | Branch | Ordering constraint |
|---|---|---|---|
| 1 | `20261015000004_strip_back.sql` | strip-back | Point of no return: drops the retired feature tables, so the old app stops working once it runs |
| 2 | `20261023000000_oauth_first_party_cli.sql` | cli | Independent; idempotent |
| 3 | `20261024000000_event_stream.sql` | log-export | Builds `idx_workflow_logs_tenant_created` on `workflow_logs` (see below) |
| 4 | `20261024000001_observability_permission.sql` | log-export | — |
| 5 | `20261024000002_log_destinations.sql` | log-export | — |
| 6 | `20261024000003_log_shipper.sql` | log-export | Needs the Vault secrets `app_base_url` / `cron_secret` for the new pg_cron job |
| 7 | `20261024000004_enqueue_workflow_tenant_check.sql` | log-export | — |
| 8 | `20261025000000_record_workflow_run.sql` | perf | Code falls back until applied |
| 9 | `20261026000000_queue_dispatch.sql` | perf | Code falls back until applied |
| 10 | `20261027000000_rls_initplan.sql` | perf | Brief per-table locks, `lock_timeout = 5s` (re-run on timeout) |
| 11 | `20261027000001_perf_indexes.sql` | perf | Pre-build its indexes `CONCURRENTLY` (below) |
| 12 | `20261028000000_perf_api_reports.sql` | perf | Before the new app serves report pages |
| 13 | `20261029000000_drop_integration_endpoints.sql` | perf | Irreversible; the new app doesn't use the table |

All are idempotent. Release notes per branch:
[log-export](changes/log-export.md), [cli-api](changes/cli-api.md),
[performance](changes/performance.md).

**Recommended sequence:**

1. **Back up** (step 0 above) and **repair the history** (steps 1–2), once.
2. **Ahead of the window, no downtime:** build the big indexes concurrently
   in the SQL editor, one statement at a time (not in a transaction). They
   only touch tables that already exist in production, and the migrations'
   `CREATE INDEX IF NOT EXISTS` then skip them:

   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_logs_tenant_created ON public.workflow_logs (tenant_id, created_at);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_claim ON public.workflow_queue USING btree (priority DESC, scheduled_for) WHERE status IN ('pending', 'failed');
   ```

   plus the seven statements under
   [Performance migrations on a live database](#performance-migrations-on-a-live-database-20261027)
   below. Check for `INVALID` indexes afterwards
   (`SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`).
3. **In the maintenance window:** `npx supabase db push --linked --dry-run`
   (13 files), then `npx supabase db push --linked`. If `strip_back` or
   `rls_initplan` stop on `lock_timeout`, run the push again.
4. **Deploy the new app** right after the push (the old app is broken from
   migration 1 on; the new one needs 12 for reports). Set the new optional
   env vars if you want non-defaults (`docs/changes/performance.md`).
5. **Check:** `npx supabase migration list --linked` shows local = remote,
   `npm run db:types` regenerates types without a diff, the
   `usertasks-ship-events` cron job exists, and a test workflow run plus a
   task completion resume (now queued) complete.

## Performance migrations on a live database (20261027…)

`20261027000000_rls_initplan.sql` only changes policies and function
settings: no table is rewritten, but each table's policies are swapped under
a brief `ACCESS EXCLUSIVE` lock held until the migration commits. It sets
`lock_timeout = 5s`, so behind a long-running query it fails instead of
queueing every request; run it again. Policy semantics are unchanged except
the two fixes listed in its header (checked by
`__tests__/rls-semantics-db.test.ts`).

`20261027000001_perf_indexes.sql` builds indexes with plain `CREATE INDEX`
because the Supabase CLI runs each migration in a transaction, and a plain
build blocks writes to that table while it runs (`tasks`, `workflow_runs` and
`workflow_logs` are the big ones). On a busy production database, build the
indexes first in the SQL editor, one statement at a time (not in a
transaction):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_runs_workflow_started ON public.workflow_runs (workflow_id, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_runs_tenant_started ON public.workflow_runs (tenant_id, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_runs_task ON public.workflow_runs (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_logs_run_created ON public.workflow_logs (run_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_assignees_user_status ON public.task_assignees (user_id, acceptance_status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_created ON public.tasks (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_title_trgm ON public.tasks USING gin (title extensions.gin_trgm_ops);
```

then push the migration: its `CREATE INDEX IF NOT EXISTS` statements are
no-ops and it only drops the duplicate indexes (`DROP INDEX` takes a brief
exclusive lock). If a concurrent build fails it leaves an `INVALID` index:
`DROP INDEX CONCURRENTLY` it and build it again. Apply both after the earlier
pending migrations.

`20261028000000_perf_api_reports.sql` adds `workflows.node_count` (a small
table; the backfill runs with the `updated_at` trigger disabled so list order
is unchanged), tightens the `tag_definitions` insert policy and adds the
run-report RPCs used by the report pages. Deploy it **before** the app
version that calls those RPCs, or the workflow report pages fail to load.

`20261102000000_brand_fonts_bucket.sql` creates the public `brand-fonts`
storage bucket for workspace theme fonts. It accepts `font/woff2` only, up to
1 MB. Uploads, overwrites and deletes need membership plus `settings.edit` for
the path's tenant folder, the same rule as `logos`. Apply it before the app
version that has the theme designer; without the bucket, font uploads fail.
Nothing else depends on it.

`20261103000000_workflow_instance_migration.sql` adds live instance migration:
`workflow_runs.migrated_to_run_id` / `migrated_from_run_id` (nullable self
FKs, indexed), a partial index for live runs, the service-role-only
`migrate_workflow_instance` RPC (closes the old run as `migrated`, starts the
new one paused at its target node, cancels the old run's open tasks and
pending resume jobs, in one transaction, only while the run still waits on
the expected event and version), the `workflow_live_instance_counts` RPC, an
updated `app_events.tg_workflow_runs` (emits `workflow.run.migrated`) and the
`workflows.manage_runs` permission (seed function plus existing system
Owner/Admin/Manager roles). Apply it **before** the app version that lists or
migrates instances: the versions list, run list and workflow page read the
new columns and RPC. It only adds objects, so the previous app version keeps
working after it is applied.

`20261103100000_cron_consolidation.sql` replaces the 14 `usertasks-*` pg_cron
jobs with two: `usertasks-tick` (every minute; `POST /api/cron/tick` runs the
due jobs from `lib/jobs/registry.ts` in-process) and
`usertasks-cron-housekeeping` (daily 03:30 UTC, pure SQL: run history older
than 2 days, `net._http_response` older than 1 hour). It also deletes
`cron.job_run_details` rows older than 2 days in batches (on production about
589k rows, 138 MB; expect seconds, row locks only). Apply it **together with
or after** the app version that has `/api/cron/tick`: before that deploy the
tick would get a 404 every minute and no background job would run. The old
endpoints stay, so the previous app version is unaffected until the
migration runs. Check afterwards:

```sql
select jobname, schedule from cron.job where jobname like 'usertasks-%';  -- 2 rows
select job_name, last_started_at, last_status from app_cron.tick_runs order by 1;
```

Rollback: re-run `20261015000002_cron_jobs.sql` and the last block of
`20261024000003_log_shipper.sql` (the tick RPCs and tables can stay). See
[docs/changes/scheduler-consolidation.md](changes/scheduler-consolidation.md).

## Organization structure (20261224000000)

`20261224000000_org_structure.sql` adds the org structure tables and
columns listed above, their RLS policies and the four `org.*` /
`projects.*` permissions. Apply it **before** the app version that has the
Organization page: the page, the org and project API, team saves (they
write the new team columns) and directory sync read them. It only adds
objects (plus `CREATE OR REPLACE` of `seed_tenant_roles` and permission
appends on existing roles), so the previous app version keeps working
after it is applied, and it is safe to run more than once. Existing
directory connections keep the new import switches off until an admin
turns them on. Check afterwards:

```sql
select count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name in ('org_units', 'org_unit_members', 'projects', 'project_members', 'project_teams');  -- 5
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'user_memberships'
   and column_name in ('job_title', 'department', 'location', 'employee_id', 'cost_center', 'profile_source');  -- 6 rows
select slug, 'org.view' = any(permissions) as org_view, 'org.manage' = any(permissions) as org_manage,
       'projects.manage' = any(permissions) as projects_manage
  from public.roles where is_system group by 1, 2, 3, 4 order by 1;
```

See [docs/changes/org-structure.md](changes/org-structure.md).
