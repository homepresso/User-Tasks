# Release notes: AI agents — data grants, cost, streaming, run privacy, version pins

Five follow-ups from the agents review. Migration
`20261124000000_agents_decisions.sql` is required (apply it before the code).

## Changed

- **New agents have no data-table access.** Data access is now granted per
  table and per operation — **read**, **insert**, **update**, **delete**
  (new `delete_data_rows` tool, at most 100 rows per call) — on the agent's
  Tools tab, and the model only gets the tools for the operations granted.
  API / MCP: `output_config.data_access.grants`
  (`[{"table_id": "…", "read": true, "insert": false, "update": false, "delete": false}]`);
  the old `{"mode": "selected", "table_ids": [...]}` still works (read,
  insert and update on each listed table).
- **Existing agents keep their access.** Before, an agent could read, add
  and update rows in every table of its workspace unless it listed tables.
  The migration records that explicitly (`legacy: true`), so nothing changes
  for them; the designer shows a banner suggesting narrowing, and **Switch to
  per-table grants** lists every table with the access it has today. "All
  tables" can't be given to an agent again (a 400 on create / update), and
  restoring a version from before never re-opens every table on an agent
  that was narrowed since. Exports and packages carry the grants; a file
  exported before this release (no `data_access`) imports with the old "all
  tables" meaning and a warning.
- **Agent run records need `agents.view`.** A run's input, output, trace and
  tool calls — and test-suite runs and agent queue jobs — were readable by
  every member of the workspace. Now they need `agents.view`, except your
  own runs: those the agent acted for you or that you started (new
  `agent_runs.initiated_by`). The run page opens for anyone signed in and
  says "not found" otherwise. Realtime, the trace viewer, integration call
  pages and reports follow the same rule; reports on the Agent Runs source
  over the API, MCP and OData need `agents.view`. A workflow run still shows
  a Run Agent step's output to people who can view the run, but not the
  agent's trace.
- **Published workflows pin agent versions.** Publishing stamps each Run
  Agent step with the agent's current version; runs of the published
  workflow — any trigger, REST, MCP, CLI, queued and resumed runs — use that
  version even after the agent is saved again or an older version restored.
  The step shows "Pinned to v3 · newer v5 available" with **Update**, which
  publishes a copy of the live version with the new pin (draft changes are
  not published). Drafts and Save & Test use the latest version, and the
  test log says so. Exports carry the pins as `published_agent_pins`.

## Added

- **Cost.** Each run (and each model call in its trace) has a cost in a
  currency, computed when the run is recorded from a price table — per
  provider + model, input / output / cached-input tokens per 1M, with an
  effective date — and stored with the price used. Prices: the workspace's
  (Agents → **Costs & budgets**), else the instance's (Settings →
  Infrastructure → **AI model prices**, instance admins), else the shipped
  defaults: providers' published list prices **as of 2026-10-29, editable**,
  for the models the connector presets suggest that are still listed
  (OpenAI GPT-4o / 4o mini / 4.1 / 4.1 mini / 4.1 nano / o3-mini; Claude
  Opus 5.5, Opus 4.6, Sonnet 4.6, Haiku 4.5; Gemini 2.5 Flash / Pro; Mistral
  Large / Medium / Small / Codestral; Perplexity Sonar). They are list prices
  only (no discounts, tiers, surcharges, per-request fees or taxes). A model
  without a price shows **cost unknown** — never a guessed or zero cost.
- **Budgets in currency.** Per agent and per workspace: tokens and cost per
  day (last 24 hours) and per month (calendar month, UTC). Runs are refused
  once one is spent. The run page, runs list, trace, the agent's usage chart
  (tokens or cost) and the workspace Costs & budgets page show cost.
  REST: `GET /api/v1/agents/{id}/usage` and `GET /api/v1/agents/runs*` carry
  cost; new `GET /api/v1/agents/usage` (workspace) and
  `PUT /api/v1/agents/cost-settings`; CLI `agents usage`,
  `agents workspace-usage`, `agents cost-settings`; MCP `agents_usage_get`,
  `agents_workspace_usage_get`, `agents_cost_settings_update`.
- **Streaming replies.** The test console, Save & Test (on the Run Agent
  step) and `POST /api/v1/agents/{id}/execute` with `"stream": true` (or
  `Accept: text/event-stream`) show the reply as the model writes it
  (`delta` events). OpenAI-compatible Server-Sent Events are used for every
  provider (OpenAI, Azure, Claude's and Gemini's OpenAI compatibility,
  Mistral, DeepSeek, Groq, Together, Perplexity, Ollama, Bedrock's OpenAI
  endpoint); Anthropic Messages events are understood too. Tool-call
  arguments are assembled from their pieces; an error mid-stream retries the
  call (`delta_reset` discards the partial text); a provider or model that
  refuses streaming (or its usage option) gets a normal request; closing the
  console or the request cancels the run; deltas are batched and held back
  while the browser reads slowly. Bedrock's native ConverseStream is not
  used. Workflows on the server get the final result as before.
