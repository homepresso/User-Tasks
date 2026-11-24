# Contract hub

An app for contract approvals and renewals: business owners submit contracts, legal and finance review them, and everyone can see the pipeline, the renewal decisions coming up and the full register. All values are in USD.

## What's inside

| Asset | What it does |
|---|---|
| **Contract hub** (app) | Four pages: Overview, Renewals, Register, My reviews. Top navigation. |
| **Submit a contract** (form) | Title, counterparty, type, value, start and end dates, renewal decision date, auto-renewal, owner, summary, documents. |
| **Contract approval** (workflow) | Adds the contract to the register, legal review, finance review over $50,000, signatures, then a renewal review due on the renewal decision date. |
| **Contract register** (data table) | Contracts with value, owner, term, renewal date and pipeline stage (12 samples). |

## Pages

- **Overview**: Submit a contract (opens the form in a side panel), Renewals, My reviews (contributors); total contract value, contracts in the register, open reviews, the approval pipeline as a funnel by stage and value by contract type.
- **Renewals**: a month calendar of the workflow's tasks by due date (renewal reviews fall on the renewal decision date) and the contracts whose renewal decision is soonest.
- **Register**: the contract register grouped by type, editable by people with Manage rows on the table; click a contract to open it in a side panel. Below it, value by type and stage.
- **My reviews** (contributors): reviews waiting for you, where contracts wait in the workflow, reviews on time by reviewer and time per review (Period filter).

## Roles

- **Viewers** read the pipeline, renewals and register but never see Submit a contract or review buttons. Good for leadership.
- **Contributors** submit contracts and complete the reviews, signatures and renewal reviews assigned to them.
- **Editors** change the app in the builder; the person who installs the package is the first editor.

Share the app after install in **Apps → Contract hub → Settings → Audience**.

## Customise it

- **Reviewers**: the install asks who reviews for legal and for finance; point the steps at teams later. Signature and renewal tasks go to the business owner chosen on the form.
- **Threshold**: change $50,000 in the "Over $50,000?" condition.
- **Renewals**: the renewal review is due on the renewal decision date with a reminder 14 days before; change both on the "Renewal review" step.
- **Look**: change the accent colour, icon or navigation in the app's settings. Widgets follow your workspace theme in light and dark mode.
