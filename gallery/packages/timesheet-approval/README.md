# Timesheet approval

Weekly timesheets with calculated totals and an overtime check, built only from UserTasks features: the **Projects** and **Timesheets** data tables, a reusable **form page** (five-column grid for Mon–Fri, header, blue compact mini theme) with a project **lookup** that fills client and billable, **Person** fields for the approver and overtime checker, the **Form submitted** trigger with a success screen, the **Timesheet checks** decision table, approval task forms with **Approve** / **Reject** buttons and comments, and an email template.

## After installing

1. Put your projects in **Projects** (`code` is what the form stores; `rate` drives the billable value).
2. Share **Forms → Weekly timesheet** (`/f/<id>`). People submit one timesheet per project per week.
3. Optional: change the overtime threshold in **Timesheet checks**.

## How it works

- Totals: `SUM(Mon…Fri)`; overtime is anything above 40 hours; billable value = total × project rate for billable projects.
- **Approver review** goes to the Person picked on the form. **Reject** records the comment and emails the employee to fix and resubmit.
- If **Timesheet checks** says so (over 40 hours, with a stronger note above 55), an **Overtime check** follows, assigned to the overtime checker (or the approver again when none was picked).
- Approved timesheets add their hours to the project's **Hours approved so far**, so you can watch the budget.
