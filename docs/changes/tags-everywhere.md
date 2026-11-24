# Release notes: Tags on every object

Every object you build can now have tags — not just tasks, workflows, forms,
integrations, references, agents and workflow activities — and every object
list shows them.

## New

- **Tags on more objects:** data tables, reports, business rules, email
  templates, form controls (form plugins), apps and authored packages.
  Add them in the object's editor or settings (a business rule's Details,
  an email template, app Settings, the package editor, the new-table
  dialog, a report's Save dialog) or with **Tags…** on its row.
- **A Tags column in every list.** Workflows, Forms, Data tables, Saved
  reports (list and cards), Business rules (list and cards), Email
  templates, Form controls, Workflow actions, Apps, Packages,
  Integrations, Agents and Scheduled workflows show up to three coloured
  chips and **+N**. Click a chip, or use the **Tags** filter in the
  toolbar, to show only items with that tag.
- **Tags… on every row**, and **bulk add / remove** wherever a list has row
  selection (now also Data tables, Saved reports, Business rules and
  Workflow actions). Each change saves through the object's own update, so
  it needs permission to edit that object: `data.edit_schema` for data
  tables, `workflows.edit` for business rules and email templates,
  `extensibility.edit` for form controls, `apps.manage` or the app's
  editors for apps, `packages.manage` for packages, and for reports
  `reports.edit_own` on your own reports only.
- **Settings → Tags** counts and lists every object type, only the ones —
  and only the objects — you may see (other people's private reports stay
  hidden). The table shows a column per object type in use; rename, merge
  and remove reach every type in one transaction.
- **API, MCP and CLI:** `tags` on each object's create / update (trimmed,
  matched case-insensitively, at most 30 of at most 60 characters), a `tag`
  filter on each list (`tagged` for form controls, whose `tag` is the
  element name), and every new type in `/tags/objects` and `/tags/apply`
  (`data_tables`, `reports`, `business_rules`, `email_templates`,
  `form_controls`, `apps`, `packages`).
- **Config-as-code, packages and GitHub sync** carry an object's tags
  (workflows now too). Untagged objects export exactly as before, and a file
  without tags leaves an object's tags alone.

## Upgrade

Apply migration `20270122150000_tags_everywhere` (after
`20270121150000_tag_styles`). It is additive. Until it is applied these
objects show no tags and saving tags on them answers "apply migration
20270122150000".
