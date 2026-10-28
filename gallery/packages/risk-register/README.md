# Risk register

A risk register with intake, rating, owner review and a weekly re-review, built only from UserTasks features: the **Risks** data table, a reusable **form page** (grid layout, header, red compact mini theme) with a **Person** field for the owner, the **Form submitted** trigger, the **Risk rating** decision table, **Set SLA**, an owner task with **Accept / Mitigate / Escalate** buttons, manager **escalation**, a weekly **schedule** with a **loop** and a **sub-workflow**, and email templates.

## After installing

1. Share **Forms → Raise a risk** (`/f/<id>`).
2. Set the committee address in the **Risk committee email** steps (both workflows).
3. Put owners' user ids in **Owner (user id)** for the sample risks you keep (or delete them). New risks get it from the form.

## Rating matrix

| Score (L × I) | Rating | Owner review SLA | Review every |
|---|---|---|---|
| 20-25 | Extreme | 2 days | 14 days |
| 12-19 | High | 5 days | 30 days |
| 6-11 | Medium | 10 days | 90 days |
| 1-5 | Low | 20 days | 180 days |

## Workflows

- **Risk submission** (entry, Form submitted): score → rating → SLA → register row → owner review. Mitigate stores the plan and the residual score; Escalate marks it escalated and emails the committee.
- **Weekly risk review** (Monday 08:00): lists open risks with `next_review` on or before today, loops over them and calls **Risk periodic review** for each, then emails the committee the list.
- **Risk periodic review** (sub-workflow): the owner presses **Still valid**, **Rating changed** (re-rated by the matrix) or **Close risk**.
