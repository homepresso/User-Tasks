# ServiceNow change approval

ServiceNow sends a change for approval. UserTasks routes it with the **CI criticality** table and the **Change risk route** decision table, gives the reviewer a task with **Approve** / **Request info** / **Reject** buttons and writes the decision back to the approval record.

## Endpoints called (integration "ServiceNow", base `https://acme.service-now.example.com/api/now`)

| Reference | Request | Used for |
|---|---|---|
| Get change request | `GET /table/change_request/{sys_id}?sysparm_display_value=all` | `result.type.value`, `result.risk.display_value`, `result.cmdb_ci.display_value`, window, plans, conflicts |
| Find pending approval | `GET /table/sysapproval_approver?sysparm_query=sysapproval=<sys_id>^state=requested&sysparm_limit=1` | `result[0].sys_id` of the approval to act on |
| Set approval | `PATCH /table/sysapproval_approver/{approval_sys_id}` body `{"state": "approved" \| "rejected", "comments": "..."}` | Approve / Reject (also used to auto-approve standard changes) |
| Add change work note | `PATCH /table/change_request/{sys_id}` body `{"work_notes": "..."}` | Request info |

## Adapting it

- **Approving on the change instead of the approval record**: if your process does not use approval records, point Set approval at `PATCH /table/change_request/{sys_id}` with `{"approval": "approved"}` (or move the state) and drop Find pending approval.
- **Several approvers**: Find pending approval returns the first requested record; narrow `sysparm_query` with `^approver=<integration user sys_id>` or `^group.assignment_group=<CAB group>`.
- **Risk names**: the route table matches the risk display values (Very High, High, Moderate, Low) and change types `normal`, `standard`, `emergency`. Change them if your instance uses other choices.
- **Request info** only adds a work note. ServiceNow keeps the approval requested; when the requester updates the change, have the business rule post it again.
- Comments are inserted into a JSON body as text: keep them free of double quotes or use a JSON body in the reference editor.
