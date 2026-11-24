# Release notes: the Agent tells you what's happening — and retries for you

Asking the Agent a question no longer means a blank wait or a wall of
provider JSON when something goes wrong.

## New

- **"Working on it…" straight away.** The moment you send a message the
  Agent's bubble says *Working on it…*, then what it is doing — *Thinking…*,
  the step it is on (*Reading the form…*, *Drafting your app…*) — until the
  answer streams in and replaces it. A wait with no news says *Still
  working…* after 8 seconds and *This is taking longer than usual…* after 25.
  **Stop** sits in the bubble as well as the composer. Screen readers hear
  each change through the panel's polite live region; the animated dots stop
  under *reduce motion*.
- **Automatic retries.** When the AI provider is busy or has a hiccup — 429
  (too many requests), 500 / 502 / 503 / 504 / 529 (overloaded), a timeout or
  a dropped connection — the Agent waits and tries again: up to 4 attempts
  within about 45 seconds, with exponential backoff and jitter. The
  provider's own wait is honoured (`Retry-After`, `retry-after-ms`, OpenAI's
  `x-ratelimit-reset-*`, Anthropic's `anthropic-ratelimit-*-reset`); a wait
  longer than the budget fails at once and says when to try again. Retries
  are quiet: the bubble keeps saying *Working on it…* / *Thinking…* (with the
  usual *Still working…* hints), never the provider, rate limits or attempts.
  People who manage the Agent (`assistants.manage`) see afterwards that an
  answer needed retries, in a collapsed **Details** under it (*Answered after
  2 automatic retries (rate limited · HTTP 429 · Anthropic)*); the attempt
  count in an error's Details is for them too. Only the model call is retried — steps already taken in the request (a tool
  that ran, a change you confirmed) are never repeated. 400 / 401 / 403 / 404,
  out of credit (402, `insufficient_quota`), context too long and
  content-policy refusals are not retried.
- **Friendly errors with a next step.** Rate limited, out of credit, key
  rejected, model not available, provider overloaded, timeout / network,
  conversation too long, content policy, tools not supported and "the Agent
  isn't set up yet" each have a plain-language message saying what to do.
  Each error bubble has **Retry** (asks again: the same message, or carries on
  from the steps already done) and a collapsed **Details** with the provider,
  HTTP status, error code / type, request id and attempts. Details never show
  the raw provider response, keys or headers. People who manage the Agent
  also see the provider's own message (keys masked) and an **Open Settings →
  Agent** link when the fix is there. Older conversations that hold a raw
  provider error show it the friendly way too.
- **Everywhere the AI is used interactively.** The agent designer's
  **Playground** gets the same working bubble (quiet retries — the finished
  run's line says how many it needed; the trace shows each attempt) and error
  bubble with Retry and Details (and no longer shows a failed run's error
  twice). The PDF import's **Use AI for the hard parts** reports a friendly
  message instead of `The AI provider failed: Provider 429: {…}`.
- **Workflow agents** use the same retry policy and record the friendly
  message followed by the technical detail on the run, so the run log and
  trace show both.

## New workflow trigger: Agent Error

- **Agent Error** (`agent_error`) starts a workflow once an agent fails for
  good — after its automatic retries, or at once when no retry can help —
  never for a retry that later succeeded or a run someone stopped. Sources:
  workflow agents (a Run Agent step), agent runs started elsewhere (the
  Playground, the API, MCP, the agent queue) and the in-product Agent.
  Filters: agents and / or Agent profiles, error kinds (rate limited, out of
  credit, key rejected, model unavailable, provider down, timeout / network,
  context too long, content policy, not configured, tools unsupported,
  other) and a minimum severity (warning / error / critical).
- Run variables `{{agent_error_kind}}`, `{{agent_error_message}}`,
  `{{agent_error_summary}}`, `{{agent_error_agent_name}}`,
  `{{agent_error_workflow_name}}`, `{{agent_error_step}}`,
  `{{agent_error_conversation_id}}`, `{{agent_error_user_id}}`, … and the
  object `{{agent_error.*}}` — the friendly message and a sanitised summary,
  never the provider's raw response, headers, keys or the prompt.
- Safe by default: at most 3 runs per agent (or profile) and error kind
  every 5 minutes (configurable; skipped failures are counted in
  `{{agent_error_suppressed}}`); runs it starts — and their sub-workflows —
  never report their own agents' failures; Save & Test runs and evaluations
  never fire it. Example: *Agent Failure Alert* (MCP recipe and
  /docs/ai-assistants) emails the admins and opens a task.

## Usage and limits

- A request the provider never answered (it failed after its retries) is not
  recorded as Agent usage, so it doesn't count towards the daily message
  limit or the monthly cost cap. Answered requests count once, with the
  tokens of the answered calls only. Retries and failures are logged
  server-side (code, provider, status, request id, retry count — never the
  body or the key).

## Self-hosted

- `AGENT_RETRY_MAX_ATTEMPTS` (1–8, default 4) and `AGENT_RETRY_MAX_WAIT_MS`
  (0–120000, default 45000) tune the retry policy for the Agent, workflow
  agents and the PDF import's AI assist.

## Unchanged

- No database migration. The Agent's limits, burst limits and background
  work behave as before; a request refused by a limit now shows the same
  error bubble (with Retry when waiting helps).
