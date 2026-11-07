# Release notes: forms in governance

Forms and their submissions are now governed like workflows and data
tables: access grants, retention, legal hold, the audit log and deletion all
cover them, in the app and on the API, MCP and CLI.

## Added

- **Object permissions**: **Settings → Governance → Object Permissions**
  lists forms next to workflows, data tables, agents and integrations, with
  a **Forms** filter. Selecting a form manages its grants with **View** and
  **Submit** columns (the same grants as the form's **Details → Access**).
  For forms a grant shows as *Granted* rather than *Restricted*: it lists
  the form in people's Forms menu (Available forms) and doesn't lock anyone
  out.
- **Retention for forms**: retention policies have a new **Forms
  (submissions)** scope. A form's policy governs its submissions: purge
  policies delete submissions as they come due, together with the files
  uploaded with them (unless a task also uses a file); review policies open
  a review of the form; while a policy is assigned it replaces the form's
  **Keep submissions** setting. Assign it in the form's **Details →
  Retention** (which also shows the status and the number of stored
  submissions) or in **Settings → Governance → Retention**, which now lists
  every form under *Forms and submissions* with its policy, status and hold.
- **Legal hold** on forms (form Details → Retention): a held form keeps
  every submission and file — retention purges and Keep submissions skip
  it — and can't be deleted until the hold is released. Needs **Manage
  roles** (`team.change_roles`).
- **Audit**: grant changes are now recorded on every object (`grant` /
  `revoke`, for example *Gave role "Member" View, Submit on form "Expense
  claim"*), and so are retention-policy changes (`retention`). Forms also
  record Available forms toggles (`toggle`), submission purges (`purge`,
  with counts, never values), legal holds (`legal_hold` /
  `legal_hold_release`) and deletes with the number of submissions, files
  and grants removed. **Settings → Governance → Audit Log** has a new
  *Object changes* list filterable by object type (Form among them) and
  action, with friendly labels; **Activity** uses the same labels.
- **REST**: `GET` / `POST /api/v1/object-permissions` and
  `DELETE /api/v1/object-permissions/{id}` (every object type),
  `GET /api/v1/forms/{id}/governance`, `POST /api/v1/forms/{id}/legal-hold`;
  `POST /retention-policies/assign` takes `target_type: form`, and a policy's
  `assets` include `forms`.
- **MCP**: `object_permissions_list`, `object_permissions_set`,
  `object_permissions_remove`, `forms_governance_get`, `forms_legal_hold`;
  `retention_policies_assign` takes `form`, `retention_policies_list_assets`
  lists forms.
- **CLI**: `usertasks object-permissions list|set|remove`,
  `usertasks forms governance|legal-hold`, `usertasks retention assign
  --set target_type=form …`, `usertasks audit-log list --object-type form`.
- **Config as code / GitHub sync / packages**: a form's retention policy
  travels with it (remapped on import; `with_dependencies` brings the
  policy). Grants, legal holds and submissions don't travel
  ([export coverage](../export-coverage.md)).

## Changed

- **Deleting a form** also removes the files uploaded with its submissions
  and on its page, and its grants (they used to be left behind), and is
  refused while the form is on legal hold. It stays immediate: forms aren't
  queued like workflows because form pages, package uninstalls and form
  themes need the form gone at once.
- The **Keep submissions** cleanup deletes the files only those
  submissions held, writes a `purge` audit entry, and skips forms on legal
  hold or with a retention policy.
- Grants on forms store Edit and Delete as off (forms only use View and
  Submit); editing and deleting forms stays with the `forms.edit` and
  `forms.delete` role permissions.
- The Forms permission descriptions in Roles & Permissions say what each
  covers (submissions, retention, legal hold); **Manage roles** now says it
  covers grants, retention assignments and legal holds.

## Migration

`20261213000000_forms_governance.sql` (additive, idempotent): `forms` gets
`retention_policy_id`, `retention_applied_at` and the legal-hold columns;
`forms` is added to the retention-policy scopes and `form` to the retention
review and execution targets, keeping the values already allowed.
