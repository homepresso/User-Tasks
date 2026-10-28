# Employee onboarding

New hire to settled in: HR record, IT setup, buddy, first-week plan, welcome email and a 30-day check-in.

## What's inside

- **Employee onboarding** workflow (starts from a form: its inputs are the new hire form)
- **IT setup** sub-workflow, started in the background for each new hire
- **Onboarding track** decision table (employment type × location → track, IT lead days, orientation)
- **Onboarding checklist** data table with six sample departments
- **HR system** integration with *Create employee*, **IT service desk** integration with *Create provisioning request*
- Two email templates: welcome and IT setup blocked

## After installing

1. Complete setup: both base URLs and API tokens, the default hiring manager and the default IT owner.
2. Edit the checklist rows and track rules to your departments and lead times.
3. Start an onboarding from **Automations → Workflows → Run**, or from your recruiting system:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"new_hire_name":"Jordan Lee","personal_email":"jordan.lee@example.net","job_title":"Software Engineer","department":"engineering","start_date":"2026-11-16","manager_name":"Priya Shah","location":"remote","employment_type":"permanent"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Prepare first week**, **Day-30 check-in** and **Prepare equipment and accounts** have outcome buttons, headers and grids.
- The IT step has a **Department kit** lookup into the **Onboarding checklist** that fills the laptop model and systems.
