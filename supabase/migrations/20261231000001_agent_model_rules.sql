-- The Agent's model rules (Settings → Agent → Models): who gets which model.
--
-- The rules themselves (who → connection + model, ordered) live in the
-- existing assistant_settings.capabilities jsonb (version 2, model_rules) —
-- no data migration. This adds only:
--
--  * assistant_settings.model_rule_keys — the keys saved for rules that use
--    their own provider key: { "<rule id>": "<ciphertext>" }, encrypted by the
--    app (lib/secret-crypto) exactly like api_key. Like api_key it is NOT
--    granted to `authenticated` (the table's SELECT grant is column-level and
--    does not include it): only the service role reads it, server-side, to
--    make a provider call. Managers see only each rule's last 4 characters.
--  * assistant_usage.model_rule — which rule chose the model of a request
--    (null: the workspace default), next to the provider / model columns, so
--    costs per model and per rule show up in the usage views.
--
-- RLS is unchanged: assistant_settings rows are still readable only with
-- assistants.manage in the current workspace (assistant_settings_select);
-- usage rows are own rows or assistants.manage. The app works without this
-- migration (rules on the default connection or an Integrations connection;
-- usage recorded without the rule).

ALTER TABLE public.assistant_settings
  ADD COLUMN IF NOT EXISTS model_rule_keys jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_settings_model_rule_keys_check') THEN
    ALTER TABLE public.assistant_settings ADD CONSTRAINT assistant_settings_model_rule_keys_check
      CHECK (jsonb_typeof(model_rule_keys) = 'object' AND pg_column_size(model_rule_keys) <= 100000);
  END IF;
END $$;

COMMENT ON COLUMN public.assistant_settings.model_rule_keys IS
  'Agent model rules: encrypted provider keys per rule id (app-encrypted; never granted to authenticated).';

-- Keep the key column out of reach of signed-in users (the column-level grant
-- of 20261230000000 lists the readable columns; re-state the revoke for clarity).
REVOKE SELECT (model_rule_keys) ON public.assistant_settings FROM authenticated;

ALTER TABLE public.assistant_usage
  ADD COLUMN IF NOT EXISTS model_rule text CHECK (model_rule IS NULL OR char_length(model_rule) <= 64);

COMMENT ON COLUMN public.assistant_usage.model_rule IS
  'Agent model rule that chose this request''s model (null: the workspace default).';
