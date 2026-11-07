# Release notes: the form wizard

People who don't use the designers can now build forms, surveys,
questionnaires and request forms in seven plain-language steps. The wizard
creates the reusable form, a data table for the responses, an optional
review / approval workflow and a results page. They are linked together and
are ordinary objects the designers open. The full designers are unchanged.

**Migration required:** `supabase/migrations/20261229000000_form_wizard.sql`
(new permission + new table; additive and idempotent).

## New

- **Seven steps** (`/forms/wizard/new`; progress is autosaved and can be
  resumed from **My forms**, `/forms/wizard`):
  1. **What are you building?** Templates: Request / application, Survey,
     Questionnaire / quiz, Registration, Feedback, Incident, Blank. Then a
     name and description. **Describe it and we'll draft it** appears when
     the workspace has an AI provider integration (the first active one,
     the same kind agents use). The description is sent to that provider;
     nothing is stored.
  2. **Questions**: short / long answer, number, money, date, choice, choices,
     rating 1–5, recommend score 0–10, yes / no, email, phone, file upload,
     section heading and page break. Each can be required and have help
     text and options. **Show this question only if…** becomes an *Always*
     show rule (`lib/forms/form-rules.ts`). Quizzes can mark right answers
     to score responses. A live preview uses the real form renderer.
  3. **Look & feel**: workspace look, a saved form theme or an accent
     colour; header; one page / steps at page breaks / one question at a
     time; the Submitted page heading and message.
  4. **Who fills it in**: everyone or chosen roles / teams (Forms-menu
     grants); a public link if the workspace allows anonymous forms (embed
     code on the success screen); one response per person or many; opening
     and closing dates.
  5. **Review & approval**: none / one person / the requester's manager
     (reporting lines, with a fallback person) / a team (claimable) or Entra
     ID group / 2–5 stages. Each stage has Approve, plus optional Decline and
     Ask for changes. You can also set a due date per stage and email the
     requester with the decision.
  6. **Results page**: charts on or off, and the roles / teams who may see it
     besides the owner.
  7. **Review & create**: a plain summary of what will be made.
- **What Create makes** (`lib/services/form-wizard.ts`, one orchestration):
  - The data table "*name* responses": a column per question, plus
    `reference`, `submitted_by`, `submitted_by_email`, `submitted_at` and
    `status`. With a review it also gets `stage`, `decided_by`, `decided_at`
    and `decision_note`; quizzes get `score`. Plus `submission_id`.
  - The form, tagged `wizard`.
  - A workflow, published and active. "Form submitted" inserts the row. With
    a review, each stage is a User Task that shows the answers read only plus
    a comment box. Outcome branches write the status back to the row and
    email the requester. Each stage has its own branches, so there are no
    joins.
  - The public link and Forms-menu grants.
  - Saved reports (private to the owner): all responses, status counts, and
    one chart per choice / rating question.
  - The project row with a manifest of the ids.

  If any step fails, everything already created is removed, newest first,
  and the error is reported.
- **Results page** (`/forms/results/<project id>`):
  - Cards: responses, this week vs last week, waiting, approval rate (or
    average score).
  - Charts per question (counts, rating average, recommend score =
    promoters − detractors).
  - The responses table with search, status filter, order and paging.

  It can be opened by the owner, the chosen roles / teams, and `forms.edit`.
- **Edit with the wizard** applies an edited spec to the same objects:
  - Question keys are kept.
  - New questions add columns.
  - No column or data is ever dropped, and a kind change that would retype
    a column is refused.
  - The form gets a new version and the workflow is republished.
  - New chart questions get reports; grants and the public link follow the
    choices.
- **Entry points**: **My forms** in the side menu (`forms.wizard`); **Build a
  form** on Home; **+ New** and the command palette; Forms library **New form
  → Use the wizard (recommended) / Start blank**.
- **Submit-time policy** for wizard forms: `submitForm` refuses submissions
  before `opens_at`, from `closes_at`, and a second response from the same
  signed-in person when "one response per person" is on
  (`lib/services/form-wizard-policy.ts`). Other forms are unaffected.
- **New run variable**: the "Form submitted" trigger now sets
  `submitted_by_manager_id`, the submitter's manager from reporting lines
  (null when there is none or the visitor is anonymous). It is also listed in
  the designer's data picker.
- **API / MCP / CLI**:
  - REST:
    - `POST /api/v1/forms/wizard` (`dry_run` returns the plan)
    - `GET /api/v1/forms/wizard`
    - `GET` / `PATCH /api/v1/forms/wizard/{id}`
    - `GET /api/v1/forms/wizard/{id}/results`
  - MCP: `forms_wizard_create|update|list|get|results`
  - CLI: `usertasks forms wizard-create|wizard-list|wizard-get|wizard-update|wizard-results`

## Governance

- New permission **`forms.wizard`** ("Create forms with the wizard").
  Owner, Admin, Manager and Member have it by default; Viewer does not.
  - The migration adds it to those system roles in existing workspaces.
    Custom roles are not changed.
  - `PERMISSION_PAYLOAD_VERSION` is now 19.
  - It is in the OAuth `workflows:write` scope.
- **Least privilege.** After the `forms.wizard` check and the input checks,
  the wizard's own steps run in an internal context that holds exactly the
  build permissions they use, on a service-role client:
  - Input checks: roles, teams, people and themes belong to this workspace;
    the anonymous switch and Entra ID are on where the spec needs them.
  - Everything is created by and attributed to the person.
  - The person gains no build permission. A Member cannot open the
    designers; designer links are only shown to those who can.
- `form_wizard_projects`:
  - RLS: a person reads their own rows in their member workspaces.
  - No end-user writes; writes go through the service, which checks owner
    or `forms.edit`.
- Route guards: `/forms/wizard` needs `forms.wizard`. `/forms/results` needs
  `forms.submit`, and the project audience is checked server-side.

## Limitations

- The responses data table follows the workspace's normal data access:
  members with `data.view` can open it in **Data**. The results page itself
  is limited to the chosen audience.
- The opening date, closing date and one response per person are enforced
  when the form is submitted. The form still opens before or after the
  window and explains the refusal on submit. One response per person cannot
  apply to anonymous visitors.
- Ask for changes ends the run with status *Changes requested*. The person
  submits the form again; there is no in-place loop back.
- Ratings and recommend scores are radio / dropdown choices, not custom star
  controls (which would need a gallery control installed).
- Requester emails need an email provider. Without one, the email step is
  skipped and the workflow continues.

## Before deploying

Apply `20261229000000_form_wizard.sql`, then deploy the code. Until it is
applied:

- members do not have `forms.wizard`;
- the wizard pages report a database error;
- submitting a form is unaffected (the policy lookup ignores the missing
  table).
