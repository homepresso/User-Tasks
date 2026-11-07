# Release notes: Task attachments

Every task now has an **Attachments** tab. People who work on a task attach
contracts, invoices, receipts, photos and other evidence to it, each with a
name, a type and a description. Everyone who can see the task can open
them, and workflows can use them.

## Added

- **Attachments tab** on every task:
  - The list shows name, type badge, description, file name and size, who
    added it and when, with Preview (images), Download and Delete.
  - **Add attachment** takes a file by drag and drop or picker, a name, a
    type and a description, and shows upload progress.
  - The tab shows a count. People who can see but not work on the task get
    a read-only list.
  - On phones the rows stack and the dialog opens as a bottom sheet.
- **Types** are free text with suggestions: Contract, Invoice, Receipt,
  Evidence, Image, Other, then the workspace's own types.
- **Workflows**:
  - User Task steps output `attachments`: the files attached before the task
    was completed.
  - Task-triggered workflows read `{{task.attachments}}`.
  - Both are typed in the data picker, so a Loop's `{{item}}` shows the
    attachment's fields. File steps (Read Document, Convert, PDF, OCR, Read
    File, Send Email attachments) take an attachment directly.
- **Add Task Attachment** workflow step: files a generated or downloaded file
  on a task, with a name, type and description. It outputs `attachment`.
- **Events**: adds and deletes go on the task timeline. The event stream
  carries them as `task.attachment_added` and `task.attachment_deleted`.
- **API, MCP and CLI**:
  - REST: `GET|POST /api/v1/tasks/{id}/attachments`,
    `POST …/{attachmentId}/complete` (direct uploads), `DELETE
    …/{attachmentId}` and `GET …/{attachmentId}/download` (a 5-minute
    signed link).
  - MCP: the `tasks_attachments_*` tools.
  - CLI: `usertasks tasks attachments | attach | attachment-download |
    attachment-delete`.
  - SDK: `uploadTaskAttachment`.

## Security and governance

- **Who can do what**:
  - Anyone who can see the task reads its attachments: the assignee,
    collaborators, team members, managers of an assignee, the assigner, and
    holders of View all tasks or Manage queue.
  - People who can work on the open task add them.
  - The uploader, or anyone with Delete tasks, deletes them.
  - Row-level security applies the same rules to direct database access.
- **Upload checks** are the same as for form attachments:
  - size limit (`FORM_ATTACHMENT_MAX_MB`);
  - type checked against the file's content;
  - blocked programs and scripts;
  - SVG sanitising;
  - the virus scanner, when one is configured.
- **Storage** works with every provider: files sit privately in the
  `form-files` bucket, and every request through `/attachments/<id>` is
  checked before a short-lived signed link is handed out. Direct uploads
  are used where the storage provider signs them.
- **Audit**: every add, delete and download is written to the audit log on
  the task.
- **Retention and legal hold** follow the task's reusable form:
  - The form's retention policy purges the attachments of its closed tasks,
    together with its submissions.
  - The form's legal hold blocks deletes and purges.
  - Deleted attachments are purged after 30 days
    (`TASK_ATTACHMENT_DELETED_RETENTION_DAYS`).
- **Exports** never include attachments. Like submissions they are runtime
  data; see [What an export covers](../export-coverage.md).

## Upgrade

Apply `supabase/migrations/20261222000000_task_attachments.sql` before
deploying. It adds `task_attachments`, `task_attachment_purges` and two
lifecycle event types, and is additive and idempotent. Until it is applied,
the Attachments tab shows an error and the new step fails. Nothing else
changes.

Docs: [Tasks → Attachments](/docs/tasks/attachments).
