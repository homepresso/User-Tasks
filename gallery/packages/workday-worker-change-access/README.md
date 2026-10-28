# Workday worker change → access update

When a worker's job, organization or employment changes in Workday, this package works out which access should be removed and added, logs the request and asks the manager to approve it. The decision goes back to Workday as a comment on the business process event.

## Workday endpoints

Integration **Workday**: base URL `https://<your-services-host>/ccx`, OAuth 2.0 bearer token. Replace `acme` with your tenant.

| Reference | Method and path | Used for |
|---|---|---|
| Get worker | `GET /api/staffing/v6/acme/workers/{{worker_id}}` | current `primaryJob.jobProfile`, `supervisoryOrganization`, `manager` |
| Get worker job history | `GET /api/staffing/v6/acme/workers/{{worker_id}}/history` | `data[0]` (this change: type, reason, effective date) and `data[1]` (previous job profile and organization) |
| Add business process comment | `POST /api/businessProcess/v1/acme/events/{{event_id}}/comments` | `{"comment": "…"}` with the decision |

## Start it

```json
{"worker_id": "8d2f6e1a4b7c4e0f9a3d5c7b1e2f4a6c", "event_type": "job_change", "event_id": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6"}
```

`event_type` is `job_change`, `org_move` or `termination`. Map your Workday business process types to these in the integration that posts the event.

## What is included

- Decision table **Access bundle mapping** (event type, job profile, organization → bundle code and review level), run for the new and the previous job.
- Data tables **Access bundles** (what each bundle grants) and **Access change requests** (the audit trail).
- A manager task form with a bundle **lookup**, remove-by date, grid layout, header and **Approve** / **Reject** buttons, with reminders and escalation to the manager's manager.

## Adapting it

- Provisioning in the identity system (Entra ID, Okta, SailPoint…) is deliberately out of scope: approved rows have status `approved: queued for identity provisioning`. Add a data-table-event workflow or your IAM connector to act on them.
- If your tenant's history resource has a different shape, adjust the output paths of **Get worker job history**; only the six mapped outputs are used.
- The comment calls continue on error, so a Workday permission problem does not lose the decision.
