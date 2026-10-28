# Workday time-off request sync

Every 30 minutes, time off requests updated in Workday are synced to the **Team calendar** data table. Requests that need cover (critical roles, long absences, long-term leave) start a **Confirm time off cover** sub-workflow for the manager.

## Workday endpoint

Integration **Workday**: base URL `https://<your-services-host>/ccx`, OAuth 2.0 bearer token. Replace `acme` with your tenant.

| Reference | Method and path | Used for |
|---|---|---|
| Get time off requests | `GET /service/customreport2/acme/ISU_UserTasks/Time_Off_Requests_Updated?format=json&Updated_From=…&Supervisory_Organization=…` | `Report_Entry[]` rows |

The report (an advanced custom report, enabled as a web service) returns one row per time off request with these fields:
`Request_ID`, `Worker_ID`, `Worker`, `Supervisory_Organization`, `Manager`, `Manager_Email`, `Time_Off_Type`, `Start_Date`, `End_Date`, `Total_Units`, `Unit_of_Time`, `Status`, `Critical_Role` (`1`/`0`), `Last_Updated`.
Prompts: `Updated_From` (date-time) and optionally `Supervisory_Organization`. If your field aliases differ, edit the loop's `req.*` mappings or rename the aliases in the report.

Prefer the Absence REST API? `GET /api/absenceManagement/v1/acme/workers/{id}/timeOffDetails` returns the same information per worker; swap the reference and loop over your team's workers.

## What is included

- **Workday time off sync** (entry, schedule every 30 minutes): RaaS call → loop → find/insert/update in **Team calendar** → **Cover check** decision table → async cover sub-workflow.
- **Confirm time off cover** (sub-workflow): manager task form with grid layout, header and **Confirm cover** / **Flag a gap** buttons; writes the result to the calendar row.
- Sample calendar rows so the table is not empty on install.

## Adapting it

- Change the interval on the Schedule trigger (hourly works well for large tenants).
- Rows already marked `confirmed` are never re-checked, so a changed request does not ask the manager twice.
- The run completes on its own; the cover checks wait in the managers' inboxes.
