# Asset register & check-out

An equipment register with a self-service check-out form, built only from UserTasks features: the **Assets** data table, a reusable **form page** (grid layout, header, amber mini theme) with a **lookup** that fills the asset's details, a **Person** field for the borrower, the **Form submitted** trigger, a return **task form** with **Returned** / **Damaged** buttons and a **reminder**, an email template and a retention policy.

## After installing

1. Replace the sample rows in **Assets** with your own register (tag, name, category, location, condition, value). Only rows with Status `available` can be checked out.
2. Open **Forms → Asset check-out** and share its page link (`/f/<id>`) or put a QR code on the equipment cupboard.
3. Optional: apply **Check-outs: 2 years** to the **Check-outs** table and configure email so receipts are delivered.

## How it works

- The form's **Asset** lookup searches the Assets table (available items only) and fills name, category, location and condition.
- **Asset check-out** (Form submitted) reads the asset again and stops if someone else took it in the meantime; otherwise it marks the asset `checked out`, logs a row in **Check-outs** and emails the receipt.
- The borrower gets **Return the asset**, due on the due-back date with a reminder 24 hours before. **Returned** sets the asset back to `available` with the condition reported; **Damaged** sets it `in repair` and records the damage on the loan.

## Make it yours

- Add more categories or locations by editing the Assets columns.
- Want the store keeper to confirm returns instead of the borrower? Change the return task's assignee to `{{submitted_by}}`.
