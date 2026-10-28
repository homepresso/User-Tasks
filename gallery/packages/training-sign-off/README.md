# Training sign-off

Course completions signed off by a trainer, built only from UserTasks features: the **Courses** and **Training records** data tables, a reusable **form page** (grid layout, header, green mini theme) with a course **lookup** and a **Person** field for the trainer, the **Form submitted** trigger, task forms with **Sign off** / **Needs more work** and **Resubmit** / **Withdraw** buttons, an email template and a seven-year retention policy.

## After installing

1. Put your catalogue in **Courses**. `validity_months` drives the expiry date (0 = never expires); `evidence` tells trainees and trainers what is expected.
2. Share **Forms → Training completion** (`/f/<id>`).
3. Optional: apply **Training records: 7 years** to **Training records**.

## How it works

1. The trainee submits the form; the course lookup fills its title, validity and expected evidence.
2. **Training sign-off** (Form submitted) adds a record (`awaiting sign-off`) and calculates the expiry date.
3. The trainer (the Person picked on the form) gets the sign-off task with a reminder after a day.
4. **Sign off** stores the assessment, sign-off date and expiry and emails the trainee. **Needs more work** sends the trainee a task with the trainer's comments; **Resubmit** goes back to the trainer with the new evidence link, **Withdraw** closes the record.

## Ideas

- Report on `expires_on` in Training records to see who needs a refresher next month.
- Add a schedule workflow that lists records expiring within 30 days and emails each trainee.
