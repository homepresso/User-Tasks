# Legal request intake & triage

One front door for legal: NDAs, contract reviews, legal questions and disputes, routed to the right queue with an SLA, and a queue page for the legal team. Built only from UserTasks features: no integrations needed.

## What's inside

- **Legal request** form page: four steps with a progress bar (About you → The request → Urgency → Review & send), Application mode with in-form **Next**, **Back** and **Send to legal** buttons, questions that change with the request type, attachments, and form rules
- **Legal requests** page: **Open requests** (editable assignee and status, saved back for each changed row) and **All requests** Data tables with type, urgency and status badges, relative SLA times, search, filters and sorting, and a row click that opens **Request details**
- **Legal request** workflow (Form submitted trigger): routing, SLA, the Legal requests table, a tabbed lawyer task, a more-information loop with the requester and a general counsel review
- **Legal request routing** decision table: queue, SLA days and general counsel review by type, value, urgency and area of law
- **Legal requests** data table with eight sample requests
- Three emails: received, more information needed, closed

## After installing

1. Share **Forms → Legal request** (`/f/<id>`) on your intranet, and **Forms → Legal requests** with the legal team (they need **View data**, and **Manage rows** to save changes on the page).
2. Tasks go to the person who installed the package: point **Handle the request** and **General counsel review** at your legal team (a person, a team or a variable).
3. Edit **Legal request routing**:

| Rule | Queue | SLA (days) | GC review |
|---|---|---|---|
| Dispute or claim | Disputes | 2 | yes |
| Contract review of NZD 500,000 or more | Commercial | 5 | yes |
| Contract review, Critical | Commercial | 1 | no |
| Contract review | Commercial | 5 | no |
| NDA, Critical | Commercial | 1 | no |
| NDA | Commercial | 2 | no |
| Employment question | Employment | 3 | no |
| Privacy or IP question | Privacy & IP | 3 | no |
| Critical question | General counsel | 1 | yes |
| Anything else | General counsel | 5 | no |

4. Configure email (`EMAIL_PROVIDER`) so requesters hear back.

## What it shows

- **Steps and a progress bar** with **Application mode**: the form's own Next / Back / Send to legal buttons, no bottom bar.
- **Conditional sections**: NDA, contract, question and dispute fields appear only for their request type (Visible when on each field), so hidden ones are never required.
- **Form rules** (**Rules** tab): the urgency reason only appears for High or Critical (Always → hide) and is then required (Before submit); a contract review needs the contract attached; the needed-by date cannot be in the past; choosing a dispute sets urgency to High and shows a note (Field value changes).
- **Data table** fields with a base filter (open statuses), badges, relative dates, filters by type, status, queue and assignee, **row clicked → copy values and go to the details tab**, and **for each changed row → update the Legal requests table**.
- A **tabbed task form** for the lawyer: the request on one tab, their outcome on the other, with Complete / Need more information / Decline buttons.

Routing and SLAs are examples to adapt; nothing here is legal advice.
