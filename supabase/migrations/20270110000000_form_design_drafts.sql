-- ============================================================================
-- 20270110000000_form_design_drafts.sql
--
-- Draft and publish for reusable forms (lib/services/form-design-drafts.ts).
--
-- 1. public.form_design_drafts: at most one working draft per form — the
--    content an editor saves in the form designer (fields, layout, theme,
--    buttons, header) before it is published, who last saved it and when,
--    and the published version it started from. public.forms keeps the
--    PUBLISHED content, so every end-user surface (form pages, start forms,
--    the Forms menu, public links, task forms, REST / MCP default reads)
--    is unchanged by a draft. Publishing copies the draft into forms (a new
--    version + a form_versions snapshot) and deletes the draft row.
--    (Not to be confused with public.form_drafts, 20261218000000: a
--    person's saved, unsent ANSWERS to a form.)
--
-- 2. public.form_design_draft_reviewers: people and teams an editor shares
--    the draft with ("Share draft"). They may open the draft preview
--    (/forms/<id>/draft-preview) read only, without forms.edit. Rows hang off
--    the draft (ON DELETE CASCADE), so publishing or discarding the draft
--    ends every reviewer's access.
--
-- 3. form_versions.note: the optional note given when a draft is published.
--
-- 4. notifications.form_id: the bell links a "shared a form draft with you"
--    notification to the draft preview.
--
-- 5. RLS: enabled with NO client grants on the two new tables — drafts are
--    private to editors and the reviewers they name, which a tenant-wide
--    SELECT policy (as on forms) would not express. The service reads and
--    writes them with the service role after its own checks (forms.edit, or
--    a reviewer row for the caller), always with an explicit tenant filter.
--
-- Additive and idempotent. Code deployed before this migration keeps
-- today's behaviour: saving a form in the designer publishes a new version
-- straight away (the service detects the missing table).
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.form_design_drafts (
  form_id      uuid PRIMARY KEY REFERENCES public.forms(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout       jsonb,
  theme        jsonb NOT NULL DEFAULT '{"source":"workspace"}'::jsonb,
  buttons      jsonb,
  header       jsonb,
  base_version integer NOT NULL CHECK (base_version >= 1),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_design_drafts_tenant ON public.form_design_drafts (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.form_design_draft_reviewers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  form_id        uuid NOT NULL REFERENCES public.form_design_drafts(form_id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'team')),
  principal_id   uuid NOT NULL,
  added_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_form_design_draft_reviewers_principal
  ON public.form_design_draft_reviewers (tenant_id, principal_type, principal_id);

COMMENT ON TABLE public.form_design_drafts IS 'The working draft of a reusable form (one per form); forms holds the published content. Written by lib/services/form-design-drafts.ts with the service role.';
COMMENT ON TABLE public.form_design_draft_reviewers IS 'People / teams who may preview a form draft (read only). Cascade with the draft: publish / discard ends access.';

DROP TRIGGER IF EXISTS trg_form_design_drafts_updated_at ON public.form_design_drafts;
CREATE TRIGGER trg_form_design_drafts_updated_at BEFORE UPDATE ON public.form_design_drafts
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.form_versions ADD COLUMN IF NOT EXISTS note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_versions_note_length') THEN
    ALTER TABLE public.form_versions ADD CONSTRAINT form_versions_note_length CHECK (note IS NULL OR char_length(note) <= 1000);
  END IF;
END $$;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS form_id uuid REFERENCES public.forms(id) ON DELETE SET NULL;

-- ── RLS: no client access; the service role only ──────────────────────────

ALTER TABLE public.form_design_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_design_draft_reviewers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_design_drafts', 'form_design_draft_reviewers'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
