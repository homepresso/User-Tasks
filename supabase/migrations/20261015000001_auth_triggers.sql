-- ============================================================================
-- 20261015000001_auth_triggers.sql
--
-- Triggers on auth.users that the public-schema baseline dump cannot capture
-- (pg_dump -s public skips triggers whose table lives in another schema).
-- Extracted from `supabase db dump -s auth` of production, 2026-10-15.
--
-- on_auth_user_created → public.handle_new_user(): every new auth user gets
-- a public.users row, a personal tenant and a home user_memberships row.
-- lib/tenant-provisioning.ts then repoints the user at the tenant it creates.
-- (handle_new_user itself is defined in the baseline and recreated without
-- the metering insert in 20261015000004_strip_back.sql.)
-- ============================================================================

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
