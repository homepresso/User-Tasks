-- Conformance fixture: one shared workspace with two members and a little of
-- everything the server code embeds or filters on. Committed (PostgREST runs
-- on its own connections) and removed by cleanup.sql. Fixed ids keep results
-- comparable between runs.

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1f00000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'alice@pgq.test', '', now(), '{"provider":"email"}', '{"full_name":"Alice Conformance"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2f00000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'bob@pgq.test', '', now(), '{"provider":"email"}', '{"full_name":"Bob Conformance"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3f00000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'carol@pgq.test', '', now(), '{"provider":"email"}', '{"full_name":"Carol Outsider"}', now(), now());

INSERT INTO public.tenants (id, name, slug, branding, settings, created_at)
VALUES ('c0f00000-0000-4000-8000-000000000001', 'Conformance', 'pgq-conformance', '{"primary_color":"#123456"}', '{"timezone":"UTC","flags":{"beta":true}}', '2026-01-01T00:00:00Z');

UPDATE public.users SET tenant_id = 'c0f00000-0000-4000-8000-000000000001', current_tenant_id = 'c0f00000-0000-4000-8000-000000000001'
WHERE id IN ('a1f00000-0000-4000-8000-0000000000a1', 'b2f00000-0000-4000-8000-0000000000b2');

INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active)
VALUES ('a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000001', 'admin', true),
       ('b2f00000-0000-4000-8000-0000000000b2', 'c0f00000-0000-4000-8000-000000000001', 'member', true);

INSERT INTO public.user_roles (tenant_id, user_id, role_id)
SELECT 'c0f00000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-0000000000a1', id FROM public.roles WHERE tenant_id = 'c0f00000-0000-4000-8000-000000000001' AND slug = 'admin';
INSERT INTO public.user_roles (tenant_id, user_id, role_id)
SELECT 'c0f00000-0000-4000-8000-000000000001', 'b2f00000-0000-4000-8000-0000000000b2', id FROM public.roles WHERE tenant_id = 'c0f00000-0000-4000-8000-000000000001' AND slug = 'member';

INSERT INTO public.teams (id, tenant_id, name, description, parent_id, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000101', 'c0f00000-0000-4000-8000-000000000001', 'Ops', 'Operations', NULL, '2026-01-02T00:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000102', 'c0f00000-0000-4000-8000-000000000001', 'Ops (night)', NULL, 'c0f00000-0000-4000-8000-000000000101', '2026-01-03T00:00:00Z');
INSERT INTO public.user_teams (user_id, team_id, role) VALUES
  ('a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000101', 'lead'),
  ('b2f00000-0000-4000-8000-0000000000b2', 'c0f00000-0000-4000-8000-000000000101', 'member'),
  ('a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000102', 'member');
UPDATE public.users SET team_id = 'c0f00000-0000-4000-8000-000000000101' WHERE id = 'a1f00000-0000-4000-8000-0000000000a1';

INSERT INTO public.workflows (id, tenant_id, name, description, trigger_type, is_active, tags, created_by, created_at, nodes, edges) VALUES
  ('c0f00000-0000-4000-8000-000000000201', 'c0f00000-0000-4000-8000-000000000001', 'Onboarding', 'New hire flow', 'manual', true, '{hr,people}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-05T00:00:00Z', '[{"id":"n1","type":"start"}]', '[]'),
  ('c0f00000-0000-4000-8000-000000000202', 'c0f00000-0000-4000-8000-000000000001', 'Offboarding', NULL, 'webhook', false, '{hr}', 'b2f00000-0000-4000-8000-0000000000b2', '2026-01-06T00:00:00Z', '[]', '[]');

INSERT INTO public.tasks (id, tenant_id, parent_task_id, title, description, status, priority, assignee_id, assigner_id, due_date, metadata, tags, workflow_id, is_workflow_task, estimated_effort_assignee, actual_effort, created_at, completed_at) VALUES
  ('c0f00000-0000-4000-8000-000000000301', 'c0f00000-0000-4000-8000-000000000001', NULL, 'Prepare laptop', 'Image and ship', 'in_progress', 'high', 'a1f00000-0000-4000-8000-0000000000a1', 'b2f00000-0000-4000-8000-0000000000b2', '2026-02-01T09:00:00Z', '{"source":"form","n":1,"nested":{"k":"v"}}', '{it,urgent}', 'c0f00000-0000-4000-8000-000000000201', true, 60, 30, '2026-01-10T00:00:00Z', NULL),
  ('c0f00000-0000-4000-8000-000000000302', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000301', 'Install apps', NULL, 'todo', 'medium', 'b2f00000-0000-4000-8000-0000000000b2', 'a1f00000-0000-4000-8000-0000000000a1', '2026-02-02T09:00:00Z', '{"source":"api","n":2}', '{it}', 'c0f00000-0000-4000-8000-000000000201', true, NULL, NULL, '2026-01-11T00:00:00Z', NULL),
  ('c0f00000-0000-4000-8000-000000000303', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000301', 'Create accounts, email (50%)', 'Use the "standard" template', 'completed', 'low', 'a1f00000-0000-4000-8000-0000000000a1', NULL, NULL, '{}', '{}', NULL, false, 15, 20, '2026-01-12T00:00:00Z', '2026-01-13T10:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000304', 'c0f00000-0000-4000-8000-000000000001', NULL, 'Order desk', NULL, 'blocked', 'critical', NULL, 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-20T00:00:00Z', '{"source":"form","n":3}', '{facilities}', NULL, false, NULL, NULL, '2026-01-13T00:00:00Z', NULL),
  ('c0f00000-0000-4000-8000-000000000305', 'c0f00000-0000-4000-8000-000000000001', NULL, 'Welcome lunch', 'Book a table', 'cancelled', 'none', 'b2f00000-0000-4000-8000-0000000000b2', 'b2f00000-0000-4000-8000-0000000000b2', NULL, '{"n":5}', '{social}', 'c0f00000-0000-4000-8000-000000000202', false, NULL, NULL, '2026-01-14T00:00:00Z', NULL),
  ('c0f00000-0000-4000-8000-000000000306', 'c0f00000-0000-4000-8000-000000000001', NULL, 'draft_task_%', NULL, 'draft', 'medium', NULL, NULL, NULL, '{}', '{}', NULL, false, NULL, NULL, '2026-01-15T00:00:00Z', NULL);

INSERT INTO public.task_dependencies (tenant_id, task_id, depends_on_task_id, created_by)
VALUES ('c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000303', 'c0f00000-0000-4000-8000-000000000302', 'a1f00000-0000-4000-8000-0000000000a1');

INSERT INTO public.lifecycle_events (id, tenant_id, task_id, event_type, actor_id, metadata, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000401', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000301', 'created', 'b2f00000-0000-4000-8000-0000000000b2', '{"via":"ui"}', '2026-01-10T00:00:01Z'),
  ('c0f00000-0000-4000-8000-000000000402', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000301', 'started', 'a1f00000-0000-4000-8000-0000000000a1', '{}', '2026-01-10T01:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000403', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000303', 'completed', NULL, '{"auto":true}', '2026-01-13T10:00:00Z');

INSERT INTO public.object_audit_log (id, tenant_id, actor_id, object_type, object_id, action, summary, diff, metadata, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000501', 'c0f00000-0000-4000-8000-000000000001', 'a1f00000-0000-4000-8000-0000000000a1', 'workflow', 'c0f00000-0000-4000-8000-000000000201', 'create', 'Created Onboarding', '{"name":[null,"Onboarding"]}', '{}', '2026-01-05T00:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000502', 'c0f00000-0000-4000-8000-000000000001', 'b2f00000-0000-4000-8000-0000000000b2', 'workflow', 'c0f00000-0000-4000-8000-000000000201', 'update', 'Renamed', '{}', '{"source":"api"}', '2026-01-06T00:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000503', 'c0f00000-0000-4000-8000-000000000001', NULL, 'integration', 'c0f00000-0000-4000-8000-000000000601', 'delete', NULL, NULL, '{}', '2026-01-07T00:00:00Z');

INSERT INTO public.integrations (id, tenant_id, name, type, config, is_active, tags, created_by, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000601', 'c0f00000-0000-4000-8000-000000000001', 'CRM', 'rest', '{"base_url":"https://crm.example"}', true, '{sales}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-03T00:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000602', 'c0f00000-0000-4000-8000-000000000001', 'OpenAI', 'openai', '{}', false, '{}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-04T00:00:00Z');
INSERT INTO public.integration_references (id, integration_id, tenant_id, name, description, inputs, outputs, tags, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000611', 'c0f00000-0000-4000-8000-000000000601', 'c0f00000-0000-4000-8000-000000000001', 'Get contact', 'Fetch a contact', '[{"name":"id"}]', '[]', '{read}', '2026-01-03T01:00:00Z');
INSERT INTO public.agents (id, tenant_id, name, description, integration_id, model, is_active, tags, created_by, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000621', 'c0f00000-0000-4000-8000-000000000001', 'Helper', 'Answers questions', 'c0f00000-0000-4000-8000-000000000602', 'gpt-x', true, '{}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-04T01:00:00Z');
INSERT INTO public.agent_runs (id, agent_id, tenant_id, status, duration_ms, total_tokens, caller_type, caller_id, started_at, completed_at, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000631', 'c0f00000-0000-4000-8000-000000000621', 'c0f00000-0000-4000-8000-000000000001', 'completed', 1200, 345, 'workflow', 'c0f00000-0000-4000-8000-000000000201', '2026-01-04T02:00:00Z', '2026-01-04T02:00:01.2Z', '2026-01-04T02:00:00Z');
INSERT INTO public.integration_call_logs (id, tenant_id, integration_id, reference_id, caller_type, method, url, response_status, duration_ms, started_at, completed_at) VALUES
  ('c0f00000-0000-4000-8000-000000000641', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000601', 'c0f00000-0000-4000-8000-000000000611', 'workflow', 'GET', 'https://crm.example/contacts/1', 200, 87, '2026-01-04T03:00:00Z', '2026-01-04T03:00:00.087Z');

INSERT INTO public.retention_policies (id, tenant_id, name, description, policy_mode, duration_value, duration_unit, applies_to, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000701', 'c0f00000-0000-4000-8000-000000000001', 'Keep 1y', 'Review after a year', 'review', 1, 'years', '{data_tables,data_rows}', '2026-01-01T00:00:00Z');
INSERT INTO public.custom_tables (id, tenant_id, name, slug, description, columns, created_by, retention_policy_id, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000801', 'c0f00000-0000-4000-8000-000000000001', 'Assets', 'assets', 'Hardware', '[{"key":"serial","type":"text"},{"key":"cost","type":"number"}]', 'a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000701', '2026-01-08T00:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000802', 'c0f00000-0000-4000-8000-000000000001', 'Vendors', 'vendors', NULL, '[]', 'b2f00000-0000-4000-8000-0000000000b2', NULL, '2026-01-09T00:00:00Z');
INSERT INTO public.custom_table_rows (id, table_id, tenant_id, data, created_by, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000811', 'c0f00000-0000-4000-8000-000000000801', 'c0f00000-0000-4000-8000-000000000001', '{"serial":"A-1","cost":1200,"tags":["laptop"]}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-08T01:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000812', 'c0f00000-0000-4000-8000-000000000801', 'c0f00000-0000-4000-8000-000000000001', '{"serial":"B-2","cost":80.5}', 'b2f00000-0000-4000-8000-0000000000b2', '2026-01-08T02:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000813', 'c0f00000-0000-4000-8000-000000000801', 'c0f00000-0000-4000-8000-000000000001', '{"serial":"C-3","cost":null}', 'a1f00000-0000-4000-8000-0000000000a1', '2026-01-08T03:00:00Z');

INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, task_id, status, title, started_at, completed_at, node_results) VALUES
  ('c0f00000-0000-4000-8000-000000000901', 'c0f00000-0000-4000-8000-000000000201', 'c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000301', 'completed', 'Run 1', '2026-01-10T00:00:00Z', '2026-01-10T00:05:00Z', '{"n1":{"ok":true}}'),
  ('c0f00000-0000-4000-8000-000000000902', 'c0f00000-0000-4000-8000-000000000201', 'c0f00000-0000-4000-8000-000000000001', NULL, 'failed', 'Run 2', '2026-01-11T00:00:00Z', NULL, '{}');
INSERT INTO public.workflow_logs (id, run_id, workflow_id, tenant_id, node_id, node_type, node_label, level, message, metadata, duration_ms, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000911', 'c0f00000-0000-4000-8000-000000000901', 'c0f00000-0000-4000-8000-000000000201', 'c0f00000-0000-4000-8000-000000000001', 'n1', 'business_rule', 'Check', 'info', 'Rule passed', '{"rule":"r1"}', 12, '2026-01-10T00:01:00Z'),
  ('c0f00000-0000-4000-8000-000000000912', 'c0f00000-0000-4000-8000-000000000902', 'c0f00000-0000-4000-8000-000000000201', 'c0f00000-0000-4000-8000-000000000001', 'n2', 'http', 'Call CRM', 'error', 'Timeout', '{}', 30000, '2026-01-11T00:01:00Z');

INSERT INTO public.invitations (id, tenant_id, email, role, invited_by, token, expires_at, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000a01', 'c0f00000-0000-4000-8000-000000000001', 'dave@pgq.test', 'member', 'a1f00000-0000-4000-8000-0000000000a1', 'pgq-invite-token', '2030-01-01T00:00:00Z', '2026-01-15T00:00:00Z');

INSERT INTO public.object_permissions (id, tenant_id, object_type, object_id, role_id, user_id, team_id, can_view, can_edit, created_at)
SELECT 'c0f00000-0000-4000-8000-000000000b01', 'c0f00000-0000-4000-8000-000000000001', 'workflow', 'c0f00000-0000-4000-8000-000000000201', id, NULL, NULL, true, false, '2026-01-16T00:00:00Z'
FROM public.roles WHERE tenant_id = 'c0f00000-0000-4000-8000-000000000001' AND slug = 'member';
INSERT INTO public.object_permissions (id, tenant_id, object_type, object_id, role_id, user_id, team_id, can_view, can_edit, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000b02', 'c0f00000-0000-4000-8000-000000000001', 'workflow', 'c0f00000-0000-4000-8000-000000000202', NULL, 'b2f00000-0000-4000-8000-0000000000b2', NULL, true, true, '2026-01-16T01:00:00Z'),
  ('c0f00000-0000-4000-8000-000000000b03', 'c0f00000-0000-4000-8000-000000000001', 'data_table', 'c0f00000-0000-4000-8000-000000000801', NULL, NULL, 'c0f00000-0000-4000-8000-000000000101', true, false, '2026-01-16T02:00:00Z');

INSERT INTO public.notifications (id, user_id, tenant_id, type, title, body, task_id, is_read, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000c01', 'a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000001', 'assigned', 'Task assigned', 'Prepare laptop', 'c0f00000-0000-4000-8000-000000000301', false, '2026-01-10T00:00:02Z'),
  ('c0f00000-0000-4000-8000-000000000c02', 'a1f00000-0000-4000-8000-0000000000a1', 'c0f00000-0000-4000-8000-000000000001', 'comment', 'New comment', NULL, NULL, true, '2026-01-10T00:00:03Z'),
  ('c0f00000-0000-4000-8000-000000000c03', 'b2f00000-0000-4000-8000-0000000000b2', 'c0f00000-0000-4000-8000-000000000001', 'assigned', 'Task assigned', 'Install apps', 'c0f00000-0000-4000-8000-000000000302', false, '2026-01-11T00:00:02Z');

INSERT INTO public.task_escalations (id, task_id, tenant_id, escalation_type, user_id, escalate_after_minutes, is_escalated, escalated_at, created_at) VALUES
  ('c0f00000-0000-4000-8000-000000000d01', 'c0f00000-0000-4000-8000-000000000304', 'c0f00000-0000-4000-8000-000000000001', 'user', 'a1f00000-0000-4000-8000-0000000000a1', 60, true, '2026-01-20T01:00:00Z', '2026-01-13T00:00:00Z');

-- 1 100 bulk notifications for bob: more than PostgREST's max_rows (1 000).
INSERT INTO public.notifications (id, user_id, tenant_id, type, title, is_read, created_at)
SELECT ('c0f00000-0000-4000-8000-' || lpad(to_hex(65536 + g), 12, '0'))::uuid, 'b2f00000-0000-4000-8000-0000000000b2', 'c0f00000-0000-4000-8000-000000000001',
       'bulk', 'Bulk ' || g, g % 3 = 0, '2026-02-01T00:00:00Z'::timestamptz + make_interval(mins => g)
FROM generate_series(1, 1100) g;
