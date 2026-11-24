# Revenue CRM

A complete CRM built as a UserTasks app: leads scored, routed and de-duplicated, a drag-and-drop pipeline with a manager-reviewed forecast, account 360 (with subsidiaries and support cases) and deal rooms in slide-in panels, quotes from a price book with a discount approval chain and a PDF, support cases with an SLA, activities with follow-up reminders, renewals and revenue insights. All amounts are in USD; the sample company (Brightwater Labs) and its customers are fictional.

## What's inside

| Asset | What it does |
|---|---|
| **Revenue CRM** (app) | Home, Pipeline, Forecast, Leads, Quotes, Accounts, Activities, Support cases, Revenue insights, plus Deal room and Account 360 panel pages and three Admin pages. Grouped sidebar navigation. |
| **12 data tables** | CRM accounts (40, with open pipeline, open deals, won value and parent account), contacts (120), leads (48), deals (157, with a manager forecast override and change history), deal line items (433, child records of deals), deal stage history (563), price book (10), activities (424), quotes (60), closed deals (90), customer health (16) and support cases (44). |
| **7 forms** | Website lead (public web-to-lead), Convert lead, New deal, Log activity, Quote and discount request (repeating section of products from the price book), Close a deal, New support case. |
| **12 workflows** | Lead intake (with repeat-lead merge), lead conversion, new deal, deal stage automation (data table event), log activity, quote approval (with the quote PDF), close deal, customer handoff (sub-workflow), renewal call (sub-workflow), daily sales checks (schedule), support case (SLA by priority), deal summary (Summarize button). |
| **3 decision tables** | CRM lead routing (territory, owner, response time), CRM stage rules (probability, forecast, stage task), CRM discount authority (approval path). |
| **5 email templates** | Lead thank-you, quote approved (with the quote PDF), quote not approved, deal won, case resolved. |
| **CRM account assistant** (agent, optional) | Summarises deals (with the workflow's data as context) and drafts emails. Ships without an AI provider: choose one to switch it on. |
| **CRM quote approvals waiting** (report) | Open approval tasks, for the Download button. |

## Pages

- **Home**: "Good to see you, *name*", buttons for New deal, Log activity and Request a quote; my open pipeline against a target (with its trend), team weighted pipeline, bookings against the yearly goal, the win rate gauge; deals closing this month (click one for its deal room), my tasks, my pipeline by stage and the latest activity.
- **Pipeline**: a Kanban board of open deals by stage with counts and totals per lane. Contributors who may manage rows drag cards (or use Move to); viewers see a fixed board. KPIs, a stage funnel, pipeline by region and by owner (click a bar to filter the whole page), the final forecast by close month and a grid of open deals grouped by stage (click a header to sort; save your own views). A card or a grid row opens the deal room.
- **Forecast**: commit, best case and pipeline by the *final* forecast, manager overrides, the final forecast by close month and a **Forecast review** grid: managers set *Manager override* (and a note) in place, the final forecast follows it, and the rep's category from the stage rules stays visible beside it.
- **Deal room** (panel): the deal (with its forecast, manager override, next best action, AI summary and change history), line items with their total, quotes and approvals, the buying team (the account's contacts and their roles), the activity feed and the stage history (who moved it, when), and Log activity, Request discount, Advance stage (with a confirmation), Close won, Close lost (asks first) and **Summarize** (a next best action from simple rules, plus an AI summary when the assistant has a provider). Forms open in a second panel on top, filled in from the deal.
- **Accounts**: customers, ARR, at-risk accounts and average health; account cards with health badges, ARR, open pipeline, open deals and won to date, ordered by ARR, open pipeline or won value, with search; ARR by industry and accounts by health. A card opens the **Account 360** panel:
  - tiles for open pipeline, won this year, won all time and open deals;
  - **Opportunities**: every deal of the account as cards (stage, amount, close date, owner, probability, forecast, last activity). *Open and won* shows first; *Open*, *Won*, *Lost* and *All* are one click away, so nothing is hidden for good;
  - deals by status and the win rate with the account;
  - the account record (with its parent account), contacts, the activity timeline, customer health, **support cases** and **subsidiaries** (each opens its own account 360 on top). New case opens the case form filled in.

  Clicking an opportunity opens its **deal room on top** of the account (the panels stack: Account → Deal); Back returns to the account.
- **Leads**: new leads, average score, leads to work and the response SLA; a grid grouped by status with touches and possible duplicates (click a lead to convert it with the form filled in; edit Owner in place to reassign); leads by source (click to filter) and per week by grade.
- **Activities**: my follow-ups, activity counts, a follow-up calendar, the latest activities and activities per week by type.
- **Support cases**: New case, open cases, SLA breached (click to filter), urgent and high cases, resolved this month; open cases soonest due first (edit status and owner in place) and all cases; cases by category, open cases by priority and SLA met or missed.
- **Quotes**: my approval queue, the approval SLA, pending value, all quotes grouped by status, quotes by status, approvals on time and time to approve.
- **Revenue insights**: closed won with its trend, win rate, sales cycle, bookings against goal, revenue by month and deal type, won by region (click to filter), why we win and lose, the leaderboard, sales cycle by month, forecast vs closed, an activity heatmap and losses by competitor.
- **Admin** (contributors): price book (edit in place), routing and rules, settings with a set-up checklist and automation health.

## How it works

1. **Lead intake**: the score adds points for source, company size and seniority; the routing table sets territory, owner and response time (4 hours for hot leads). Sales development gets a Qualify task (escalates to their manager after a day).
2. **Conversion**: Convert lead finds or creates the account, adds the contact and opens a deal in Qualification.
3. **Stage automation**: any stage change (board drag, Advance stage, form, API) runs the stage rules: probability, weighted amount, forecast category, a row in the deal stage history and a task for whoever moved the deal. Every deal change also refreshes the account's open pipeline, open deals and won value.
4. **Quotes**: each product line is priced and added to the deal; the effective discount and net total go through the discount authority table, then the sales manager and VP approve within a 3-day SLA; the rep is emailed the result, with the approved quote as a PDF (products, discount and total in USD) to send to the customer.
5. **Close**: the outcome, reason, competitor and cycle time go to CRM closed deals (Won = 100, so its average is the win rate). Wins hand over to customer success (health record, ARR, kickoff task, optional AI welcome draft).
6. **Daily checks**: renewal notes at 90, 60 and 30 days (a renewal call at 30) and slipped close dates flagged.
7. **Support cases**: the priority sets the SLA (Urgent 4 hours, High 8, Normal 24, Low 72); support gets a Resolve task due by then that escalates to their manager; resolving records the resolution and whether the SLA was met, and emails the customer's contact.
8. **Repeat leads**: a website lead with an email already in CRM leads is merged into that lead (touches, last touch, notes) instead of starting again; a lead from a company domain that is already a lead is flagged as a possible duplicate on the lead and in the Qualify task.
9. **Forecast override**: a manager's *Manager override* on a deal sets its *Final forecast* (the stage automation keeps it in step), which the Pipeline and Forecast pages read.
10. **Summarize**: reads the deal, its latest activity and quotes; saves a next best action from rules (no quote in Proposal, no activity for two weeks, a close date that has passed, else the next step) and, with an AI provider, the assistant's summary using the workflow's data as context.

## Roles

- **Viewers** see the pages but none of the buttons that create or change anything, and a fixed pipeline board: use this for leadership.
- **Contributors** create deals, log activities, request quotes, convert leads and move cards (with Manage rows). Give this role to sales reps and managers.
- **Editors** change the app in the builder. The person who installs the package is its first editor.

Nobody can use the app until you share it: open **Apps → Revenue CRM → Settings → Audience** after install.

## Customise it

- **Your team**: replace the sample owners in the tables and the routing decision table; the "My open pipeline" KPI matches the deal Owner to the signed-in person's name.
- **Stages and probabilities**: edit CRM stage rules (and the board's lanes in the page builder).
- **Approval policy**: edit CRM discount authority (thresholds and paths).
- **Products and prices**: edit the CRM price book on the Admin page.
- **Look**: change the accent colour, icon or navigation in the app's settings; widgets follow your workspace theme in light and dark mode.
- **AI (optional)**: choose an AI provider on the CRM account assistant to switch on deal summaries (Summarize in the deal room), account summaries (Admin → Settings) and welcome-email drafts in the handoff. Without one, those steps are skipped and Summarize still saves the rules' next best action.
- **Support SLAs**: change the hours in the CRM support case workflow (SLA hours step) and the case form's help text.
- **Change history**: CRM deals records every field change (who, when, old and new value), shown under the deal in the deal room. It needs the workspace's change-history database update (migration 20270128090000); until then the history is simply empty.
- **Go live**: delete the sample rows; new records come from the forms and workflows.
