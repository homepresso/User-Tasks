# Petty cash claims

Online petty cash, built only from UserTasks features: a **form page** (grid layout, header, a green mini theme) with a **lookup** into **Petty cash cost centres** that fills the budget holder and GL account, a **Person** field for the approver, a **currency** amount and a receipt link, a **Submit claim** button that **starts the workflow** and shows a **success screen**, the **Petty cash limits** decision table, an **Approve / Reject** task and the **Petty cash ledger**.

## After installing

1. Share **Forms → Petty cash claim** (`/f/<id>`).
2. Replace the sample **Petty cash cost centres** (code, name, budget holder, monthly float, GL account; untick Active to hide one).
3. Review **Petty cash limits**:

| Rule | Result |
|---|---|
| Over NZD 250 | declined: use an expense claim |
| No receipt and over NZD 20 | declined: receipt needed |
| Takes the cost centre over its monthly float | budget holder approves |
| Up to NZD 50 with a receipt | paid without approval |
| Anything else | budget holder approves |

## How it works

**Submit claim** starts **Petty cash claim** with the form values as its inputs and shows the success screen with the run reference; the workflow reads the cost centre, sums this month's `Paid` rows for it, applies the rules, writes the claim to the ledger as `Awaiting approval`, and then marks it `Paid` (with the GL account) or `Rejected` and emails the claimant.
