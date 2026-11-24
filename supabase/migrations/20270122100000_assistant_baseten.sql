-- ============================================================================
-- 20270122100000_assistant_baseten.sql
--
-- The in-product Agent (Settings → Agent) can use Baseten as its own provider:
-- assistant_settings.provider accepts 'baseten' (lib/assistants/types.ts
-- ASSISTANT_PROVIDERS). Baseten already works for agents and workflows through
-- an Integrations connection; this only widens the Agent's own list.
-- The customer's own API key, encrypted by the app as for every provider.
-- Additive and idempotent; plain PostgreSQL.
-- ============================================================================

ALTER TABLE public.assistant_settings DROP CONSTRAINT IF EXISTS assistant_settings_provider_check;
ALTER TABLE public.assistant_settings ADD CONSTRAINT assistant_settings_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'xai', 'gemini', 'azure_openai', 'mistral', 'groq', 'baseten', 'ollama', 'other'));
