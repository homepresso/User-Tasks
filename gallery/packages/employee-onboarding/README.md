# Employee onboarding

New hire to settled in: HR record, IT setup, buddy, first-week plan, welcome email and a 30-day check-in.

## What's inside

- **New starter** form page: four steps with a progress bar (The role → Contract & start → Manager → Review & submit), Application mode with in-form **Next**, **Back** and **Start onboarding** buttons, a department autocomplete, conditional contract fields and form rules
- **New starters** page: a Data table of every hire (search, filters, sorting, date / relative-time / badge formats), a row click that opens the details tab, and editable status and notes saved back to the table
- **Employee onboarding** workflow (started by the New starter form, the Run dialog or the start API)
- **New starters** data table: one row per hire, kept up to date by the workflow (six sample rows)
- **IT setup** sub-workflow, started in the background for each new hire
- **Onboarding track** decision table (employment type × location → track, IT lead days, orientation)
- **Onboarding checklist** data table with six sample departments
- **HR system** integration with *Create employee*, **IT service desk** integration with *Create provisioning request*
- Two email templates: welcome and IT setup blocked

## After installing

1. Complete setup: both base URLs and API tokens, the default hiring manager and the default IT owner.
2. Edit the checklist rows and track rules to your departments and lead times.
3. Share **Forms → New starter** (`/f/<id>`) with HR, and **Forms → New starters** with HR and the hiring managers (reading the table needs **View data**; saving a status needs **Manage rows**).
4. Or start an onboarding from **Automations → Workflows → Run**, or from your recruiting system:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"new_hire_name":"Jordan Lee","personal_email":"jordan.lee@example.net","job_title":"Software Engineer","department":"engineering","start_date":"2026-11-16","manager_name":"Priya Shah","location":"remote","employment_type":"permanent"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Prepare first week**, **Day-30 check-in** and **Prepare equipment and accounts** have outcome buttons, headers and grids.
- The IT step has a **Department kit** lookup into the **Onboarding checklist** that fills the laptop model and systems.

## New in 1.2.0

- **New starter** form page with steps and a progress bar, in Application mode: the form's own Next / Back / Start onboarding buttons, no bottom bar.
- The department autocomplete stores the checklist key (`engineering`) and shows "engineering · Platform team", and fills the laptop and buddy team.
- The contract end date shows only for fixed-term contracts and the agency only for contractors (Visible when).
- Form rules (**Rules** tab): the start date cannot be in the past; a fixed-term contract needs an end date after the start date; changing the employment type clears the contract details.
- **New starters** table, written by the workflow (Preparing → Ready for day one → Onboarded, or Withdrawn) with the employee id, track and IT ready-by date.
- **New starters** page: a Data table with formats, filters and a base filter for the last 90 days onwards; click a row to open its details, or change a status / note and **Save changes** (for each changed row → update the table).
- Upgrading from 1.1.0 keeps your checklist rows and track rules; the new table, forms and workflow steps are added.
