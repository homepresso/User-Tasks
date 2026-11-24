-- ============================================================================
-- One response per person, enforced atomically.
--
-- A wizard form with "one response per person" (form_wizard_projects
-- spec.audience.multiple_responses = false) refused a second response with a
-- read (lib/services/form-wizard-policy.ts) — two submissions at the same
-- moment (a double click, two tabs, an API retry) both passed it and both
-- counted.
--
-- 1. public.form_submissions.single_response — true on rows stored under that
--    policy (lib/services/form-wizard-policy.ts insertSubmissionRow). Every
--    existing row is false (the constant default is metadata-only).
-- 2. uq_form_submissions_single_response — at most one such row per
--    workspace, form and person: the second insert fails with 23505 and the
--    submission is refused with "You have already responded to this form".
--    Partial: other submissions (and anonymous ones, submitted_by NULL) are
--    not touched. Deleting a response (e.g. the person's results removed)
--    frees the slot again.
--
-- Additive and idempotent; RLS unchanged. Apply before or after the code:
-- until it is applied the app leaves the flag out (logging a warning) and
-- the read check works as before.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS single_response boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_single_response
  ON public.form_submissions (tenant_id, form_id, submitted_by)
  WHERE single_response AND submitted_by IS NOT NULL;
