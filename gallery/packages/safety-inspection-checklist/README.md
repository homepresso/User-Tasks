# Safety inspection checklist

Monthly workplace safety inspections, built only from UserTasks features: a monthly **schedule**, a **loop** over the **Inspection sites** table, a **Site inspection** sub-workflow per site (`call_sub_workflow`, async) whose task form is a checklist (**boolean checks**, **headings and dividers**, a compact **grid**, a mini theme) with **Pass / Fail** buttons, a corrective action task, the **Inspections** table, reminders, escalation and an email template.

## After installing

1. Replace the sample rows in **Inspection sites** (site code, name, type, site manager and email, *Inspect monthly*).
2. Edit the checklist on **Site inspection → Inspect the site** if your sites need other checks (keep the failed-checks count in **Count failed checks** in line).
3. The schedule runs on the 1st at 07:00 Pacific/Auckland; inspectors have `days_to_inspect` (14) days.

All tasks go to the installer (the safety lead) because sites have no app users. To send inspections to your inspectors, set a group or person on the **Inspect the site** step.

## How it works

- **Monthly safety inspections** lists the sites, starts a **Site inspection** run per site and gives the safety lead a **Sign off** task for the round.
- **Site inspection** adds a `Scheduled` row (`<site>-<YYYY-MM>`), then the checklist task. **Pass** records the result. **Fail** counts the unticked checks, records them, sets the site's last result to `Fail`, emails the site manager and raises a **Corrective action** (due in 7 days) with **Action completed** or **Inspect again**.
