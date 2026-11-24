# Expense desk

An app for expense claims: people submit a claim in a slide-in panel and follow it to payment, managers approve their team’s claims, and finance sees spend by category and department. All amounts are in USD.

## What's inside

| Asset | What it does |
|---|---|
| **Expense desk** (app) | Four pages: Home, My claims, Approvals, Insights. Sidebar navigation. |
| **Expense claim** (form) | The claim: who, department, approving manager, category (lookup), merchant, amount, date, purpose, receipts. |
| **Expense claim approval** (workflow) | Logs the claim, flags claims over the category limit, manager approval, finance payment. |
| **Expense categories** (data table) | Per-claim limits in USD, GL codes and guidance per category (8 rows). |
| **Expense claims** (data table) | The claims register the app's charts and grid read (12 sample claims). |
| **Expense approvals waiting** (report) | Open approvals and payments, for the Download button. |

## Pages

- **Home**: New claim (opens the form in a panel on the right), My claims, Approvals (managers only) and the expense policy link; KPIs for the amount claimed, the average claim, claims this month and approvals waiting; spend by category; your recent claims.
- **My claims**: your claims with the status of each, and the step-by-step timeline of your latest claim.
- **Approvals** (contributors): your approval queue with a quick-view drawer, the approval SLA, approvals finished on time per week, time to approve, and a Download button for everything still open. The Period filter drives the trend charts.
- **Insights** (contributors): spend by department, claims by status, a category by status pivot and the full register grouped by status. Click a claim to open it in a side panel.

## Roles

- **Viewers** see the pages they can open but never the buttons that submit or approve. Use this for leadership who only read the numbers.
- **Contributors** can submit claims and approve the tasks assigned to them. Give this role to everyone who claims and to managers.
- **Editors** change the app in the builder. The person who installs the package is its first editor.

Nobody can use the app until you share it: open **Apps → Expense desk → Settings → Audience** after install.

## Customise it

- **Policy**: edit the Expense categories rows (limits, GL codes, guidance). The form reads them as you type.
- **Who pays**: the install asks who receives the "Pay the claim" step; change it later in the workflow designer (for example to a finance team).
- **Approval rules**: add a condition before "Manager approval" (for example a second approver over $2,000).
- **Look**: change the accent colour, icon or navigation style in the app's settings; widgets follow your workspace theme in light and dark mode.
- **Data**: delete the sample rows in Expense claims when you go live. New claims are added by the workflow.
