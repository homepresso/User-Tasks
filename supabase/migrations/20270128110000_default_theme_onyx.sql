-- New workspaces start on the Onyx theme (was Basecamp). Existing workspaces
-- keep the theme they have; only the seed for newly created tenants changes.
CREATE OR REPLACE FUNCTION public.seed_workspace_theme()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.workspace_themes (tenant_id, theme)
  VALUES (NEW.id, '{"base_preset":"onyx"}'::jsonb)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_workspace_theme() FROM PUBLIC, anon, authenticated;
