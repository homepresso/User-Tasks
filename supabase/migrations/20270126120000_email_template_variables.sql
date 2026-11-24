-- Email templates: declared variables.
--
-- A template can declare the variables it uses (label, type, description,
-- sample, required) so the workflow designer can show them as a mapping
-- table on the Send Email step / User Task notification. The editor
-- auto-detects them from the subject / HTML / text on save.
--
-- Shape: a JSON array of { name, label?, type?, description?, sample?, required? }
-- (validated by lib/email-editor/variables.ts normalizeVariableDeclarations).
--
-- Optional for the code: until this is applied, templates read as having no
-- declarations (variables are still detected from the content) and saving
-- skips storing them (lib/services/email-templates.ts).
-- Re-running is a no-op.

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.email_templates.variables IS
  'Declared template variables: [{ name, label?, type?, description?, sample?, required? }] (auto-detected on save by the email template editor)';
