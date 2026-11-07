# Contract review & approval

From draft to an approved entry in the contract register: a stepped request form, a legal review against your clause playbook, a redline of every revision, an approval chain and a register that shows renewals due. Built only from UserTasks features: no e-signature or integration needed.

## What's inside

- **Contract review request** form page: four numbered steps (The contract → Term & value → Document → Approvals & submit), Application mode with in-form **Next**, **Back** and **Send for review** buttons, conditional fields and form rules
- **Contract register** page: **Renewals due** (base filter: renewal decision in the next 90 days) and **All contracts** (editable status, saved back for each changed row) Data tables with currency, date, check-mark and badge formats, and a row click that opens **Contract details**
- **Contract review** workflow (Form submitted trigger): register, legal review with a clause checklist, changes with a **Compare Documents** redline, finance and general counsel approval, emails
- **Contract approval route** decision table: finance and / or general counsel approval by risk, value and deviations
- **Contract register** data table (ten sample contracts) and **Clause playbook** data table (twelve clauses)
- Three emails: approved, not approved, changes requested

## After installing

1. Share **Forms → Contract review request** (`/f/<id>`) with contract owners, and **Forms → Contract register** with legal and finance (**View data**; **Manage rows** to change a status).
2. Edit the **Clause playbook** to your standard positions, fallbacks and must-have clauses.
3. Tasks go to the person who installed the package: point **Legal review** and **General counsel approval** at your legal team. **Finance approval** goes to the approver named on the form, or the installer.
4. Review **Contract approval route**:

| Rule | Finance | General counsel |
|---|---|---|
| High risk and NZD 250,000 or more | yes | yes |
| High risk | no | yes |
| NZD 1,000,000 or more | yes | yes |
| NZD 250,000 or more | yes | no |
| Three or more playbook deviations | no | yes |
| Anything else | no | no (legal approval is enough) |

5. Configure email (`EMAIL_PROVIDER`) so owners hear back.

## What it shows

- **Steps with a numbered stepper** and **Application mode**: the form's own Next / Back / Send for review buttons, no bottom bar.
- **Form rules** (**Rules** tab): the board approval reference only appears for NZD 1,000,000 or more (Always → hide) and is then required (Before submit); the end date must be after the start date; an auto-renewing contract needs its notice period; choosing the other side's template shows a note.
- A **Data table in a task form**: legal ticks deviations in the Clause playbook (select mode, several rows), and a **Row selected** rule flags must-have clauses.
- **Compare Documents** between versions: similarity, insertions and deletions, and a PDF redline, shown to legal on the next review.
- **Data table** pages with a "renewal within 90 days" base filter, status and risk badges, **row clicked → copy values and go to the details tab** and **for each changed row → update the Contract register**.

The playbook, thresholds and renewal rule are examples to adapt; nothing here is legal advice.
