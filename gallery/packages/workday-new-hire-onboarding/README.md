# Workday new hire → onboarding

A Workday **Hire** event starts onboarding: the worker is read from Workday, the job family checklist and the Workday onboarding plan are applied, IT provisioning starts as a sub-workflow and the hiring manager prepares the first week on a task form.

## Workday endpoints

All calls go through the **Workday** integration (base URL `https://<your-services-host>/ccx`, OAuth 2.0 bearer token). Replace `acme` with your tenant name.

| Reference | Method and path | Used for |
|---|---|---|
| Get worker | `GET /api/staffing/v6/acme/workers/{worker_id}` | `descriptor`, `workerId`, `primaryWorkEmail`, `businessTitle`, `hireDate`, `primaryJob.jobProfile` (+ `jobFamily`), `supervisoryOrganization`, `manager`, `location` |
| Get onboarding plan | `GET /service/customreport2/acme/ISU_UserTasks/Onboarding_Plan_Tasks?format=json&Worker_ID=…` | RaaS report: `Report_Entry[]` with `Onboarding_Plan`, `Task`, `Due_Date`, `Status` |

## Start it

POST to the workflow start API or its inbound webhook:

```json
{"worker_id": "3aa5550b7fe348b98d7b5741afc65534", "event_id": "c0ffee00a1b2c3d4e5f60718293a4b5c", "hire_date": "2026-11-16"}
```

In Workday, subscribe an outbound integration (or a business process notification step) to the Hire business process and post the worker WID.

## What is included

- **Workday new hire onboarding** (entry): Get worker → checklist row for the job family → Get onboarding plan → New hire log → **IT provisioning** (async sub-workflow) → hiring manager task (lookup, equipment choice, buddy, grid layout, header, **Ready for day one** / **Not ready** buttons) → welcome email.
- **IT provisioning** (sub-workflow): ready-by SLA and an IT task with **Provisioned** / **Blocked** buttons.
- Data tables **Onboarding checklist by job family** (sample rows) and **New hire log**; a 24-month retention policy; the **Welcome to the team** email.

## Adapting it

- Workday REST versions differ by tenant: if your worker resource nests the organization and manager under `primaryJob`, change the output paths of **Get worker** in Integrations (the response model shows every field).
- If you prefer the Workday Onboarding web service or an EIB, replace **Get onboarding plan** with that call; only `plan_tasks` and `plan_name` are used.
- Add job families to the checklist table; the lookup on the manager's form lists them.
