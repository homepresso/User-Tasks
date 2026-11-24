# Release notes: AI costs by model and profile, and AI usage in Reports

Release note line: **Agents → Costs & budgets now breaks AI spend down by
model, Agent profile, source, agent and person — including the in-product
Agent — and Reports gets an "Agents & AI usage" source with seven ready-made
AI usage reports.**

## What's new

- **AI cost breakdown** (Agents → Costs & budgets): every AI call of the
  workspace for a period — last 7 / 30 / 90 days, this month, last month or
  a custom range. Agent runs, the in-product Agent, PDF import AI assist and
  Redact Document AI detection are counted together (the page used to show
  agent runs only).
  - Totals: cost (budget currency, USD by default), calls, input / output /
    cached tokens, calls with an unknown cost.
  - Cost per day stacked by model or by profile; share of cost by model.
  - Sortable tables by model (with cost per 1,000 tokens and a trend line),
    by profile (models used, calls per help group, the profile's cap), by
    source, by agent and — for admins of the Agent — by person.
  - A model without a price says *cost unknown — add a price*, which adds a
    row for it to the workspace's prices.
  - Click a row or a chart mark to filter the page; Export CSV downloads the
    table shown.
  - Calls recorded without a cost are costed at today's price when their
    model has one now, marked *estimated*. Stored costs never change.
- **API / CLI / MCP**: `GET /api/v1/agents/usage` (`usertasks agents
  workspace-usage`, MCP `agents_workspace_usage_get`) takes `group_by`
  (`day`, `agent`, `model`, `profile`, `source`, `user`), `period` or `from`
  / `to`, and the filters `provider`, `model`, `agent_profile`, `agent`,
  `source` and `user`. The answer then has `breakdown`; without these
  parameters it is unchanged.
- **Reports → Agents & AI usage source**: one row per AI call, with day /
  week / month, provider, model, agent, profile, help group, workflow, outcome,
  error rate, tokens, cost (stored or estimated) and duration. It needs View
  agents; the person and team columns need Manage the Agent.
- **Reports → AI usage reports**: *AI spend by model*, *AI spend by profile*,
  *Agent usage over time*, *Top agents by cost*, *Token usage by source*,
  *AI errors* and *Cost per workflow run for AI steps*. Each comes with
  summary charts. Add one to save it as your own report: edit it, share it,
  export it or use it in app report widgets.
- PDF import AI assist and Redact Document AI detection are now labelled with
  their source in usage. The redaction detection's tokens and cost used to go
  unrecorded; they are now recorded, and the text itself is never stored.
  Cached prompt tokens of Agent requests are recorded too.

## Upgrade

Database migration `20270126130000_ai_cost_breakdown` adds:

- `assistant_usage.source` and `assistant_usage.cached_tokens`;
- the service-role function `ai_usage_breakdown`, which does the grouping in
  the database.

Until it is applied, everything works:

- usage rows are written without the new columns;
- the breakdown is summed in the app from the newest 50,000 records per
  table, and says so when a period has more;
- PDF import and redaction calls show under the in-product Agent.

## Not included

- Budgets per model: they can't be set yet. Per-profile caps already exist
  in Settings → Agent → Profiles and show in the profile table.
- Usage from these sources is not recorded yet:
  - workflow media steps (transcription, image, speech): their estimated
    cost is only in the step's output;
  - Agent dictation;
  - generic AI connector actions (for example an OpenAI *Chat Completion*
    connector step).
- The Reports source has no p95 latency (the report engine aggregates count,
  sum, average, min and max) and no per-call retry counts (retries are in
  each run's trace).
