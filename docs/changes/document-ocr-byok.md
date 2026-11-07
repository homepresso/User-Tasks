# Release notes: Document OCR per workspace (bring your own Azure key)

Reading scanned PDFs and images (OCR) is now a workspace setting. On
usertasks.com each workspace that wants OCR adds its own Azure AI Document
Intelligence resource; the hosted cloud no longer has a shared OCR service.
Self-hosted instances keep working as before.

## New

- **Settings → Document OCR** (`/settings/document-ocr`, *Edit settings* to
  change). Choose **Azure AI Document Intelligence** and paste the
  resource's endpoint and key (an API version is optional), **Built-in
  (tesseract)** where the instance offers it (not on Vercel), the
  **Instance default** (self-hosted) or **Off**. **Test connection** makes
  a free Azure call (no page billed) and reports the result or Azure's
  error.
- **The key is write-only.** It is stored encrypted (as an *Azure AI
  Document Intelligence* connector) and never sent back: the page shows
  **•••• saved** with **Replace** and **Remove**, and REST, MCP and the CLI
  return `"__SECRET__"` at most. It never appears in run output, logs,
  audit rows or exports.
- **Endpoint rules.** The endpoint must be `https://` and pass the same
  egress guard as connectors: private, loopback, link-local and
  cloud-metadata hosts are refused, also through DNS.
- **Usage.** A document step that ran OCR reports
  `ocr: { provider, source, pages_sent }` in its output (run history), so
  you can match it against what Azure bills (one page per page image).
- **Audit.** Setting, changing, removing and testing the key are written to
  the audit log (object type *workspace*, `metadata.kind = document_ocr`).
- **Designer.** A document step with OCR turned on in a workspace without an
  OCR provider shows a warning with a link to the setting.
- **REST:** `GET` / `PUT` / `DELETE /api/v1/document-ocr` and
  `POST /api/v1/document-ocr/test`. The `GET` response can be sent back as
  the `PUT` body (the key stays `"__SECRET__"`).
- **MCP:** `document_ocr_get`, `document_ocr_update`,
  `document_ocr_remove_key` and `document_ocr_test`.
- **CLI:** `usertasks document-ocr get | update | remove-key | test`.
- **Config as code:** the singleton section `document_ocr`
  (`document-ocr.json`: the provider and the connector it uses). The
  endpoint travels with the connector; the key is never exported, so after
  an import an admin enters it again.
- **Connector:** *Azure AI Document Intelligence* joins the connector
  catalogue (AI), with a connection test and a *Get Resource Info*
  reference.

## Changed

- **Which OCR a step uses** is resolved per run: (1) the workspace's own
  setting; (2) the instance configuration (`DOCUMENT_OCR_PROVIDER`) only
  where `DOCUMENT_OCR_INSTANCE_DEFAULT` allows it; (3) otherwise the step
  fails with "OCR isn't set up for this workspace. An admin can add an Azure
  AI Document Intelligence key in Settings → Document OCR".
- **New variable `DOCUMENT_OCR_INSTANCE_DEFAULT`** (`true` | `false`).
  Unset, it is `true` on self-hosted installs (nothing changes) and `false`
  when `DEPLOYMENT_MODE=cloud`, so a cloud workspace never uses a platform
  key.
- Azure errors now include Azure's error code and message (never the key),
  and API versions before `2023-10-31` use the older `/formrecognizer`
  path.

## Upgrade notes

- No database migration: the choice lives in `tenants.settings.document_ocr`
  and the key in `tenant_connectors`.
- **usertasks.com / `DEPLOYMENT_MODE=cloud`:** workspaces need their own key
  for OCR. Any `DOCUMENT_OCR_PROVIDER` / `AZURE_DOCUMENT_INTELLIGENCE_*`
  set on the deployment is ignored unless `DOCUMENT_OCR_INSTANCE_DEFAULT=true`.
- **Self-hosted:** no action. To make every workspace bring its own key,
  set `DOCUMENT_OCR_INSTANCE_DEFAULT=false`.

Docs: [Scanned PDFs and OCR](/docs/workflows/documents/ocr).
