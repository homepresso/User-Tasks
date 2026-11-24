# Release notes: Baseten AI models for agents and workflows

[Baseten](https://www.baseten.co/) is now a ready-made AI connector. One
connection serves agents, the Agent assistant and workflow integration
calls.

## New

- **Baseten connector** (Integrations → Connectors → AI → Baseten). It has
  two endpoints:
  - **Model APIs**: Baseten-hosted open models at
    `https://inference.baseten.co/v1`. The model list holds the current
    slugs: DeepSeek V4 / V4.1 Flash, Kimi K3 / K3.1 Pro, GLM 5.2 / 5.3,
    OpenAI GPT OSS 120B, NVIDIA Nemotron 3 Ultra / 3.5 Super VL, Beam and
    Muse Spark Open. **Model name (custom)** takes any other slug.
  - **Dedicated deployment**: a model you deployed on Baseten Cloud or
    Baseten Self-hosted (your own cloud account and VPC). Paste the
    deployment URL or model ID. The predict URL, the `…/sync/v1` URL, the
    full `/chat/completions` URL and a bare model ID are all normalised to
    the deployment's OpenAI-compatible `…/sync/v1` route. Enter the model
    name the deployment serves.
- **Your own key**: you use your own Baseten account and API key, and
  Baseten bills the usage to you. UserTasks never supplies a Baseten key and
  has no platform-level Baseten setting. The key is a password field. It is
  encrypted at rest with the connector's other credentials, never returned
  to the browser, never made a template variable and never logged.
- **Agents**: the new `baseten` provider kind is reached through the
  existing OpenAI-compatible agent loop. Streaming, tool calling, retries
  and token usage work as they do for other providers, with `Authorization:
  Bearer` for both endpoints. A 429 is retried, honouring `Retry-After`. A
  529 (no free capacity) is retried as a provider outage. An agent with no
  model of its own now falls back to the connection's model before the
  provider default. Baseten connections store one, which matters most for
  dedicated deployments.
- **Workflows**: the connector adds **Chat Completion** and **JSON
  Completion** references (JSON Completion sends `response_format:
  {"type":"json_object"}`). An empty **model** input uses the connection's
  model.
- **Test connection** sends a one-token completion to the chosen model.
  Baseten documents no models endpoint. A 404 points you at the model slug
  or the deployment URL.
- **Costs**: the built-in price list has every Model API slug, with input,
  output and cached-input prices from baseten.co/pricing as of 2026-11-21,
  in USD. Cached tokens (`usage.prompt_tokens_details.cached_tokens`) are
  charged at the cached price. Baseten bills dedicated deployments per GPU
  minute, not per token, so their runs show **cost unknown** until an
  admin adds a price under Agents → Costs & budgets. **Fetch latest
  pricing** maps LiteLLM's `baseten/` entries.
- **Agent assistant** (Settings → Agent): use the Baseten connection
  (**Use an Integrations connection**), or choose **OpenAI-compatible** with
  base URL `https://inference.baseten.co/v1` and your key.
- **Tool-calling hint**: when a provider rejects a request because the
  model doesn't support tools, the error now says so. This applies to any
  provider. Every current Baseten Model API supports tool calling, but a
  dedicated deployment might not.

## Notes

- Baseten is a cloud service, so it isn't available on air-gapped installs.
- Thinking levels aren't mapped for Baseten models. Models that reason by
  default still do.
- Agent file inputs don't go to Baseten as images. An image attachment
  is refused with a clear message, and PDFs and documents go as extracted
  text, as with other providers that have no file support. This is true
  even though some Baseten models take images.
- No database migration is needed.

## Sources

- Model APIs overview (slugs, base URL, features):
  https://docs.baseten.co/development/model-apis/overview
- Rate limits, `x-ratelimit-*` headers, 429 / 529, usage fields:
  https://docs.baseten.co/development/model-apis/rate-limits-and-budgets
- Dedicated deployment endpoints and Bearer / Api-Key auth:
  https://docs.baseten.co/inference/calling-your-model
- Pricing: https://www.baseten.co/pricing/
- Self-hosted (workload plane in your VPC):
  https://docs.baseten.co/hosting-options/self-hosted
