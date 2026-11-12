import type { DocPageDef } from '../types'

export const AI_ASSISTANT_PAGES: DocPageDef[] = [
  {
    slug: 'ai-assistants',
    title: 'Setting up the Agent',
    description: 'Bring your own AI provider key and turn on the Agent, the built-in assistant on every screen: providers, profiles for different people, who can use it, the per-form setting, limits, costs, privacy and troubleshooting.',
    body: `
The **Agent** is a chat assistant built into UserTasks. One **Agent** button sits on every screen. It helps people fill in forms and work tasks, and helps builders make forms, workflows, data tables, decision tables, reports, agents and Extensibility items (custom actions and form controls). It uses your own AI provider and key.

> [!NOTE]
> The Agent is not the same as **Agents** (\`/agents\`). Agents are AI steps you design and run inside workflows. The Agent is the assistant that helps *you* while you work. They can share the same provider connection.

Nothing appears to anyone until a provider is set up, the Agent is turned on, and the person is allowed to use it.

## What it can do

What the Agent can do depends on the screen and on the person's own permissions:

| Screen | What it does | What it never does |
|---|---|---|
| A form you are filling in | Explains fields and proposes values, which you apply | Submit the form |
| A task (or any task, by name) | Summarises the task, its form and comments, explains the outcomes, drafts a comment, and — after you confirm — completes, approves, declines, accepts, takes, reassigns or claims it, with the same rights as in the app | Act without your confirmation, guess an outcome or a field value, or act on a task you can't action |
| Form designer, workflow builder, data tables, decision tables, reports, agents, Extensibility | Reads and builds with your build permissions, after you confirm each change | Publish, run, delete items, or change settings |
| Data tables (rows) | Adds, edits and deletes rows, with a preview you confirm | Change rows you couldn't change yourself |
| Settings, Team, Organization, roles and other admin pages | Explains settings and access, and makes admin changes with your admin permissions, after you confirm each one | Touch secrets, SSO, the workspace address, billing, its own settings, or your own access |

See [Using the Agent](/docs/ai-assistants/using) for each screen, with example prompts.

## Set up a provider

You need **Manage the Agent** (\`assistants.manage\`). Owner and Admin have it. Open **Settings → Agent** (\`/settings/assistants\`). The page has five cards: **Provider (default model)**, **Agent**, **Profiles**, **Limits** and **Privacy**.

In **Provider (default model)**:

1. Choose the **AI provider**.
2. Choose where the key comes from: **Enter an API key**, or **Use an Integrations connection** (below).
3. Enter the **Base URL** if your provider needs one.
4. Enter a **Model**. It must support **tool calling**. Leave it empty to use the provider's default.
5. Select **Save**, then **Test connection**.

This is the workspace's **default** connection and model. Everyone uses it unless their profile gives them another (see [Profiles: a different Agent for different people](#profiles-a-different-agent-for-different-people)).

The key is stored encrypted and never shown again. The page shows only its last four characters (\`•••• abcd\`), with **Replace** and **Remove**. Changing the provider needs a new key.

### Providers, base URLs and models

| Provider | Base URL | Default model | Other examples |
|---|---|---|---|
| **OpenAI** | Leave empty (\`https://api.openai.com\`) | \`gpt-4.1\` | \`gpt-4.1-mini\`, \`gpt-4o\`, \`o3-mini\` |
| **Anthropic Claude** | Leave empty (\`https://api.anthropic.com\`) | \`claude-opus-5-5\` | \`claude-sonnet-4-6\`, \`claude-haiku-4-5\` |
| **xAI Grok** | Leave empty (\`https://api.x.ai\`) | \`grok-4\` | \`grok-4-fast\`, \`grok-3-mini\` |
| **Google Gemini** | Leave empty (\`https://generativelanguage.googleapis.com\`) | \`gemini-2.5-flash\` | \`gemini-2.5-pro\` |
| **Azure OpenAI** | Required: \`https://<resource>.openai.azure.com\` | Your **deployment name** | |
| **Mistral** | Leave empty | \`mistral-large-latest\` | \`mistral-small-latest\` |
| **Groq** | Leave empty | \`llama-3.3-70b-versatile\` | \`openai/gpt-oss-120b\` |
| **Ollama** | Required, e.g. \`http://ollama.internal:11434\` | \`llama3.1\` | \`qwen2.5\`, \`mistral\` |
| **OpenAI-compatible** (vLLM, LiteLLM, a gateway) | Required, e.g. \`https://llm.example.com/v1\` | None: enter one | |

- Leave the base URL empty for a hosted provider's own API. Set one to go through a proxy or gateway.
- **Claude** and **Gemini** are reached through their OpenAI-compatible endpoints. You only need the normal API key.
- **Azure OpenAI**: enter your resource endpoint as the base URL and your deployment name as the model. UserTasks uses Azure's v1 API, so there is no API version to set.
- **Ollama** and **OpenAI-compatible** servers don't need a key. Enter one if your server or gateway asks for it.
- A base URL that ends in \`/chat/completions\` is used exactly as you enter it.

### Use an Integrations connection

If your workspace already has an AI provider connection for [Agents](/docs/agents), choose **Use an Integrations connection** and pick it under **Connection**. The Agent uses the connection's key, base URL and default model. A **Model** you enter on this page overrides the connection's default.

Any active AI connection from **Integrations → Connectors** works (OpenAI, Claude, Gemini, Azure OpenAI, xAI Grok, Mistral, Groq, DeepSeek, Together AI, Perplexity, Ollama or an OpenAI-compatible server). The key is then managed in one place. If the connection is turned off or deleted, the Agent stops until you pick another.

### Test connection

**Test connection** sends one short request ("Reply with the single word OK.") with the **saved** settings and shows what the provider answered, for example *Connected — gpt-4.1 answered “OK”*. Save your changes first. The result is kept as *Last test…* until you change the connection.

The test does not check tool calling. If the test passes but the Agent fails to answer, check that the model supports tools.

## Profiles: a different Agent for different people

A **profile** is a named Agent setup for some people — for example *HR assistant*, *Builders* or *Finance approver helper*. Each profile can choose:

- **Who**: **People**, **Groups (teams)** and **Roles**, in any mix.
- **Where it applies** (optional): **Tasks**, **Forms being filled**, **Builders**, **Admin pages** and **Other screens**. Leave it on **Everywhere** for most profiles.
- **Model**: **Use the default model**, **The default connection, another model**, **Its own provider and key** (stored encrypted, like the default key, and never shown again) or **An Integrations connection**, with its own **Thinking level**.
- **Kinds of help**: **Same as the Default profile**, or its own choice of **Form**, **Task**, **Building** and **Admin** help. A profile can only turn help off. Each kind still needs the person's own permissions, so a profile never gives anyone more than their roles allow.
- **Instructions** (optional, up to 4,000 characters): extra guidance for these people, such as *You help HR staff. Always mention the leave policy page.* They are added **after** the Agent's own rules, which always take precedence. Instructions can't give the Agent more tools or permissions, skip a confirmation or reveal secrets. Only admins see them; they are never sent to people's browsers.
- **Starter prompts**: suggestions shown in an empty panel.
- **Name in the panel**: the panel header then reads, for example, **Agent · HR**.
- **Limits** (optional): **Messages per person per day** and **Token limit per request** (empty uses the workspace's limit), and a **Monthly cost cap** for this profile's use. The workspace's monthly cap still applies.

To set up profiles in the **Profiles** card:

1. Select **Add profile**. A sheet opens with **Basics**, **Who**, **Model**, **Kinds of help**, **Instructions**, **Starter prompts** and **Limits**.
2. Fill in a **Name** and choose who it is for, then anything you want to change from the default.
3. Select **Add profile** (or **Apply** when editing), then **Save** at the bottom of the page.
4. Use **Edit**, **Duplicate**, **Move up**, **Move down** and **Delete** on each card. A duplicate doesn't copy a saved key; enter it again.
5. After saving, select **Test connection** in a profile that has its own connection.

The **first matching profile wins**, from top to bottom. Put specific people first, then groups, then roles. People who match no profile get the **Default profile**, shown at the bottom of the list. The Default profile is the rest of this page: the default model and thinking level, the kinds of help under **Agent → Advanced**, and **Limits**.

Profiles decide **what** people get. **Who can use the Agent at all** is still the single access list in the **Agent** card. Someone in a profile but not on that list doesn't see the Agent.

### Example: HR, Builders and everyone else

| Order | Profile | Who | What it changes |
|---|---|---|---|
| 1 | **HR assistant** (panel name *HR*) | Group **HR** | A cheaper model, **Form** and **Task** help only, instructions about the leave policy, starters such as *How much leave can I take?*, 30 messages per person per day |
| 2 | **Builders** | Role **Builder** | **Claude** with its own key, thinking level **High**, all kinds of help, applies on **Builders** screens only |
| — | **Default profile** | Everyone else on the access list | The default model and help, the workspace's limits |

A builder who is also in HR gets **HR assistant** everywhere, because it is first. Move **Builders** up if builders should get Claude on builder screens. Elsewhere they still get **HR assistant**, because **Builders** applies on builder screens only.

### Who gets what

Pick a person under **Who gets what** to see their profile (or **Default profile**), model, thinking level, kinds of help and limits. The kinds of help already take their permissions into account; for example, *Building (read-only)* means they can look things up but not build. If a profile applies only on some screens, **By screen** shows which profile they get where. If the person isn't on the access list, the preview says so. The preview uses the saved settings, so save first. You need **Manage the Agent** to use it.

Changes apply from each person's next message. Their conversation stays the same: history is kept per person and workspace, not per profile. Usage and costs are recorded with the profile, so you can see what each one costs.

### Model rules (before profiles)

Workspaces that set up **model rules** before profiles existed keep them. Each rule now shows as a profile that only changes the model, named after the rule's label. Its saved key, order and thinking level carry over, and everything else follows the Default profile. Nothing changes for anyone until you edit them. The next **Save** stores them as profiles.

### Thinking level

Models that reason before they answer have a **Thinking level**: on the default model (under **Model**) and on each profile. Choose **Default** (the provider's own default), **Low**, **Medium**, **High** or, where the model offers it, **Max**. Higher levels do better on complex work such as building a whole process, but answer more slowly and use more output tokens, so they cost more. Lower levels suit quick form and task help.

| Provider | Models | What is sent |
|---|---|---|
| Anthropic (Claude) | Claude 5.x, Fable, Opus 4.6–4.8, Sonnet 4.6 (Opus 4.5 up to High) | \`output_config.effort\` on Anthropic's own API |
| OpenAI, Azure OpenAI | GPT-5.x and o-series reasoning models (Max on GPT-5.5) | \`reasoning_effort\` (Max = \`xhigh\`) |
| xAI | Grok 4.5, 4.6, 4.7 (Max on 4.6 and 4.7) | \`reasoning_effort\` (Max = \`xhigh\`) |
| Google Gemini | Gemini 2.5, 3.x, 4 (up to High) | \`reasoning_effort\` (a thinking budget or level) |

For other models the setting is greyed out (*This model doesn't support a thinking level*) and nothing is sent. If a provider still rejects the setting, the Agent asks again without it and stops sending it for that model. Under **Thinking level per help group (advanced)** you can set, for example, High for building help and Low for form and task help. Which level applies, first match wins: the person's profile, the help group, the default model, the provider's default. **Who gets what** shows the level too.

## Turn it on and choose who can use it

In the **Agent** card:

1. Switch on **Turn on the Agent**.
2. Under **Who can use it**, choose **Everyone in the workspace**, or **Only chosen roles and groups** and pick **Roles** and **Groups (teams)**. People with one of the roles, or in one of the groups, can use it.
3. Select **Save**.

Under **Advanced** you can turn off one kind of help for the Default profile (a profile can choose its own): **Form help**, **Task help**, **Building help** or **Admin help**. All four are on by default (a workspace set up before **Admin help** existed gets it on too; a workspace still on the very first Agent settings gets it only if building help was on). **Form help on** sets the default for forms: **All forms (a form can turn it off)** or **Only forms that turn it on**.

**Let the Agent complete tasks (with confirmation)** (under **Advanced**, on by default): task help can complete, approve, decline and accept tasks the person is allowed to action, each after a confirmation card they confirm. Turn it off and the Agent still reads and explains tasks and their forms, but people use the task's own buttons. A profile can choose **Same as the Default profile**, **On** or **Off**. Workspaces set up before this setting existed have it on.

People also need the permission behind each kind of help:

- **Form help**: **Submit forms**.
- **Task help**: permission to see the task (**View own tasks** or **View all tasks**).
- **Building help**: at least one build permission: create or edit workflows, edit forms, create tables or edit their schema, or create or edit Extensibility items (custom actions and form controls).
- **Changing rows**: **Manage rows** (\`data.manage_rows\`) on the table, and **View data** to read it.
- **Admin help**: at least one admin permission: **Invite members**, **Remove members**, **Manage roles**, **Manage organization**, **View settings**, **Edit settings**, **View event stream** or **Manage the Agent**. Each admin tool then needs its own permission — see [Admin help](#admin-help).

The Agent can only use the tools the person's own permissions allow, whoever is on the list.

### Per-form setting

By default form help is on for every form (**All forms (a form can turn it off)**). Each form can choose for itself:

1. Open the form in the form designer.
2. In the **Header** tab, find the **Agent** section and set **Agent form help on this form** to **Workspace default**, **On** or **Off**.
3. Save the form.

- **Off** turns off form help on that form and keeps the form's contents away from the Agent. The Agent itself stays available for other help.
- **On** turns form help on even when the workspace default is **Only forms that turn it on**.

The setting applies wherever the form is filled in: its own page, the app, and task forms that use it. On a task whose form is **Off**, task help (summaries, comments, outcomes) still works, but the Agent doesn't read or fill the form's fields.

## Admin help

**Admin help** lets the Agent help with workspace administration. It is listed under **Settings → Agent → Advanced** and is on by default. It shows for people who hold at least one admin permission, and each thing it can do needs the permission behind it — the same permission the page or the [MCP tool](/docs/mcp) needs.

**Explaining (no confirmation needed)**

| What | Needs |
|---|---|
| The settings on the page you're on and their current values (theme, form sign-in page, Task completed screen, retention, log export, directory sync, roles) | **View settings** (and the page's own view permission) |
| Who has access to something, and why someone can't see a menu or page (roles, groups and grants) | **View members**; grants also need **Manage roles** |
| The permission audit log, and the activity / audit log | **Manage roles**; **View settings** |
| The Agent's own usage and costs; AI agent costs | **Manage the Agent**; **View agents** |
| Workspace health: failed runs, dead queue jobs, SLA breaches (and webhook dead letters) | **View all runs** (**Manage webhooks** for dead letters) |
| The org structure: who reports to whom, org units, teams | **View organization** (your own line needs nothing) |
| Retention policies and where they are used; log export and directory sync status (never credentials) | **View settings**; **View event stream** for log export |

**Changing (each shows a card with before → after, and waits for Confirm)**

| Change | Needs |
|---|---|
| Invite someone with a role (Admin, Manager, Member or Viewer) | **Invite members** |
| Create a team; add someone to a team | **Invite members** |
| Remove someone from a team | **Remove members** |
| Deactivate a member (red card; type the confirmation, for example *deactivate sam@example.com*) | **Remove members** |
| Give or take away a role; create or edit a custom role (the card shows the permission diff and who has the role) | **Manage roles** |
| Set someone's manager | **Manage roles** |
| Place or release a legal hold on a form (red card; releasing needs typed text) | **Manage roles** |
| Edit people's job title, department, location, employee id, cost centre and manager; create and edit org units and their members | **Manage organization** |
| Import the org structure from a pasted or attached CSV (the card is a preview of every row; nothing is written until you confirm) | **Manage organization** |
| Apply a theme template or change the workspace theme; change the form sign-in page or the Task completed screen | **Edit settings** |
| Create or edit retention policies; delete one (red card, typed confirmation) | **Edit settings** |

Changes go through the same checks and audit log as the page (as you), and the audit entries are marked as made through the Agent.

**What it never does — for anyone, the Owner included:**

- Reveal, create or rotate secrets: API keys, OAuth client secrets, signing keys, AI provider keys, SSO certificates, SCIM tokens, webhook secrets, log export or directory credentials. It explains the steps and links the page (for example **Settings → API keys**).
- Change its own settings or profiles (**Settings → Agent**).
- Change SSO or sign-in providers, the workspace address, domain or DNS, billing, delete the workspace, transfer ownership, or instance settings.
- Change your own roles, teams, manager or membership, or make you someone's manager.
- Grant a permission you don't hold (in a role you create, edit, assign or invite as), edit the **Owner** role or a role you hold, assign or take away **Owner**, remove the last owner, or change the access of someone who has permissions you don't.
- Bulk-apply configuration, delete teams or org units, or change object grants.

## Dictation

People can talk to the Agent instead of typing (see [Talk to the Agent](/docs/ai-assistants/using#talk-to-the-agent)). In **Settings → Agent → Dictation**:

| Setting | What it does |
|---|---|
| **Dictation** | On by default. Off hides the microphone for everyone. |
| **Browser speech recognition** (default) | Free: the browser turns speech into text (Chrome, Edge, Safari). Chrome and Edge send the audio to their vendor's speech service. Firefox has none, so the microphone is unavailable there. |
| **Transcription provider** | Every browser records and the server transcribes with a media connection from Integrations that can transcribe: OpenAI, Google Gemini, Azure AI Speech, AWS, Deepgram, AssemblyAI or ElevenLabs. Leave the connection empty to use the Agent's own OpenAI key or connection (Whisper). Billed by your provider per minute. |
| **Automatic** | Browser speech recognition where the browser has it, the transcription provider elsewhere. |
| **Language** | **Automatic** follows each person's browser language; or pick one for everyone. |
| **Send automatically after dictation** | Off by default: the words stay in the box to check. On: the message is sent when the person stops talking. |

The server only transcribes for people the Agent is available to, accepts recordings up to 10 MB (about 2 minutes), at most 12 a minute per person, and stops when the workspace's monthly cost cap is reached. Recordings are not stored. Dictation doesn't count towards the messages-per-day limit.

## Limits and costs

Set limits under **Limits** on the settings page. Both are empty (no limit) by default.

- **Messages per person per day**: every request counts (a message, or confirming a change), over a rolling 24 hours.
- **Monthly cost cap**: all Agent use together, per calendar month (UTC), in the cap's **Currency**.
- **Token limit per request** (under **Advanced**): all the model calls of one request together, with cached input counted at a tenth. Empty means unlimited, the default. When it is set (at least 10,000), the Agent stops before the call that would pass it and says so; say *continue* to carry on.

There are also short-burst limits: 20 messages a minute per person and 120 per workspace.

Each request also has a fixed number of steps and time:

| Help | Steps | Tokens | Time |
|---|---|---|---|
| Form help and task help | 6 | Unlimited (or the token limit per request) | 2 minutes |
| Building help | 16 | Unlimited (or the token limit per request) | 4 minutes |

When a request reaches its steps (or the token limit), the Agent stops with what it has done so far and tells you; say *continue* to carry on.

On Anthropic (Claude) keys the Agent uses Anthropic's Messages API with prompt caching, so the instructions, tools and earlier steps that each call resends are billed at the cached rate. To use the OpenAI-compatible endpoint instead, set \`AGENT_ANTHROPIC_NATIVE=off\` on the server.

- Row changes handle up to 200 rows per call. Filtered updates and deletes change 50 rows by default, and at most 200.
- A build plan has at most 15 items. A long build pauses after about 150 seconds in one request and carries on when you confirm again.

Every request is recorded with its model, tokens and cost, priced from **Agents → Costs & budgets → Model prices**: your workspace's prices first, then the instance's, then the shipped list prices. The settings page shows this month's spend.

> [!WARNING]
> The built-in prices cover the current models of OpenAI (and Azure OpenAI deployments named after their model), Anthropic (Claude Sonnet 5.5, Opus 5.5, Haiku 5.5, Fable 5.1 and older, with cache reads and writes), xAI Grok, Gemini, Mistral, Groq, DeepSeek, Together AI, Perplexity and Bedrock Claude. Models without a price (Ollama, OpenAI-compatible servers, other Azure deployment names, models not in the list) show as *cost unknown* and **do not count towards the cap**; Settings → Agent warns when a configured model has none. Use **Fetch latest pricing** or **Add price** in **Agents → Costs & budgets** to cap them. A cap in a currency other than USD only counts prices in that currency.

When a limit is reached, people see a message, for example *"You've reached today's limit of 50 Agent messages. Try again tomorrow."* or *"The workspace's Agent has reached this month's cost cap ($100.00). An admin can raise it in Settings → Agent."*

## Privacy and security

- **Your provider sees what the Agent needs.** That is what the person types and what is on their screen: the visible fields and values of the form they are filling in, the task and its comments as they can see them, or the item being built. Hidden fields are left out. Secret fields (passwords, tokens, keys, PINs) are sent with their value replaced by *[secret — hidden]*.
- **It uses the person's own permissions.** It cannot see or change anything they couldn't. Building changes go through the same checks and audit log as the [MCP server](/docs/mcp), as that person.
- **Screen content is untrusted.** Form values, task comments and tool results are sent as marked data, never as instructions. The Agent is told not to follow instructions found inside them.
- **It never acts without your confirmation.** It has no tools to submit forms, publish, run, or delete workflows, forms or tables. It completes, approves or declines a task only when you ask, after you confirm its card, and only when you could action that task yourself (see [Complete, approve or decline a task](/docs/ai-assistants/using#complete-approve-or-decline-a-task)); an admin can turn that off. Admin changes are limited to the [Admin help](#admin-help) list, each with its own permission.
- **Every change is confirmed.** A card shows what will change (for rows, a preview of the rows), and nothing happens until the person selects **Confirm**. Deleting more than 25 rows also needs the count typed (for example *delete 40*).
- **Drafts.** Workflow changes are saved to the draft and new workflows start inactive. New workflow agents start inactive. New Extensibility items (custom actions and form controls) start as drafts or disabled, for an admin to review. Forms and decision tables have no draft, and the card warns about that.
- **No secrets in chat.** In Integrations the Agent reads connections and can run a confirmed **Test the connection**, but it never asks for, reads or handles keys, tokens or passwords.
- **Keys stay on the server.** The key is encrypted at rest and never sent to the browser or written to logs. Settings changes, key removal and connection tests are audited.
- **Uploads aren't stored.** Files you attach in the Agent panel are read for that message and sent to your provider so the model can read them. They aren't stored on the server or shared with anyone else in the workspace. The history keeps only an attachment chip.
- **History stays in the browser.** The conversation is stored in the browser (local storage), per person and workspace. It doesn't follow you to another device or browser, nobody else sees it, and it is cleared when you sign out.
- **Dictation audio.** With browser speech recognition, the browser's vendor processes the audio (Chrome and Edge send it to Google's or Microsoft's speech service); UserTasks only gets the text. With a transcription provider, the recording passes through the server to your provider and is never stored. See [Dictation](#dictation).
- **Usage is recorded.** Each request leaves a usage row: who, the provider and model, tokens and cost. People can see their own rows; admins can see the workspace's.

## Troubleshooting

### Test connection fails

| Message | What to do |
|---|---|
| *The provider answered 401 … — check the API key* (or 403) | The key is wrong, expired or lacks access. Select **Replace** and enter it again. |
| *The provider answered 404 … — check the model and base URL* | The model id doesn't exist for your key, or the base URL is wrong. On Azure, the model must be the deployment name. |
| *The provider did not answer within 20 seconds* | The server is slow or unreachable. Check the base URL and your network. |
| *Could not reach the provider* | DNS or network failure. Check the base URL. |
| *base_url is not allowed: … private/loopback addresses are blocked* | See below. |
| *The saved API key could not be decrypted* | The instance's \`ENCRYPTION_KEY\` changed. Enter the key again. |
| *The chosen Integrations connection has no API key* | Add a key to the connection in Integrations, or pick another one. |

### A self-hosted model server is blocked

Base URLs pass the same safety checks as integrations: private, loopback (\`localhost\`) and internal addresses are refused, and cloud metadata addresses are always refused. If you run Ollama, vLLM or a gateway on your own network, a self-hosted instance must set \`ALLOW_PRIVATE_EGRESS=true\` in its environment and restart. See [Environment variables](/docs/self-hosting/environment).

### The Agent button doesn't show

Check each of these:

1. A provider is saved (and **Test connection** passes).
2. The Agent is turned on.
3. The person is in **Who can use it** (or the lists are empty).
4. The person has the permission behind the help on that screen (see above).
5. For form help: the form's **Agent form help on this form** is not **Off**, and, if **Form help on** is **Only forms that turn it on**, it is **On**.
6. Form help is shown only to signed-in people. Public (anonymous) and embedded forms don't show it.

### Someone gets an unexpected model, help or panel name

The first matching profile wins. Check the order (a broad profile above a narrow one catches people first) and **Where it applies**, or pick the person in **Who gets what** to see which profile applies. People who match no profile get the Default profile. Changes apply from the person's next message after you save.

### It answers but stops early

Each request has a budget of steps and time, and optionally tokens (see [Limits and costs](#limits-and-costs)). If the Agent says it reached the step limit or *"I've used most of this request's token budget"*, say *continue* and it carries on from where it stopped. If you see *"The Agent ran out of time — try a smaller request"*, split the job into smaller asks: one form, then the workflow. Settings shows a warning when a configured model has no price, because the monthly cost cap can't count its use. For a whole process, use a [build plan](/docs/ai-assistants/using#build-a-complete-process-from-a-document).

## Known limitations

- **Some fields are left for you.** On forms it fills text, numbers, dates, choices, yes / no and survey answers. It doesn't fill people pickers, lookups, data table fields, attachment fields or custom controls.
- **Images need a vision model.** To build from a screenshot or photo, the model must read images. Otherwise the Agent falls back to text recognition where it is available, or tells you what to change. See [Upload a form or process and build from it](/docs/ai-assistants/using#upload-a-form-or-process-and-build-from-it).
- **Large files are cut short.** Each file can be up to 10 MB (images 5 MB; PDFs 20 MB when the model reads PDFs itself), with 4 files per message. Text over 60,000 characters is truncated (the Agent says so).
- **Scanned PDFs need the right model.** Claude and OpenAI vision models read scans directly. Other vision models get the first 10 scanned pages as images. Without vision, the Agent uses text recognition where available, or tells you to switch model or attach page images. See [PDFs and scanned documents](/docs/ai-assistants/using#pdfs-and-scanned-documents).
- **Attachments don't survive a reload.** Files aren't stored, so after a reload the history shows only the attachment chip. Earlier images and PDFs are *no longer available* to the Agent (a PDF's text is kept if it had one). Attach them again if needed.
- **History is per browser.** It doesn't sync across devices. Background work is added to the conversation it was started from, so starting a new conversation, or another browser, doesn't get it (the bell still tells you how it went).
- **Background work has the same time limit.** A request still has to finish within its time budget; a build plan that pauses asks you to confirm the rest.
- **It doesn't publish or run.** You publish workflows, run tests and delete items yourself.
- **Admin help has gaps.** It can't add someone to a team until they've accepted their invitation, change people's queue rules or notification preferences (those are each person's own), or remove someone's account (it deactivates their membership instead).
- **Admin help turns are counted as building help** in the usage rows.
- **Test connection doesn't prove tool calling.** Use a model that supports tools.
- **Dictation with a provider isn't priced in Agent usage.** The monthly cost cap stops it, but its minutes are billed by your provider and don't appear in the Agent's usage rows. Provider transcription shows the text when you stop, not word by word.
`,
  },
  {
    slug: 'ai-assistants/using',
    title: 'Using the Agent',
    description: 'The Agent button on every screen: one conversation that follows you, form and task help, and building forms, workflows, tables, reports and agents with confirmation cards and example prompts.',
    body: `
When the Agent is available to you, an **Agent** button (with a sparkle icon) sits at the bottom-right of every screen in the app: Home, forms, tasks, the designers and builders, data tables, decision tables, reports, agents and Extensibility (on a phone, just above the tab bar). Select it to open the panel: beside the page on a desktop, a full-height sheet on a phone. On a form's designer page (**Build › Forms → Edit**) the panel docks beside the designer, as in the workflow builder. In the form designer dialog (a workflow's step and start forms) and the test runner, an **Agent** icon button in the header opens it (**Hide the Agent** closes it).

The panel's title is **Agent**. Its header has **New conversation** and **Close the Agent**.

- Answers stream in as they are written. **Stop** ends an answer early.
- Chips under a message show what the Agent looked at or did.
- Enter sends; Shift+Enter adds a new line.

## Talk to the Agent

Select the **microphone** next to the paperclip (or press **Ctrl+Shift+Space**, **⌘+Shift+Space** on a Mac) and speak. The button turns red, a **Listening…** line appears above the message box and your words appear in the box as you talk. Pause, or select the microphone again, to stop. The text stays in the box so you can correct it before you send it; nothing is sent until you select **Send** (unless your admin turned on **Send automatically after dictation**). Typing while you dictate stops the microphone and keeps what you typed.

The first time, your browser asks to use the microphone: select **Allow**. On a phone it works in the Agent sheet the same way.

| Browser | How it works |
|---|---|
| Chrome, Edge (desktop and Android) | The browser's own speech recognition — words appear as you speak |
| Safari (Mac, iPhone, iPad) | The browser's own speech recognition (needs Siri or Dictation turned on in the device's settings) |
| Firefox and some in-app browsers | No speech recognition of their own: when your admin set up a transcription provider (**Transcription provider** or **Automatic**), the recording is transcribed when you stop. Otherwise the microphone is shown greyed out and says why |

If something goes wrong, a short message under the box says what to do:

| Message | What to do |
|---|---|
| *Microphone access is blocked…* | Allow the microphone for this site in the browser (the icon in the address bar, or the browser's site settings) and try again. |
| *Speech recognition is turned off in this browser or device…* | On iPhone and iPad, turn on Siri or Dictation in Settings. |
| *Didn't hear anything…* | Select the microphone and start speaking within a few seconds. |
| *No microphone was found* / *The microphone is in use by another app* | Connect a microphone, or close the other app (a video call, for example). |
| *…couldn't reach the browser's speech service* | Chrome and Edge recognise speech online. Check your connection. |

> [!NOTE]
> **Privacy.** With browser speech recognition the browser does the work: **Chrome and Edge send the audio to Google's or Microsoft's speech service**, and Safari to Apple's (or on the device). UserTasks never receives that audio, only the text that ends up in the box. With a **transcription provider**, the recording goes to the UserTasks server and from there to the provider your admin chose (for example OpenAI Whisper). It is held in memory for that one call, never stored and never logged. Recordings are limited to 10 MB, about 2 minutes. If your organisation prefers that audio doesn't go to a browser vendor, ask your admin to choose **Transcription provider**.

## Where the Agent works

The Agent is available across the app. What it can do on each screen follows your permissions, and every change waits for your confirmation.

| Where | What it helps with |
|---|---|
| Home | Planning and [building a whole process](#build-a-complete-process-from-a-document) |
| Forms you fill in and tasks | Filling in fields, summaries, comments, [what happens next](#ask-what-happens-next) |
| Form designer and workflow builder | Building and editing forms and workflows, and [fixing failed tests and runs](#ask-agent-to-fix-a-failed-run) |
| Data tables and decision tables | Columns, rules, tests and [rows](#add-edit-and-delete-data-table-rows) |
| Reports (builder and viewer) | Building and editing reports (columns, filters, grouping, summary charts), and explaining the data |
| Agents (designer and playground) | Drafting and editing workflow agents: instructions, tools, knowledge |
| Integrations | Setting up connectors and references |
| Email templates, Extensibility, settings and more | Explaining and editing, within your permissions |

**In the Agents section**, new workflow agents are created inactive. The confirmation card lists the agent's data grants, who can use it (access), where it runs (hosts) and any powerful tools a change adds. The Agent never changes an agent's data grants without showing you.

**In Integrations**, the Agent reads connections and references, and can run **Test the connection** after you confirm. It never asks you to paste a key, token or password into the chat. It points you to the connection's secret fields, so credentials go straight into encrypted storage.

## One conversation that follows you

The Agent keeps **one conversation** as you move around the app. Open it in the form designer, go to the workflow builder, and the panel stays open with the same history, so you can say "the form we just made". When you move to another screen, a divider in the conversation reads **Now on …**.

The history is stored in this browser, for you in this workspace. It survives a reload, but it doesn't follow you to another device or browser, and it is cleared when you sign out. Nobody else sees it.

A **context chip** under the panel title shows what the Agent is looking at now, for example **Looking at: Workflow “Purchase request”**: the form you are filling in, the task, or the item open in a builder. What it can do changes with that context and with your permissions.

Select **New conversation** to clear the history and start again.

## Keep working while the Agent works

You don't have to wait for a long answer, such as a [build plan](#build-a-complete-process-from-a-document). Close the panel (**Close the Agent**, or Escape) while the Agent is working and it carries on in the background:

- A message says *Agent is still working on “…”. You'll get a notification when it's done.* Select **View** to open the panel again.
- The **Background jobs** icon in the top bar shows the work and its progress, for example *Agent: Build a patient intake process* with *Creating form “Patient intake” — 3 of 8 items*. **Cancel** there stops it at its next step.
- When it's done, the bell shows **Agent finished: …**, **Agent needs your confirmation: …**, **Agent needs your answer: …** or **Agent stopped: …**. Select it to open the panel with the result added to the conversation. A confirmation card or a question waits for you as usual; confirming or answering carries on, and you can close the panel again. The **Background jobs** panel shows *Waiting for your answer* when the Agent stopped at a question.

The work also carries on if you go to another page, reload or close the tab. When you come back, the panel shows *Working in the background* until it's done, then adds the result. **Stop** in the panel still stops the Agent.

Background work runs as you, with your permissions and the same limits as any other request. You can have up to 2 Agent requests working in the background at a time; with more, the Agent keeps working only while the tab is open. The result is kept on the server only until your browser adds it to the conversation (at most 24 hours), and only you can see it. On a phone, closing the Agent sheet works the same way.

## Questions with answer buttons

When the Agent needs you to choose between a few options, it asks with **buttons** instead of a question you have to type an answer to, for example *Who should the Manager approval task go to?* with **Assign to me for testing**, **The submitter's manager**, **A team…**, **A specific person…** and **Leave unassigned (queue)**.

- **Select a button** to answer. Your choice appears as your reply in the conversation (*Assign to me for testing*) and the Agent carries on from there.
- **Other…** (when offered) opens a box to type your own answer; press Enter or **Send**.
- Some questions let you pick **several** options: select each one, then **Send**.
- The buttons work with the keyboard (Tab, then Enter or Space) and on phones.
- An answered question shows **You answered: …**. A question you left unanswered stays usable while it is the latest thing in the conversation, even after a reload; once you send another message, it shows **Expired — not answered**.
- Open questions (*What should the form be called?*) are still asked in text, sometimes with suggested answers as buttons plus **Other…**.

## Filling in a form

Ask about the form (*"What does this form need from me?"*, *"Why can't I submit?"*), or tell it your details and ask it to fill fields in (*"Help me fill this in"*).

- It sees the form as you do: the visible fields, labels, help text, options, limits, current values and errors.
- Suggested values arrive on a card that lists each field with its current and new value. **Apply** sets one, **Apply all** sets them all, **Dismiss** throws them away.
- Values go in through the form itself, so rules, dynamic fields and validation run as if you had typed them.
- It only fills visible fields you can edit. Hidden, read-only and secret fields are never filled, and they are checked again when you select Apply.
- People pickers, lookups, attachments, data tables and custom controls are left for you.
- **It never submits the form.** That is always your click.

A form's owner can turn this help off for one form. See [Per-form setting](/docs/ai-assistants#per-form-setting).

## Working a task

On a task, ask it to summarise the task and comments, explain what each outcome means, or help you respond.

- **Draft a comment**: you get a draft to copy, or **Post as comment** to post it as yourself.
- **Suggest an outcome**: you get a suggestion with its reasons. A suggestion never actions the task.
- **Fill in the task's form fields**: the same card as on forms.
- **See what's in a task**: ask *"What's in this request?"* or *"Summarise the form"*. The Agent shows the form as a compact card: each field and its value (option labels, Yes / No, money, attachment names; secret fields masked), required fields that are still empty flagged in red, and the outcome buttons in their colours. It works for any task you can see, including one you were invited to view.

### Complete, approve or decline a task

Ask *"Approve this"*, *"Decline Ethan's leave request — the dates clash"* or *"Accept the contract review and complete it"* — on the task, or anywhere (the Agent finds the task by name with find_active_tasks and asks which one if several match). The Agent only acts when you explicitly ask for an outcome; it never infers an approval from a question or from its own suggestion.

1. **Required fields first.** The Agent reads the task's form. If required fields are empty, it shows no card: it tells you exactly which fields are needed (label, type, options and help text) and asks for them — with buttons for yes / no and choice fields, as a question for text. Fields it can't fill (files, people, lookups, secret fields) you fill in on the task page. It never makes values up.
2. **The values.** On the task screen it proposes them on the usual card (**Apply** / **Apply all**); elsewhere it sends them with the completion (or saves them as a draft first, on a **Save values** card).
3. **The confirmation card** shows the task, the outcome (in its colour), your comment, the field values being submitted (changed ones highlighted), whether you act on someone's behalf, and what happens next (for example *Next: goes to Priya Shah (CFO) for approval*). Nothing happens until you select **Confirm**. **Cancel** leaves the task as it was.

It follows the same rules as the task page:

| You are | What happens |
|---|---|
| The assignee, a collaborator, or a member of the task's team | It completes the task for you. |
| In the assignee's manager chain, or a manager of the workflow | It acts **on behalf** of the assignee: it asks for your reason first, and the card says *On behalf of …*. The assignee is notified. |
| A holder of **Complete any task (break-glass)** | Also on behalf, with a reason; the card is flagged red as **Break-glass**. |
| Invited to view the task, or unrelated to it | It refuses and says why and who can action it. |

- **Queued tasks** (waiting for your acceptance): the card's button is **Accept and complete** — the task is accepted, then completed. You can also ask it to **accept**, **hold** or **decline** a queued task (hold and decline need a reason).
- **Tasks completed with form buttons** complete through the matching button, and its after-submit actions run. An outcome the form's buttons don't offer is refused. Tasks completed in an external form are refused.
- **History and audit** record the action as done through the Agent; acting on behalf is recorded and audited as on behalf (or break-glass), exactly as on the task page. The workflow carries on as usual.
- If you close the panel while it works, the request ends at the card as **Waiting for your confirmation**; open the Agent and confirm there.
- When **Let the Agent complete tasks** is off for you, it explains the task and points you to its buttons instead.

### Assign, reassign or take a task

Ask "assign this to me", "give this task to Ben" or "who has the leave approval? take it" — on a task, a run's process view, **My tasks**, **My team**, **Home** or the workflow queue. The Agent finds the task (find_active_tasks), and if it isn't clear who should get it, asks with buttons for the likely people or teams. Each change is a confirmation card naming the task, who has it now, who will get it and the reason; nothing changes until you confirm.

It can only do what you could do in the app:

| Change | Who |
|---|---|
| **Take ownership** (assign to yourself) | an admin (**Complete any task**) or a manager of the workflow, for an unassigned task; the assignee's manager for a report's task |
| **Reassign** to a person or a team | the assignee when the task allows redirecting; anyone in the assignee's manager chain; a manager of the workflow; an admin |
| **Claim** a queued team or group task | members of that team or group |

Otherwise it says why and who can. The change is audited (marked as made through the Agent), recorded in the task history and process view, and the new assignee is notified. See [unassigned tasks](/docs/tasks#unassigned-tasks-take-ownership).

## Ask what happens next

On a task that comes from a workflow, on a form that starts a workflow, or on a run's process view, ask the Agent about the process behind it:

- *What happens next?*
- *Who approves after me?*
- *What happens if I decline?*

The Agent reads the version of the workflow that this run is actually using and answers for each outcome. It covers:

- the next steps and who they go to;
- conditions and decision-table rules, in plain words;
- emails sent, data recorded and any waits;
- what has happened so far: who approved, when, and their comments.

For example, on an expense approval task:

> **You:** What happens if I approve?
>
> **Agent:** If you approve, the claim is checked against the *Approval policy* table. It's for $7,500, which is over the $5,000 limit, so it goes to the CFO, Dana Smith, with 3 days to respond. When Dana approves, finance and the requester are emailed and the claim is marked Approved in *Expenses*. If you reject it, the requester is emailed your comment and the process ends. So far: submitted by Sam Lee on 3 March.

It only tells you what you could see in the process view yourself.

## Building

With build permissions, the Agent helps in the form designer, the workflow builder, data tables, decision tables, reports, agents and Extensibility (custom actions and form controls). It uses the same tools as the [MCP server](/docs/mcp), bound to you: it only gets the tools your permissions allow.

### Every change is confirmed

The Agent reads freely: lists, definitions, the step catalog, checks. Before any change it shows a **confirmation card**: what will be created or changed (steps, fields, columns or rules added and removed), with warnings. Nothing happens until you select **Confirm**. **Cancel** tells it you said no.

Afterwards the card shows **Confirmed** or **Cancelled**. A card left unanswered for an hour ends as **Expired — nothing was changed**.

After a change, the card links to the item and the open builder reloads to show it. If the builder has unsaved changes, save them first: the card says so and **Confirm** waits.

### Drafts

- **Workflows** are saved to the draft. New workflows start inactive. Live runs keep using the published version until you publish.
- **Workflow agents** are created inactive.
- **Extensibility**: new custom actions are drafts and new form controls are disabled, for an admin to review.
- **Forms** and **decision tables** have no draft. A confirmed form change makes a new version that people filling the form see straight away (published workflows stay on their version). A decision table change is used at once by every workflow that calls it. The card warns you.

### The open item, or a new one

- When you ask for something of the **same kind** as the item you have open (say *"build an approval workflow"* with a workflow open), the Agent asks first: *Build it in “Purchase request” (the workflow you have open), or create a new workflow?* Choose **Use the open workflow** or **Create a new workflow**. The same applies to forms, data tables, decision tables, reports and agents. If you already said "here", "this …" or "a new one", it doesn't ask.
- **"This" and "it"** mean the item you have open: *"Add a reminder to this task step"* changes the open workflow.
- When you ask for a **different kind** (a form while you are in the workflow builder), it can offer to create it and link it to what you have open. You still confirm each change.

### Who tasks are assigned to

A workflow's **User Tasks** need someone to act on them. When the Agent builds or changes a workflow and your request doesn't say who each human step goes to, it asks with buttons: **Assign to me for testing**, **The submitter's manager** (for workflows started by a form), **A team…** (then one button per team), **A specific person…** (suggested people, or type a name) or **Leave unassigned (queue)**. For a build plan it asks once for all the human steps, or step by step when they clearly go to different people.

- If you say *"just build it"* or skip the question, the tasks are **assigned to you**, so you can test the workflow straight away. The confirmation card says **Assigned to you for testing — change before publishing**, the Agent says so in its summary, and the step shows the note *assigned to the workflow's creator for testing* in the workflow builder. Change the assignee before you publish.
- Every workflow confirmation card, including the build plan, lists each User Task's assignee, for example *Assignee of “Manager approval”: the submitter's manager*.
- To fix an existing workflow, open it in the workflow builder and ask *"Fix the unassigned task"*. The Agent finds the User Tasks with no assignee (the **unassigned** wiring warning), asks who they should go to, and shows the change on a confirmation card before it updates the draft. **Ask Agent to fix** handles the warning the same way.

## Ask Agent to fix a failed run

When a step fails, an **Ask Agent to fix** button appears:

- in the **Save & test** runner, next to the error;
- on a failed run's **Process view** (open it from the workflow's runs), in the page header.

You see it when the Agent is on and you can edit the workflow.

The Agent looks at the failed step, the error, the step's settings and the values it had at that moment (secrets are masked). Then it:

1. **Explains the cause** in plain words.
2. **Proposes a fix**, where there is a safe one, on a confirmation card. For example:
   - a wrong variable path (\`{{form.amout}}\` instead of \`{{form.amount}}\`);
   - a text value used as a date (add a **Format Date** step, or change the form field to a date);
   - a misspelled or missing setting.
3. After you select **Confirm**, the fix is saved to the draft. From a test, select **Re-run test** under the change to run the same inputs again. For a real run, test the draft, then publish it.

Some failures can't be fixed in the workflow: an external service that is down, a missing permission, or bad data in a record. The Agent says why and suggests what to do next.

For a real run, the Agent only proposes draft workflow fixes. It never changes your data and never retries the run. Re-running a test, or retrying a run, is always your choice.

## Build a complete process from a document

Give the Agent a documented process (a procedure, a policy, a flowchart or a photo of a whiteboard), or just ask for a solution (*"Build a purchase request solution"*). It plans and builds the whole solution: data tables, forms, decision tables, the workflow and reports.

1. Start from **Home → Build from a process with Agent**, or open the Agent on any screen.
2. Upload or paste the process and ask, for example, *"Build this process."* If it isn't clear how much you want, the Agent asks with buttons: **Just a form** or **A full solution**.
3. For a build of two or more items, the Agent asks whether to **package** it (see [Package a solution](#package-a-solution)).
4. The Agent shows a **build plan** card, titled **Build plan: …**. It lists every item it will make (up to 30), grouped by section, with what each one is for and how they link:
   - **Data model**: the main table, **child tables** linked to it (for example *Line items* → *Purchase requests*) and **configuration tables** such as categories or locations;
   - **Forms**: the **application form** (with lookups to the configuration tables and a line-items grid where the process has lines), a **task form** for each approval step, and an **admin form** for each configuration table;
   - **Rules**: decision tables, such as approval thresholds;
   - **Workflows**: the main process, and small helper workflows where useful;
   - **Reports**: one per main table, with summary charts (by status, by category, over time);
   - **Package**: when you chose to package it.
5. Adjust the plan in chat (*"Add a cost centre column"*, *"Skip the admin forms"*, *"Have HR approve after the manager"*). The Agent shows an updated plan.
6. Select **Build all** (**Build it** when the plan has one item).

The Agent creates the items in order (tables, then forms, then decision tables, then workflows, then reports, then the package) and wires them together: the workflow starts from the application form, saves the main row, adds one child row per line, calls the decision table and updates the row after each approval. The card shows progress and a link for each item as it is made.

- **Every item is checked first.** Before the card is shown, each item is checked against what its create tool accepts and against the platform's own rules: a lookup column must point at a column that exists, a grid on a form must use the table's columns, an admin form's save step must be complete, and report columns and charts must be valid. The Agent fixes anything that fails before you see the plan.
- **Everything is a draft or unpublished.** The workflow is an inactive draft until you test and publish it.
- **Permissions are checked first.** Items you don't have permission to create are marked **Skipped** on the plan, with the items that depend on them, so you can remove them or ask someone who can.
- **If a step fails, it stops.** The Agent reports what was already created and offers to fix the failed item and continue, which you confirm again.
- **Long builds pause.** After about 150 seconds in one request the build pauses, and carries on with the remaining items when you confirm again.
- **Tasks have an assignee and can be redirected.** The plan card shows who each User Task goes to. If you didn't say, the Agent asks first; if you skip, they are assigned to you for testing (see [Who tasks are assigned to](#who-tasks-are-assigned-to)). Every task the Agent creates lets its assignee **redirect** it (the card says *redirect allowed*), unless you ask for no redirect.

### What a full solution contains

A full solution follows the Agent's **solution blueprint**, scaled to what you asked for (a single form stays a single form):

| Part | What the Agent builds |
|---|---|
| Main table | A title or reference column first, sensible column types (numbers for amounts, dates, statuses as choices) and required columns |
| Child tables | Linked to the main table with a lookup column, for example *Line items* → *Purchase requests* (or *Patient* → *Visits* → *Prescriptions*) |
| Configuration tables | Categories, locations, statuses or settings that admins maintain and forms look up |
| Application form | Lookups to the configuration tables and an editable grid for the child rows, which starts empty |
| Task forms | One per approval step, showing the request read-only (prefilled) with a comment box |
| Admin forms | An editable grid on each configuration table; **Save** writes the added, changed and deleted rows back. They are kept out of the Forms menu: share them with your admins from the form's **Access** tab |
| Rules | Decision tables for thresholds and routing, read by the workflow |
| Workflow | The main process, with zero wiring warnings |
| Reports | One per main table, with charts; they share a category so they sit together on Reports |

### Package a solution

When the Agent builds two or more items, it asks before **Build all**: *Package the solution?*

- **Package this solution** (recommended): every item the build creates goes into one package, version **1.0.0**, named after the solution.
- **Package and share to the gallery…**: the same, then the Agent offers to share it (only where the community gallery is available).
- **Don't package**.

A package lets you **remove the whole solution in one go**, version it and share it. The plan card shows **Packaged as: …** and a **Package** row. After the build, the Agent's summary links to the package. The package is listed under **Packages → Authored here**, and registered under **Packages → Installed**. Uninstalling it there removes everything it created. Items you changed since are kept unless you force it, and tables that hold rows are kept unless you choose to delete their data.

- Making a package needs the **Manage packages** permission. Without it, the plan card says packaging is skipped and the items are still built.
- Registering it for one-click uninstall needs **Install packages**. Without it, the package is still made, and the Agent says so.
- If a package of that name already exists (you are rebuilding or adding to a solution), the Agent asks **Add to package …** instead. The new items are added and a new version is built.
- Items built one at a time over a conversation can be packaged afterwards: ask *"Package what we built."*

### Share a solution to the gallery

After packaging, the Agent can share the package to the community gallery. It prepares the listing (title, summary, description, category and tags) and shows it on a confirmation card. It follows the gallery's normal process: the package is checked straight away and **submitted for review**. Nothing is public until a moderator approves it, and you are emailed the decision. Sharing is offered only where the community gallery accepts submissions.

See the tutorial [Build a complete process from a document](/docs/tutorials/agent-build-from-process).

## Add, edit and delete data table rows

With **Manage rows** on a table, the Agent can change its rows. Find the table by name (*"Temporary employees"*), or say "this table" on the table's own screen.

- *Add 10 fictional employees to Temporary employees.*
- *Set status to Inactive where the end date is before today.*
- *Delete the test rows.*

Every change shows a preview first:

- **Adding rows**: the first 10 rows, then *…and N more*, and how many will be added.
- **Editing rows**: each change as before → after.
- **Deleting rows**: the rows that will go, with a warning and a red **Delete N rows** button. For more than 25 rows you also type *delete N* to confirm.

Nothing changes until you confirm. Each call handles up to 200 rows; updates and deletes by a filter change 50 rows by default (200 at most). Ask again, or narrow the request, for larger changes. Workflows that start when a row is created, updated or deleted still run, exactly as if you had made the change yourself.

## Upload a form or process and build from it

You can give the Agent a file and ask it to build from it: a paper form, a screenshot of an old system, a photo of a whiteboard process, or a written procedure.

1. In the Agent panel, attach a file: use the paperclip (**Attach files**), drag it onto the panel (**Drop files to attach**), or paste it (for example a screenshot).
2. Say what to make: *"Build a form from this"* or *"Turn this process into a workflow"*.
3. As with any building request, the Agent asks whether to use the item you have open or create a new one, then shows a confirmation card. Nothing is saved until you select **Confirm**.

| You can attach | For example |
|---|---|
| Images (PNG, JPEG, WebP) | A screenshot or photo of a form, a whiteboard or sketched process |
| PDF and Word (.docx) | A paper form, a policy or a written procedure |
| Text and Markdown | Notes, a list of fields, process steps |
| CSV and Excel (.xlsx) | A list of fields or options, or sample data for a table |
| BPMN 2.0 and draw.io XML | A process diagram from another tool |

- **Images need a vision-capable model** (most current OpenAI, Claude, Gemini and Grok models are). If your model can't read images, the Agent uses text recognition where available, or explains how to fix it, for example by choosing another model in [Settings](/docs/ai-assistants#set-up-a-provider).
- Each file can be up to **10 MB** (images **5 MB**), with up to **4 files** per message. PDFs can be up to **20 MB** when your model reads PDFs itself. Text over 60,000 characters is truncated, and the Agent says so.
- Files aren't stored on the server. The conversation history keeps an attachment chip, not the file. After a reload, earlier images and PDFs are *no longer available* to the Agent (it keeps a PDF's text if it had one). Attach the file again for the Agent to look at it again.
- **If a file can't be read**, its chip shows why, and the Agent is told the file arrived but couldn't be read, so it says so instead of answering without it.

### PDFs and scanned documents

How the Agent reads a PDF depends on your model:

| Model | How the PDF is read | Scanned PDFs (no text layer) |
|---|---|---|
| Claude through Anthropic's API (Claude 3.5 and later, 4.x, 5.x) | The model gets the PDF itself, with its layout, tables and images | Read directly |
| OpenAI vision models (gpt-4o, gpt-4.1, gpt-5, o1, o3, o4-mini) | The model gets the PDF itself | Read directly |
| Other vision models (for example Gemini, Grok, Mistral) | The PDF's text | The scanned pages go as images: the first 10 pages, and the Agent is told which pages it got |
| Models that can't read images | The PDF's text | Text recognition (OCR) on the first 10 scanned pages, where the instance has it |

- A PDF the model reads itself can have up to **20 MB** and **600 pages** (**100 pages** for Claude models with a 200k context window, and for OpenAI). Larger PDFs are sent as their text, truncated at 60,000 characters.
- Up to **20 MB** of PDFs per message go to the model whole. During a session the Agent keeps the latest PDF for follow-up questions, so you don't have to attach it again until you reload. Claude caches it, so follow-up questions cost less.
- If nothing can read a scanned PDF, the chip and the Agent say: *This PDF is a scan and your current model can't read scanned PDFs.* Switch to a model that reads PDFs (for example Claude, in [Settings](/docs/ai-assistants#set-up-a-provider)), or attach the pages as images (PNG or JPEG).
- Claude reads PDFs itself only through Anthropic's own API. Through a gateway or proxy, the Agent uses the fallbacks above.

## Admin tasks and settings

With **Admin help** (see [Setting up the Agent](/docs/ai-assistants#admin-help)), the Agent helps on the admin pages: **Team**, **Organization**, **Settings** (its tabs, **Theme**, **Governance** roles and retention, **Invitations**, **Log export**, **SSO and directory sync**), **Email templates** and **Activity**. The **Looking at** chip names the page, and the starter prompts follow it.

- **Explain.** *Explain the settings on this page*, *Who has access to Settings?*, *Why can't Chloe see Reports?*, *Who reports to Priya?*, *Is the workspace healthy?*, *How much has the Agent cost this month?* It reads, explains, and says which permission is missing and which role would give it — it doesn't change anything unless you ask.
- **Change, with a card.** *Invite sam@example.com as a Member*, then *add Sam to Finance* once Sam has accepted; *Set Priya as Tom's manager*; *Create a Finance reviewer role that can view reports and data*; *Apply a calm blue theme*; *Create a policy that deletes submissions after 2 years*. Each card shows before → after and the impact (for example *Loses 3 permissions* or *This removes their access to what is shared with the team: 3 workflows*). Deactivating someone and deleting a retention policy are red cards where you type the confirmation.
- **Import the org chart.** Attach a CSV (email, display_name, manager_email, job_title, department, …) and ask *Import the attached org chart*. The card previews every row (update, create, unchanged, errors) and nothing is written until you select **Confirm**.
- **Secrets and sign-in stay on their pages.** Ask *How do I rotate the SCIM token?* and the Agent explains the steps and links the page; it never handles the secret itself.

## Styling with the Agent

Ask the Agent to style a form, the workspace theme or the form sign-in page in your own words: *Make this form pill buttons, Fraunces headings, soft shadows and a dark palette*, *Use our teal on the sign-in page*, *Give the workspace display headings*.

- **It checks what is possible first.** Before a change it reads the list of settings each theme accepts — for forms: colours for light and dark, body and heading fonts, button shape, shadow, field style, appearance (light / dark / follow the viewer), corner radius, density, width and header — and uses only those. That list comes from the same rules that save the theme, so it is always current.
- **One card, before → after.** A theme that wouldn't save is corrected before you see anything; the card lists each setting that changes, before → after, with colour swatches.
- **It says when something isn't available.** Custom CSS, raw shadows, fonts outside Google Fonts (other than an uploaded woff2) or a background image aren't theme settings: the Agent says so plainly and offers the closest option (for example a named shadow level, a curated serif, a page gradient) or the workspace-level setting.
- **New forms end on a thank-you page.** Forms the Agent creates get the same animated success page as the form wizard (a check mark, *Thank you — your response was submitted*, the reference number, and a light confetti burst where motion is allowed), unless you ask for something else — *no success page*, *calmer animation* or your own wording.

## Example prompts

**Form designer**

- *Add a phone field with validation.*
- *Suggest fields for an expense claim form.*
- *Make "Reason" required only when Type is "Other".*
- *Check this form for accessibility issues.*

**Workflow builder**

- *Explain what this workflow does.*
- *Add an approval step after the first user task, assigned to the requester's manager.*
- *Send the requester an email when the task is rejected.*
- *Check this workflow for problems.*

**With an upload**

- *Build a form from this screenshot. Keep the same sections.*
- *Turn this whiteboard photo into a workflow, with an approval at each diamond.*
- *Create a data table with these columns* (with a CSV attached).

**Workflows list**

- *Build a leave request process with a manager approval.*
- *List my workflows.*

**Data tables**

- *Create a table for tracking equipment loans.*
- *Add a status column with choices.*
- *Explain this table's columns.*

**Data table rows**

- *Add 5 sample rows to this table.*
- *Mark every loan returned before 1 March as Closed.*
- *Delete the rows where the email is empty.*

**Decision tables**

- *Create a discount decision table by order size.*
- *Explain the rules in this table.*
- *Test this table with an order of 2,500.*

**Reports**

- *Add a chart of requests by department.*
- *Group this report by status and show the total amount.*
- *Only show requests from the last 30 days.*
- *Why did approvals drop in March?*

**Agents**

- *Draft instructions for an agent that triages support tickets into billing, technical and account.*
- *Add a test case where an outage message must be urgent.*
- *Which tools does this agent have, and which ones change data?*

**Integrations**

- *Help me set up the Slack connector.*
- *Which references does this integration have?*

**Team, roles and organization**

- *Invite sam@example.com as a Member.*
- *Why can't Chloe see the Build menu?*
- *Who can approve purchase requests?*
- *Set Priya as Tom's manager.*

**Settings**

- *Explain the settings on this page.*
- *Which retention policies are in use?*
- *Any failed runs or SLA breaches this week?*

**Extensibility**

- *Create a custom action that formats a phone number.*
- *List the custom form controls.*
- *Explain what this action does.*

The tutorial [Use the Agent to build a form and workflow](/docs/tutorials/agent-build-form-and-workflow) walks through a full example.

> [!TIP]
> Be specific, ask it to explain before it changes, and read each card. The Agent is fast at the tedious parts (fields, columns, steps, rules), but you decide what is saved and published.
`,
  },
]
