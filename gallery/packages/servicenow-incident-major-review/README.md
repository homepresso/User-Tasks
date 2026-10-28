# ServiceNow major incident review

ServiceNow posts an incident; UserTasks reads it, applies the **Major incident criteria** decision table and gives the incident manager a review task with **Declare major incident** / **Not a major incident** buttons. The decision goes back to ServiceNow as a work note.

## Endpoints called (integration "ServiceNow", base `https://acme.service-now.example.com/api/now`)

| Reference | Request | Used for |
|---|---|---|
| Get incident | `GET /table/incident/{sys_id}?sysparm_display_value=all&sysparm_exclude_reference_link=false` | `result.number.value`, `result.short_description.value`, `result.priority.value` / `.display_value`, `result.impact.value`, `result.urgency.value`, `result.assignment_group.display_value`, `result.cmdb_ci.display_value` |
| Update incident | `PATCH /table/incident/{sys_id}` body `{"work_notes": "...", "major_incident_state": "accepted" \| "rejected"}` | Work note with the decision; major incident state (Major Incident Management plugin) |

With `sysparm_display_value=all` every field comes back as `{"display_value", "value"}` (reference fields also carry `link`), which is why output paths end in `.value` or `.display_value`.

## Starting it from ServiceNow

An async business rule on **incident** (when: after insert, or priority changes to 1 or 2):

```javascript
var r = new sn_ws.RESTMessageV2();
r.setEndpoint('<workflow webhook URL>');
r.setHttpMethod('POST');
r.setRequestHeader('Content-Type', 'application/json');
r.setRequestBody(JSON.stringify({ sys_id: current.getUniqueValue(), number: current.getValue('number'), event: 'inserted' }));
r.executeAsync();
```

## Adapting it

- **No Major Incident Management plugin?** Remove `major_incident_state` from the Update incident body and inputs; the work note still records the decision.
- **Basic auth** instead of OAuth: change the integration auth type and enter the user and password.
- **Criteria**: edit the Major incident criteria rules (priority / impact / urgency / service tier → candidate, severity, cadence, bridge). The last rule is the catch-all.
- **Services**: the CI display value is matched against `ci_name` in Business services; unknown CIs are treated as tier 3 and notify major-incidents@example.com (change it in the review form default).
- Work notes are inserted as text into a JSON body, so keep decision notes free of double quotes or switch the reference to a JSON body in the editor.
