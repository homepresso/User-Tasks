-- Test fixture for the one-line installer's upgrade end-to-end run
-- (scripts/install-e2e.sh): added to the "new" image only, never to supabase/migrations.
CREATE TABLE IF NOT EXISTS public.install_upgrade_fixture (
  id integer PRIMARY KEY,
  note text NOT NULL
);
INSERT INTO public.install_upgrade_fixture (id, note) VALUES (1, 'applied by usertasks upgrade') ON CONFLICT (id) DO NOTHING;
