-- Team requests: one row per request the UserTasks team receives (website
-- contact form, in-app feedback, docs feedback, beta signups, SharePoint
-- trial signups), written by lib/contact/team-requests.ts (notifyTeam) before
-- the ChirpMe notification goes out, so nothing is lost when ChirpMe is down.
-- Instance admins work through them in Settings → Requests.
--
--  * team_requests: the request itself (who, what, the escaped HTML detail the
--    notification carried, structured facts), its triage state and how the
--    notification went (delivery).
--  * team_request_events: the audit trail of status / note changes.
--
-- Both tables are instance level (no tenant) and service role only: RLS is on
-- with no policies and anon / authenticated have no grants at all, so nothing
-- is readable through PostgREST. The server checks instance-admin access
-- (INSTANCE_ADMIN_EMAILS / instance.admin_emails) before reading or writing.
--
-- Additive and idempotent. Safe before or after the code: until it is applied
-- notifyTeam logs the failed insert and still sends the notification.

CREATE TABLE IF NOT EXISTS public.team_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('contact', 'feedback', 'docs_feedback', 'beta_signup', 'trial', 'other')),
  title       text NOT NULL CHECK (char_length(title) <= 500),
  summary     text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  name        text CHECK (char_length(name) <= 300),
  email       text CHECK (char_length(email) <= 320),
  company     text CHECK (char_length(company) <= 300),
  reply_to    text CHECK (char_length(reply_to) <= 320),
  url         text CHECK (char_length(url) <= 2000),
  facts       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts) = 'object'),
  detail_html text NOT NULL DEFAULT '' CHECK (char_length(detail_html) <= 100000),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'handled', 'spam')),
  -- No FK: a request outlives the admin who handled it.
  handled_by  uuid,
  handled_at  timestamptz,
  note        text CHECK (char_length(note) <= 5000),
  delivery    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_requests_status_created ON public.team_requests (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_team_requests_kind_created ON public.team_requests (kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_team_requests_created ON public.team_requests (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_team_requests_email ON public.team_requests (lower(email));

ALTER TABLE public.team_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_requests FROM PUBLIC;
REVOKE ALL ON public.team_requests FROM anon, authenticated;
GRANT ALL ON public.team_requests TO service_role;

COMMENT ON TABLE public.team_requests IS
  'Requests to the UserTasks team (contact, feedback, docs feedback, beta signups, trials): lib/contact/team-requests.ts. Instance level, service role only; Settings → Requests for instance admins.';

CREATE TABLE IF NOT EXISTS public.team_request_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  uuid NOT NULL REFERENCES public.team_requests(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_email text,
  from_status text,
  to_status   text,
  note        text CHECK (char_length(note) <= 5000),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_team_request_events_request ON public.team_request_events (request_id, occurred_at DESC);

ALTER TABLE public.team_request_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_request_events FROM PUBLIC;
REVOKE ALL ON public.team_request_events FROM anon, authenticated;
GRANT ALL ON public.team_request_events TO service_role;

COMMENT ON TABLE public.team_request_events IS
  'Audit trail of team request status and note changes (Settings → Requests). Service role only.';
