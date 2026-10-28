# IT equipment loans

A loan desk for laptops, phones, headsets and other shared kit, built only from UserTasks features: a **form page** with a grid layout, header and mini theme, a **lookup** into the Loan pool table (filtered to available devices) that fills the serial and pick-up location, a **Person** field for the manager, an approval task with **Approve / Reject** buttons, the **Loans** table, and a **Return check** sub-workflow whose task has a **reminder** the day before the due date.

## After installing

1. Open **Forms → Equipment loan request** and share its page link (`/f/<id>`).
2. Replace the sample rows in **Loan pool** with your devices. Status drives the form: only `Available` devices are listed.
3. Return check tasks go to the installer. Point the **Check the device back in** step at your IT desk person or group if that is someone else.

## How it works

- **Equipment loan** (Form submitted): logs the request (`Requested`), then the manager chosen on the form approves or rejects. Approval re-reads the device; if it is still `Available` it becomes `On loan`, the loan row is updated and the borrower gets the *Loan approved* email. If it was taken meanwhile, or the manager rejects, the borrower gets *Loan not approved*.
- **Return check** (sub-workflow, async): a check-in task due on the return date with a reminder 24 hours before and escalation three days after. **Checked in** records the condition and returns the device to the pool (`Repair` when damaged or missing parts); **Extend loan** moves the due date; **Not returned** marks the loan `Overdue`, emails the borrower and waits again.
