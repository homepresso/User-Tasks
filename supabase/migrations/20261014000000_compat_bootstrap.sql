-- ============================================================================
-- 20261014000000_compat_bootstrap.sql
--
-- Database portability (Providers phase 10): what a Supabase database ships
-- with and the rest of the migration chain assumes, created on any other
-- PostgreSQL (15+) — plain Docker `postgres`, RDS/Aurora, Azure Database for
-- PostgreSQL, Cloud SQL/AlloyDB, Neon, CloudNativePG, …
--
-- On Supabase this file does NOTHING: every block returns early when the
-- database is a Supabase one (the supabase_admin role exists), so the real
-- roles, auth.* functions, auth.users, extensions schema and storage are
-- never touched. Production adopted it with
--   supabase migration repair --status applied 20261014000000
-- (it sorts before the baseline; `supabase db push` refuses out-of-order
-- versions until they are marked applied — see docs/migrations.md).
--
-- Elsewhere it creates, only when missing:
--  * roles anon, authenticated, service_role (NOLOGIN; service_role with
--    BYPASSRLS when the migrating role may grant it — managed services
--    usually can't, and the postgres db provider then runs service-role
--    requests as the schema owner instead, see docs/infrastructure.md) and
--    authenticator (NOLOGIN NOINHERIT, member of the three); the migrating
--    role becomes a member of the three so the app can SET ROLE to them;
--  * schema `extensions` with pgcrypto (gen_random_bytes) — or, where the
--    extension can't be created, a gen_random_bytes() built on the core
--    gen_random_uuid();
--  * schema `auth` with uid() / role() / jwt() / email() reading the
--    request.jwt.claims setting (what the postgres db provider and the DB
--    tests set per transaction), and a minimal auth.users table so the
--    chain's auth.users trigger, foreign keys (since repointed at
--    public.users) and tooling keep working.
-- Storage, Vault, pg_net and pg_cron statements later in the chain are
-- conditional on those being installed.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.ut_is_supabase() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') $$;

-- ── Roles ──────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  r text;
  can_set boolean;
BEGIN
  IF pg_temp.ut_is_supabase() THEN RETURN; END IF;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    BEGIN
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Managed Postgres: only superusers (or roles with BYPASSRLS) may
      -- grant it. The postgres db provider detects this and runs
      -- service-role requests as the schema owner (who bypasses RLS).
      CREATE ROLE service_role NOLOGIN NOINHERIT;
      RAISE NOTICE 'service_role created without BYPASSRLS (%: not permitted); service-role requests will run as the schema owner', current_user;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
  END IF;

  -- The app connects as the migrating role (or as authenticator, given
  -- LOGIN) and switches with SET LOCAL ROLE per transaction.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    BEGIN
      EXECUTE format('GRANT %I TO authenticator', r);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not grant % to authenticator', r;
    END;
    -- PG16+: creating a role grants its creator ADMIN only (no SET), so
    -- membership alone is not enough to SET ROLE; grant it explicitly.
    can_set := pg_has_role(current_user, r, 'MEMBER');
    IF can_set AND current_setting('server_version_num')::int >= 160000 THEN
      can_set := pg_has_role(current_user, r, 'SET');
    END IF;
    IF NOT can_set THEN
      BEGIN
        EXECUTE format('GRANT %I TO %I', r, current_user);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'could not grant % to %; grant it before connecting the app as this role', r, current_user;
      END;
    END IF;
  END LOOP;
END
$do$;

-- ── extensions schema + gen_random_bytes ───────────────────────────────────
DO $do$
BEGIN
  IF pg_temp.ut_is_supabase() THEN RETURN; END IF;

  CREATE SCHEMA IF NOT EXISTS extensions;
  GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pgcrypto not available (%); using a gen_random_uuid()-based gen_random_bytes', SQLERRM;
    END;
  END IF;
  -- pgcrypto unavailable, or already installed in another schema.
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    -- Version-4 UUIDs come from the server's strong random source
    -- (pg_strong_random); 122 of each 128 bits are random.
    CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea
      LANGUAGE sql VOLATILE STRICT PARALLEL SAFE
      SET search_path TO pg_catalog
      AS $f$
        SELECT substring(string_agg(uuid_send(gen_random_uuid()), ''::bytea) FROM 1 FOR $1)
          FROM generate_series(1, ($1 + 15) / 16)
      $f$;
    GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO anon, authenticated, service_role;
  END IF;
END
$do$;

-- ── auth schema: identity helpers + minimal users table ────────────────────
DO $do$
BEGIN
  IF pg_temp.ut_is_supabase() THEN RETURN; END IF;

  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

  -- Same contract as Supabase's: claims come from request.jwt.claims (set
  -- per transaction with set_config(..., true)); NULL outside a request.
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE
      SET search_path TO ''
      AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      SET search_path TO ''
      AS $f$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $f$;
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      SET search_path TO ''
      AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $f$;
  END IF;
  IF to_regprocedure('auth.email()') IS NULL THEN
    CREATE FUNCTION auth.email() RETURNS text
      LANGUAGE sql STABLE
      SET search_path TO ''
      AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email' $f$;
  END IF;
  GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role(), auth.email() TO PUBLIC;

  -- The columns of Supabase Auth's table that the chain, the tests and the
  -- Supabase → built-in auth migration (lib/auth/migrate.ts) read. Users of
  -- built-in / OIDC / SAML auth never get a row here.
  IF to_regclass('auth.users') IS NULL THEN
    CREATE TABLE auth.users (
      instance_id uuid,
      id uuid PRIMARY KEY,
      aud varchar(255),
      role varchar(255),
      email varchar(255),
      encrypted_password varchar(255),
      email_confirmed_at timestamptz,
      invited_at timestamptz,
      confirmation_token varchar(255),
      recovery_token varchar(255),
      last_sign_in_at timestamptz,
      raw_app_meta_data jsonb,
      raw_user_meta_data jsonb,
      is_super_admin boolean,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      phone text,
      phone_confirmed_at timestamptz,
      banned_until timestamptz,
      deleted_at timestamptz,
      is_sso_user boolean NOT NULL DEFAULT false,
      is_anonymous boolean NOT NULL DEFAULT false
    );
    COMMENT ON TABLE auth.users IS 'UserTasks compat stand-in for Supabase Auth''s users table (non-Supabase Postgres).';
    REVOKE ALL ON auth.users FROM PUBLIC, anon, authenticated;
    GRANT ALL ON auth.users TO service_role;
  END IF;
END
$do$;

DROP FUNCTION pg_temp.ut_is_supabase();
