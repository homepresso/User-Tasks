# CapEx planning & approvals

A complete capital expenditure (CapEx) app: plan the annual capital budget by business unit, raise requests with a business case and live NPV / IRR / payback / ROI, route approvals by amount and category, track spend against plan, handle overruns with change requests, and close projects into the fixed asset register. All amounts are in USD. The sample data is for Brightwater Manufacturing, a fictional company.

## What's inside

| Asset | What it does |
|---|---|
| **CapEx planner** (app) | Grouped sidebar: Overview, Requests, Approvals, Budget, Projects (with a project detail panel), Assets, Insights and two Admin pages. |
| **CapEx request** (form) | Five-step wizard: summary, business case (rich text), cost breakdown (repeating section with a total), cash-flow projection (editable table) with NPV, IRR, payback and ROI, quotes and confirmation. |
| **CapEx actual spend** (form) | An invoice or progress payment against a project (opens in a slide-in panel). |
| **CapEx change request** (form) | More money for an approved project, with the overrun % worked out. |
| **CapEx post-implementation review** (form) | Closes a project: final cost, objectives, benefits and lessons. |
| **CapEx asset registration** (form) | Adds a fixed asset with its straight-line depreciation. |
| **CapEx budget allocation** (form) | Sets or adjusts a budget line (finance). |
| **CapEx request approval** (workflow) | Decision-table routing, budget check, parallel CIO / safety reviews, tiered approvals with SLAs, reminders and escalation, budget commitment, planned phasing, approval summary PDF, purchase order. |
| **CapEx spend entry** (workflow) | Rolls spend up to the project, budget line and business unit; asks for a change request over 110%. |
| **CapEx change request** (workflow) | Auto-approves within 10%; otherwise finance controller, CFO and (over $250,000) CEO re-approve. |
| **CapEx monthly spend review** (workflow, scheduled) | On the 1st: flags projects and business units at 80% and 100%, then a finance review task. |
| **CapEx project close-out** (workflow) | Closes the project and asks the asset accountant to register the asset. |
| **CapEx asset registration** / **CapEx register asset** (workflows) | The asset and its depreciation schedule (the second is the shared sub-workflow). |
| **CapEx budget allocation** (workflow) | Updates or adds the budget line and moves the business unit totals. |
| **CapEx approval thresholds**, **CapEx category reviews** (decision tables) | Who approves, by amount and by category. |
| 12 data tables | Business units, cost centres, budgets (BU × category × quarter, two years), projects, cash-flow lines, approvals log, spend (planned and actual), change requests, asset register, depreciation schedule, vendors, categories. |
| **CapEx approvals waiting** (report) | Open approvals, oldest due first. |
| 3 email templates | Approved, rejected and change-request decisions. |

## Roles

- **Viewers** read every page they can open but never see the buttons that submit, record or withdraw. Use this for leadership who follow the numbers.
- **Contributors** submit requests, record spend, raise change requests, close projects, approve the tasks assigned to them and (with *Manage rows*) edit the budget lines and admin tables. Give this role to requesters, approvers, finance and procurement. The Approvals page and the Admin pages are for contributors only.
- **Editors** change the app in the builder. The person who installs the package is its first editor.

Nobody can use the app until you share it: open **Apps → CapEx planner → Settings → Audience** after install.

## Who approves

| Total cost (USD) | Approvers |
|---|---|
| Under $25,000 | Department head |
| $25,000 to $250,000 | Department head, finance controller, CFO |
| Over $250,000 | Department head, finance controller, CFO, CEO, capital committee |

IT requests add a **CIO review**; facilities, vehicles and equipment over $100,000 add a **safety review**. These run in parallel after the department head. A request over its budget line always goes to the finance controller. The department head is chosen on each request; the other steps go to the people you pick at install.

## The financial calculations

Year 0 is the total capital cost (the sum of the cost lines). Each cash-flow row is a year *t* = 1…N of net cash flow = benefits − operating costs, received at the end of the year.

- **NPV** = Σ net*t* / (1 + r)^*t* − investment, at the discount rate r (8% by default, Brightwater's hurdle rate).
- **IRR**: the rate where NPV = 0. The form works out NPV at 0%, 10%, 20%, 30%, 50% and 100% (shown under *How the figures are worked out*), interpolates between the two rates where NPV changes sign, then refines that estimate twice with Newton's method. It is accurate to well under 0.1 percentage point for normal projects; no IRR is shown when undiscounted benefits do not cover the investment, and 100% is the ceiling.
- **Payback**: the years until the cumulative net cash flow covers the investment, interpolated within the year it is reached; blank when that is beyond the projection.
- **ROI** = (total net benefit − investment) / investment × 100, over the projection (undiscounted).
- **Depreciation**: straight-line, (cost − salvage value) / useful life per year from the in-service year.

The expressions are checked against reference implementations in `__tests__/gallery-capex-finance.test.ts`.

## Customise it

- **Thresholds and reviews**: edit the two decision tables (Admin → Approval rules links to them). The amounts, SLAs and which categories need which review are all there.
- **Hurdle rate**: change the default of the *Discount rate* field in the CapEx request form.
- **Budgets**: use *Allocate budget* (or edit the CapEx budgets table) for each fiscal year; add business units and cost centres in Admin → Budget setup.
- **Approvers**: change the install-time assignees in the workflow designer later (a team works too). Escalation goes to the approver's manager after the step's SLA.
- **Look**: change the accent colour, icon or navigation in the app's settings; widgets use theme tokens and follow your workspace theme in light and dark mode.
- **Data**: delete the sample rows when you go live. New requests, spend, change requests and assets are added by the workflows.
