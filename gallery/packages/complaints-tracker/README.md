# Complaints tracker

A complaints process with a built-in customer list, made only from UserTasks features: the **Customers** and **Complaints** data tables, a reusable **form page** (grid layout, header, violet mini theme) with a customer **lookup** that fills contact, tier and account manager, **Person** fields for the handler and escalation contact, the **Form submitted** trigger, the **Complaint priority** decision table, **Set SLA**, resolution task forms with **Resolve / Escalate** buttons, **manager escalation**, reminders and three email templates.

## After installing

1. Load your accounts into **Customers** (keep `account_no` unique: the form stores it).
2. Tune **Complaint priority**: rules are read top to bottom; the last one is the default.
3. Share **Forms → Log a complaint** (`/f/<id>`) with customer care.

## Priority rules (sample)

| Rule | Priority | Resolve within | Call back within | Account manager |
|---|---|---|---|---|
| Staff conduct (any tier) | P1 | 24 h | 2 h | yes |
| Platinum | P1 | 24 h | 2 h | yes |
| Gold, not billing | P2 | 48 h | 4 h | yes |
| Gold, billing / any billing | P2 | 72 h | 8 h | no |
| Silver | P3 | 96 h | 24 h | no |
| Everything else | P4 | 120 h | 24 h | no |

## How it works

The **Complaint handling** workflow (Form submitted) logs the complaint, bumps the account's open-complaint count, acknowledges the customer and gives the handler **Resolve the complaint**. **Escalate** marks it escalated, emails the account manager and hands it to the escalation contact, who can **Resolve** or **Return to handler**. On resolve, the customer gets the resolution text and any goodwill credit.
