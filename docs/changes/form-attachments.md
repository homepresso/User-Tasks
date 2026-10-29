# Release notes: form attachments

Forms get an **Attachments** field that takes several files, and workflows
can loop over them, attach them to emails and send them to other systems.

## Added

- **Attachments field** (form designer palette → **Files**) in task forms,
  reusable form pages (`/f/<id>`), form-started workflows (Run dialog,
  **Save & Test**), the Test runner's User Tasks, grids and themes.
  Settings: at least / at most so many files (default at most 10), size
  per file (default 10 MB) and in total, allowed types (**Documents**,
  **Images**, **Spreadsheets**, **PDF only**, **Any (safe) file**, plus
  custom extensions / MIME types) and **Offer the camera on phones**. See
  [Task forms → Attachments](/docs/tasks/forms#attachments).
- **Upload experience:** drag and drop, **Browse…** and paste; several
  files at once with per-file progress, cancel, retry and remove;
  thumbnails for images, icon / name / size otherwise; reordering; keyboard
  operable with progress announced to screen readers; works on phones.
- **Value:** a list of file objects `{ id, name, size, mime_type, url,
  storage_ref, uploaded_by, uploaded_at, checksum_sha256 }` in
  `{{task_data.<key>}}` / `{{form.<key>}}`, plus `<key>_count`. The data
  picker shows it as a list with the file's fields; **Loop For Each**
  offers it (and takes it by drag and drop), and inside the loop
  `{{item.name}}`, `{{item.url}}`… are the current file. See
  [Loops over files](/docs/workflows/api-responses#loops-over-files).
- **Steps that take files** accept a file object or a list:
  - **Send Email → Attachments** (all files, or `{{item}}` for one), with
    every email provider (Resend, SMTP, SES, Microsoft Graph, Azure
    Communication Services, Gmail API, console);
  - **HTTP Request** bodies **Multipart form (files)** and **Binary (one
    file)**;
  - **Call Reference** file inputs, such as storage connector uploads (S3,
    Azure Blob, SharePoint, OneDrive; Box and Google Drive as multipart);
  - **Word / Excel / PowerPoint** templates and **Read File / CSV / Excel**,
    **Download File**, **File to Base64**.
- Functions `FILE_NAMES(list, separator?)` and `FILES_TOTAL_SIZE(list)`.
- **Downloads** from the task screen, completed tasks and Forms →
  Submissions; run details and logs show file names and sizes, never
  contents. The submissions CSV lists file names.

## Uploads on any host

- With a storage provider that signs uploads (Supabase, S3 / MinIO, Azure
  Blob, GCS) every file goes **straight to storage**: `POST
  /api/internal/forms/files/init` checks the user and the field and returns a
  signed PUT URL for one object (`FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES`,
  default 15), the browser uploads with progress, and `…/complete` reads the
  object back and verifies it (size, magic bytes, blocked types, SVG
  sanitising — the object is rewritten —, checksum, optional scan) or deletes
  it. No host body limit applies (Vercel functions cap bodies at ~4.5 MB).
  S3 / Azure / GCS buckets need a CORS rule for `PUT` from the app origin;
  the CSP allows the store's origin.
- With local-disk storage files go **through the app**, up to
  `FORM_UPLOAD_MAX_BODY_MB` (default 50, a build-time setting that also sets
  `proxyClientMaxBodySize`; capped at 4 on Vercel, with an error that says
  why). Docker build arg and Compose variable of the same name; Helm
  `ingress.maxBodySize` (default `64m`) sets the ingress-nginx body limit.
  Reverse-proxy settings (nginx, Traefik, Caddy, Cloud Run, Container Apps,
  ECS): [self-hosting](../self-hosting.md#file-uploads-and-request-size-limits).

## Security

- Files are stored through the configured storage provider in a new
  private `form-files` bucket (`<workspace>/<form or task>/<uuid>/<name>`),
  never served by `/files`. `GET /attachments/<id>` authorises each
  download — the uploader; a task's people (assignee, collaborators, team,
  managers, **View all tasks**, queue managers); a submission's submitter
  and **Edit forms** — and redirects to a link signed for five minutes.
  Responses are `Content-Disposition: attachment` (raster thumbnails
  inline), `nosniff`, sandbox CSP, not cached.
- Content is verified by magic bytes against the extension and the field's
  types; executables, scripts, shortcuts, macro-enabled Office files, disk
  images and HTML are refused whatever their name; SVGs are sanitised;
  names are cleaned; sizes are enforced by the field and the instance cap
  `FORM_ATTACHMENT_MAX_MB` (default 25, at most 45).
- Uploads are **pending** (bound to the uploader and the form / task
  field) until the form is submitted or the task saved; on submit the
  server rebuilds the value from its records, so forged or foreign file
  references are refused. Pending uploads expire after
  `FORM_ATTACHMENT_PENDING_HOURS` (24).
- Optional virus scanning: `FORM_ATTACHMENT_SCANNER=clamav` (`CLAMAV_HOST`,
  `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `FORM_ATTACHMENT_SCAN_FAIL_OPEN`);
  off by default.
- The workflow engine reads attachments for the run's own workspace only.

## Lifecycle

- Deleting a task or a submission (including retention policies) deletes
  its files; the new job **`form-files-cleanup`** (every 15 minutes,
  `/api/cron/form-files-cleanup`) removes them and expired pending uploads
  — rows and stored objects.
- Exports, packages and GitHub sync carry the field's settings; uploaded
  files never travel.

## Upgrading

- **Migration `20261120000000_form_files.sql`** (additive): table
  `form_files` (service role only) and, on Supabase, the private
  `form-files` storage bucket. Other storage providers create the bucket on
  first upload (or map it with `STORAGE_BUCKET_MAP`).
- `next.config.ts` sets `proxyClientMaxBodySize` from
  `FORM_UPLOAD_MAX_BODY_MB` (default 50 MB; the proxy cut bodies at 10 MB).
- New optional environment variables: `FORM_ATTACHMENT_MAX_MB`,
  `FORM_ATTACHMENT_PENDING_HOURS`, `FORM_ATTACHMENT_PENDING_LIMIT`,
  `FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES`, `FORM_UPLOAD_MAX_BODY_MB`,
  `FORM_ATTACHMENT_SCANNER`, `FORM_ATTACHMENT_SCAN_FAIL_OPEN`,
  `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`.

## Also added

- **Start forms with attachments:** an attachments input
  (`{ type: "array", format: "attachments", attachments: {…} }`) in
  **Design start form**, the Run dialog (plain view too), **Save & Test**
  and **Publish as form page**. Values flow as `{{<input>}}` (a list of file
  objects) and `{{<input>_count}}`. Uploads go into the workflow's start
  context (`workflows.activate`; test runs use the test context, cleaned up
  after 24 h); `POST /workflows/start` rebuilds the list from the starter's
  uploads, and the engine binds the files to the run (`form_files.run_id`)
  — deleting the run deletes them.
- **API / MCP / CLI uploads:** `POST /api/v1/files/uploads` (base64 or
  multipart for small files; otherwise a signed upload URL) and
  `POST /api/v1/files/uploads/{id}/complete`, scoped to a task, a form or a
  workflow start. Pass the returned file ids as field values in
  `POST /tasks/{id}/action`, `POST /forms/{id}/submit` and
  `POST /workflows/start` (the server rebuilds the values; other people's,
  other contexts' and made-up ids are refused). MCP `files_upload`
  (base64, 5 MB), `files_upload_init`, `files_upload_complete`; SDK
  `client.uploadFile(context, file)`; CLI `usertasks files upload <path>`
  and `--attach field=path` on `tasks complete`, `forms submit` and
  `workflows start` (`--file` is already the CLI's request-body flag).
- **AI agent steps take files:** Run Agent → **Files**. Images go to vision
  models (OpenAI, Azure OpenAI, Claude and Gemini through their
  OpenAI-compatible APIs) as images, PDFs to OpenAI as documents, and
  everything else — PDFs on the other providers included — as extracted
  text (PDF, Word, Excel, PowerPoint, text; one isolated helper,
  `extractFileText`). Limits: 10 files, 50 MB, 5 MB per image, 100 PDF
  pages, 100,000 characters per file and 300,000 in all, with clear errors.
  Files are read for the run's workspace; agents get a `read_attached_file`
  tool (by file id); run logs and agent runs keep names and sizes only.
