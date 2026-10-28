-- Realtime provider (providers phase 5): NOTIFY on the realtime tables.
--
-- The SSE realtime provider (REALTIME_PROVIDER=sse) LISTENs on the
-- `usertasks_realtime` channel from each app instance and fans change
-- notifications out to signed-in browsers. These statement-level triggers
-- emit them, one NOTIFY per statement (chunked below the 8000-byte payload
-- limit), with ids and routing columns only — never row data:
--
--   {"table":"tasks","op":"UPDATE","ts":1730000000000,
--    "rows":[{"id":"…","tenant_id":"…","assignee_id":["new","old"],…}]}
--
-- Statements touching more than 200 rows send one bulk notice instead:
--   {"table":"tasks","op":"UPDATE","ts":…,"bulk":true,"tenants":["…"]}
--
-- The triggers are idle unless an SSE listener is active: each listening
-- instance pushes app_realtime.listener_state.listening_until forward every
-- 30 s (app_realtime.mark_listening), and the trigger returns immediately
-- once it has lapsed. With the default Supabase provider nothing listens, so
-- the cost is one single-row lookup per statement and no NOTIFY traffic.
--
-- The supabase_realtime publication is untouched: both providers work.
-- Idempotent (safe to re-run).

-- Production applies this while the app serves traffic: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tasks, notifications and the
-- log tables. Fail fast
-- instead of queueing every query behind a long-running transaction; re-run
-- the push if it times out (the file is idempotent).
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS app_realtime;
REVOKE ALL ON SCHEMA app_realtime FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app_realtime FROM anon, authenticated';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_realtime.listener_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  listening_until timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO app_realtime.listener_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON app_realtime.listener_state FROM PUBLIC;

-- Keep the triggers armed for p_seconds more; returns the database clock (ms),
-- which listeners use as their stream watermark.
CREATE OR REPLACE FUNCTION app_realtime.mark_listening(p_seconds integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE app_realtime.listener_state
     SET listening_until = greatest(listening_until, clock_timestamp() + make_interval(secs => least(greatest(p_seconds, 1), 600)))
   WHERE id;
  RETURN (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
END;
$$;
REVOKE ALL ON FUNCTION app_realtime.mark_listening(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION app_realtime.mark_listening(integer) FROM anon, authenticated';
  END IF;
END $$;

-- Statement-level AFTER trigger. TG_ARGV: routing columns besides id/tenant_id.
CREATE OR REPLACE FUNCTION app_realtime.notify_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ts bigint;
  v_src text;
  v_from text;
  v_fields text := '';
  v_col text;
  v_count integer;
  v_head text;
  v_chunk text := '';
  v_row text;
  v_tenants jsonb;
  i integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_realtime.listener_state WHERE listening_until > clock_timestamp()) THEN
    RETURN NULL;
  END IF;

  v_ts := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_src := CASE TG_OP WHEN 'DELETE' THEN 'old_rows' ELSE 'new_rows' END;
  v_from := CASE TG_OP WHEN 'UPDATE' THEN 'new_rows n JOIN old_rows o ON o.id = n.id' ELSE v_src || ' n' END;

  EXECUTE format('SELECT count(*) FROM %I', v_src) INTO v_count;
  IF v_count = 0 THEN
    RETURN NULL;
  END IF;
  v_head := format('{"table":%s,"op":%s,"ts":%s', to_jsonb(TG_TABLE_NAME)::text, to_jsonb(TG_OP)::text, v_ts);

  IF v_count > 200 THEN
    EXECUTE format('SELECT jsonb_agg(DISTINCT tenant_id) FROM %I', v_src) INTO v_tenants;
    IF length(v_tenants::text) > 7000 THEN
      v_tenants := 'null'::jsonb;
    END IF;
    PERFORM pg_notify('usertasks_realtime', v_head || ',"bulk":true,"tenants":' || coalesce(v_tenants, 'null'::jsonb)::text || '}');
    RETURN NULL;
  END IF;

  FOR i IN 0 .. coalesce(TG_NARGS, 0) - 1 LOOP
    v_col := TG_ARGV[i];
    IF TG_OP = 'UPDATE' THEN
      v_fields := v_fields || format(', %L, to_jsonb(array_remove(ARRAY[n.%I::text, nullif(o.%I::text, n.%I::text)], NULL))', v_col, v_col, v_col, v_col);
    ELSE
      v_fields := v_fields || format(', %L, to_jsonb(array_remove(ARRAY[n.%I::text], NULL))', v_col, v_col);
    END IF;
  END LOOP;

  FOR v_row IN EXECUTE format('SELECT jsonb_build_object(''id'', n.id, ''tenant_id'', n.tenant_id%s)::text FROM %s', v_fields, v_from) LOOP
    IF v_chunk <> '' AND length(v_head) + length(v_chunk) + length(v_row) > 7500 THEN
      PERFORM pg_notify('usertasks_realtime', v_head || ',"rows":[' || v_chunk || ']}');
      v_chunk := '';
    END IF;
    v_chunk := CASE WHEN v_chunk = '' THEN v_row ELSE v_chunk || ',' || v_row END;
  END LOOP;
  IF v_chunk <> '' THEN
    PERFORM pg_notify('usertasks_realtime', v_head || ',"rows":[' || v_chunk || ']}');
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_realtime.notify_changes() FROM PUBLIC;

-- One trigger per table and operation (transition tables allow one event per
-- trigger). Logs and lifecycle events are append-only for realtime purposes.
DO $$
DECLARE
  spec record;
  v_op text;
  v_args text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('tasks',                 ARRAY['INSERT','UPDATE','DELETE'], ARRAY['assignee_id','assigner_id','parent_task_id']),
      ('task_assignees',        ARRAY['INSERT','UPDATE','DELETE'], ARRAY['user_id','task_id']),
      ('notifications',         ARRAY['INSERT','UPDATE','DELETE'], ARRAY['user_id']),
      ('lifecycle_events',      ARRAY['INSERT'],                   ARRAY['task_id']),
      ('workflow_logs',         ARRAY['INSERT'],                   ARRAY[]::text[]),
      ('object_audit_log',      ARRAY['INSERT'],                   ARRAY[]::text[]),
      ('integration_call_logs', ARRAY['INSERT'],                   ARRAY[]::text[]),
      ('agent_runs',            ARRAY['INSERT'],                   ARRAY[]::text[])
    ) AS t(tbl, ops, cols)
  LOOP
    IF to_regclass(format('public.%I', spec.tbl)) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT coalesce(string_agg(quote_literal(c), ', '), '') INTO v_args FROM unnest(spec.cols) AS c;
    FOREACH v_op IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', spec.tbl)::regclass AND tgname = 'realtime_notify_' || lower(v_op)) THEN
        EXECUTE format('DROP TRIGGER %I ON public.%I', 'realtime_notify_' || lower(v_op), spec.tbl);
      END IF;
      IF v_op = ANY (spec.ops) THEN
        EXECUTE format(
          'CREATE TRIGGER %I AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION app_realtime.notify_changes(%s)',
          'realtime_notify_' || lower(v_op), v_op, spec.tbl,
          CASE v_op
            WHEN 'INSERT' THEN 'NEW TABLE AS new_rows'
            WHEN 'DELETE' THEN 'OLD TABLE AS old_rows'
            ELSE 'NEW TABLE AS new_rows OLD TABLE AS old_rows'
          END,
          v_args);
      END IF;
    END LOOP;
  END LOOP;
END $$;

RESET lock_timeout;
