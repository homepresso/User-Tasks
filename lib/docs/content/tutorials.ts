import type { DocPageDef } from '../types'

/**
 * Step-by-step tutorials. UI labels are the ones in the code (designer
 * panels, dialogs, buttons); JSON snippets use the canonical node config
 * shapes from lib/workflow-schema.ts and the node handlers.
 */
export const TUTORIAL_PAGES: DocPageDef[] = [
  {
    slug: 'tutorials',
    title: 'Tutorials',
    description: 'Step-by-step tutorials: build a form, a form with the wizard, an approval workflow, an AI agent, an integration, data and decision tables, and migrate an InfoPath form.',
    tocDepth: 2,
    body: `
Each tutorial builds one working thing from start to finish. They take 10 to 30 minutes and use only the app (no code). Every tutorial lists the permissions you need, numbered steps with the labels you will see on screen, and links to the reference pages.

| Tutorial | You build | Time |
|---|---|---|
| [Build your first form](/docs/tutorials/first-form) | A request form in the form designer: fields, validation, rules, steps, preview, sharing | 20 min |
| [Build a form with the wizard](/docs/tutorials/first-form-wizard) | A survey with a results page, in plain-language steps. No designer needed | 10 min |
| [Build an approval workflow](/docs/tutorials/approval-workflow) | A form that starts a manager approval, with branches, variables, an email and a parallel step | 30 min |
| [Build an AI agent](/docs/tutorials/ai-agent) | An agent with instructions, tools, knowledge and tests, then used as a step in a workflow | 25 min |
| [Connect an integration](/docs/tutorials/integration) | A REST API and a Slack connection, called from a workflow | 20 min |
| [Data tables and decision tables](/docs/tutorials/data-and-decision-tables) | A table that stores requests and a decision table that picks the approver | 20 min |
| [Use the Agent to build a form and workflow](/docs/tutorials/agent-build-form-and-workflow) | A form and its workflow, built by asking the built-in Agent, in one conversation | 15 min |
| [Migrate an InfoPath form](/docs/tutorials/migrate-infopath) | An InfoPath expense report rebuilt as a UserTasks form with its line items, totals, rules and a submissions table | 10 min |
| [Build a complete process from a document](/docs/tutorials/agent-build-from-process) | A leave request process (tables, forms, a decision table, the workflow and a report) planned and built by the Agent from a written procedure | 15 min |

## Before you start

- You need a workspace and an account. See [Quickstart: cloud](/docs/quickstart/cloud) or [Quickstart: self-host](/docs/quickstart/self-host).
- The **Owner**, **Admin** and **Manager** roles can do every tutorial. A **Member** can do the wizard tutorial. See [Roles and permissions](/docs/governance/roles-and-permissions).
- The tutorials build on each other in the order above, but each one also works on its own.

## Where things are

| You want | Side menu | Address |
|---|---|---|
| Forms | **Build › Forms** | \`/automations/forms\` |
| Wizard forms and drafts | **My forms** | \`/forms/wizard\` |
| Workflows | **Build › Workflows** | \`/automations\` |
| Data tables | **Build › Data** | \`/data\` |
| Integrations | **Build › Integrations** | \`/integrations\` |
| Agents | **Build › Agents** | \`/agents\` |
| Decision tables | **Govern › Business rules** | \`/automations/rules\` |
`,
  },
  {
    slug: 'tutorials/first-form',
    title: 'Tutorial: build your first form',
    description: 'Build an equipment request form in the form designer: fields, validation, rules (including read-only), steps, preview with test inputs, saving, and sharing a link or an embed.',
    body: `
**Goal:** an *Equipment request* form with a few fields, validation, a rule that shows a field only when it is needed, two steps, and a link you can share.

**You need:** the **Edit forms** permission (\`forms.edit\`). Owner, Admin and Manager have it. To share a public link, an admin must allow anonymous forms (step 9).

**Time:** about 20 minutes.

> [!TIP]
> Not a designer? [Build a form with the wizard](/docs/tutorials/first-form-wizard) makes the form, a responses table and a results page in a few plain-language steps.

## 1. Create the form

1. Go to **Build › Forms** and select **New form**.
2. If you are offered a choice, pick **Start blank**. (**Use the wizard (recommended)** opens the wizard instead.)
3. The designer opens on its own page with an empty grid. Select the name **Untitled form** in the toolbar, type *Equipment request* and press Enter. An optional **Description** and tags go in the **Form** tab on the right.

The designer is a full page, like the workflow designer. The toolbar has the way back to **Forms**, the name, **Undo** / **Redo**, **Design** | **Preview**, the save button and **⋯**. Below it are the **Field palette** and the **Outline** on the left, the grid in the middle with a status bar under it (fields, rules, submissions, the accessibility score and whether there are unsaved changes), and the properties panel on the right. When the Agent is open, it docks beside the designer.

::image forms-designer | The form designer page: the toolbar, the field palette and outline, the grid with its status bar and the properties panel | The form designer: drag fields from the palette onto the grid and set them up on the right.

## 2. Add fields

Drag each field from the palette onto the grid, or select it (or press Enter) to add it in a new row. Then set its **Label** in the **Field** tab. The **Key (from the label)** is filled in for you; it is how workflows read the value later (\`{{form.<key>}}\`).

| Palette item | Label | Settings |
|---|---|---|
| **Text** | Item | Tick **Required** |
| **Single select** | Category | Options *Laptop*, *Monitor*, *Phone*, *Other* |
| **Long text** | Describe the item | Leave it optional for now |
| **Currency** | Estimated cost | **Currency (ISO code)** *USD*, **Minimum** 0 |
| **Date** | Needed by | Optionally an **Earliest** date |
| **Text** | Cost centre | **Default value** *CC-100*, tick **Read-only (shows the default)** |

To put two fields side by side, drop the second one onto the same row. A row holds up to four columns.

## 3. Add validation

1. Select **Cost centre**, untick **Read-only** for now, and open **Validation**.
2. Set **Pattern (regular expression)** to \`^CC-\\d{3}$\`.
3. In **Message when it doesn't match**, enter *Use the format CC-123.*
4. Tick **Read-only (shows the default)** again if people should not change it.

**Required**, **Min length**, **Max length**, **Minimum** / **Maximum** and patterns are checked in the browser and again on the server when the form is submitted. See [Field types](/docs/tasks/forms#field-types) and [Validation is enforced on the server](/docs/tasks/forms#validation-is-enforced-on-the-server).

## 4. Show a field only when it is needed

*Describe the item* only matters when the category is *Other*. You can do this two ways.

**The quick way:** select *Describe the item*, open **Visible when**, choose the field *Category*, the operator *equals* and the value *Other*. A hidden field is not required and is skipped by validation.

**With a rule** (more options):

1. Open the **Rules** tab and select **+ New rule**. Name it *Show description for Other*.
2. **When:** *Always (while the condition holds)*.
3. **If:** **+ Add a condition**: *Category* *equals* *Other*.
4. **Then:** **+ Add an action…** → **Show / hide fields, sections, steps**, mode **Show**, target *Describe the item*.

To make it required only when it shows, use the field's **Required when (dynamic)** setting. There is no "make required" rule action.

::image forms-rules | The Rules tab with a rule that shows a field when a choice is selected | A rule: When, If, Then.

## 5. Make part of the form read-only with a rule

Rules can also lock fields. Lock the cost once someone picks *Phone* (phones have a fixed price):

1. **+ New rule**, named *Fixed phone price*.
2. **When:** *Always (while the condition holds)*. **If:** *Category* *equals* *Phone*.
3. **Then:** **Set or calculate field values**: *Estimated cost* = 800. Then add **Make read only / editable** → **Read only** → *Estimated cost*.

A rule's read-only applies in the browser. For a value the server must keep, tick the field's own **Read-only** box, as you did for *Cost centre*. See [Read-only](/docs/tasks/forms#read-only).

## 6. Split the form into steps

1. Above the grid, set **Layout** to **Steps**.
2. Select **Add step**. Name the steps *What you need* and *Cost and timing* in the **Step** tab.
3. Drag *Estimated cost*, *Needed by* and *Cost centre* onto the second step.
4. Under **All steps**, tick **Next checks the step**, so people fix errors before they move on.

**Tabs** works the same way. For a group of fields inside one page, add a **Section** from the **Group** palette and drop fields into it. See [Steps and tabs](/docs/tasks/forms#steps-and-tabs) and [Sections and optional sections](/docs/tasks/forms#sections-and-optional-sections).

## 7. Preview it, with test inputs

1. Switch to **Preview**. Try **Light** / **Dark** and **Desktop** / **Phone**.
2. Pick *Other* and check that *Describe the item* appears. Pick *Phone* and check that the cost locks.
3. Select **Check validation** to see every error at once, and **Reset values** to start again.

If the form declares parameters or variables (in the **Data** tab), **Inputs (n)** opens **Test inputs**, where you set their values for the preview. They are kept in your browser only. See [Parameters and variables](/docs/tasks/forms#parameters-and-variables).

## 8. Save

Select **Create form** in the toolbar (or press **⌘S** / **Ctrl+S**). The page now belongs to the saved form, and later saves show **Save version N**: every change to fields, layout or theme makes a new version, and the designer stays open. If you leave the page with unsaved changes, it asks first. Workflow drafts follow the latest version, and a published workflow keeps the version it was published with. See [Reusable forms](/docs/tasks/forms#reusable-forms).

## 9. Share it

In the designer's toolbar, **Open form** opens the form's page in a new tab. The **⋯** menu (also on the form's row in the forms library) has:

- **Copy link** copies the form's own page, \`/f/<id>\`. People in your workspace with **Submit forms** sign in and fill it in.
- **QR code & embed** (**QR code** in the library) opens the share dialog: build a **Link with parameters**, download the QR code, and open **Embed in a website** for **Copy embed code**.

To let people fill the form **without signing in** (and to embed it on a public website):

1. An admin turns on **Settings → Forms → Anonymous forms → Allow anonymous forms**.
2. In the designer's **Access** tab (or **⋯ → Settings** in the library), turn on **Anonymous responses → Allow anonymous responses**.
3. Copy the public link (\`/p/<token>\`) or the embed code.

The embed code is an \`<iframe>\` that points at the link with \`?embed=1\`. A form that needs sign-in cannot be filled inside a frame, so embed the public link.

To put the form in people's **Forms** menu, tick **Available forms** in the **Form** tab and grant access in the **Access** tab. People who must sign in see your **form sign-in page**; brand it at **Settings → Forms → Form sign-in page**. See [Sharing and embedding forms](/docs/tasks/forms#sharing-and-embedding-forms) and [Form sign-in page](/docs/tasks/forms#form-sign-in-page).

## What you built

- A two-step form with required fields, a pattern check and a field that is read-only on the server.
- A field that appears only when it is needed, and a rule that fills in and locks a value.
- A saved, versioned form with a link, a QR code and an embed code.

## Next steps

- [Build an approval workflow](/docs/tutorials/approval-workflow) that starts when this form is submitted.
- [Forms reference](/docs/tasks/forms): every field type, rule event and action, themes and lookups.
- [Survey controls](/docs/tasks/survey-controls): ratings, recommend scores, scales and rankings.
`,
  },
  {
    slug: 'tutorials/first-form-wizard',
    title: 'Tutorial: build a form with the wizard',
    description: 'The short path for non-designers: build a feedback survey, its responses table and a results page with charts in seven plain-language steps.',
    body: `
**Goal:** a *Team lunch feedback* survey that anyone in your workspace can fill in, with a results page that charts the answers.

**You need:** **Create forms with the wizard** (\`forms.wizard\`). Owner, Admin, Manager and Member have it by default. You don't need any designer permissions.

**Time:** about 10 minutes.

## 1. Start the wizard

Select **My forms** in the side menu, then **Build a form**. (You can also use **Build a form** on Home, or **+ New → Form with the wizard**.)

Your progress is saved as you go. If you leave, pick it up again from **My forms → Continue**.

## 2. What are you building?

1. Pick the **Feedback** template.
2. Enter the **Name** *Team lunch feedback* and a **Short description**.
3. Select **Next**.

If your workspace has an AI provider, **Describe it and we'll draft it** can write the questions for you. Describe the form (at least 10 characters) and select **Draft questions**. This replaces the questions already there.

## 3. Questions

The Feedback template starts with smiley faces and an agreement scale. Add two more:

1. In **Add a question**, pick **Star rating** and select **Add**. Set **Question** to *How was the food?* and **Out of** to 5.
2. Add a **Long answer**: *What could be better?*
3. Select the long answer, open **Show this question only if…**, and choose *How was the food?* **is less than** 4. Now it only appears for low ratings.
4. Tick **Required** on the rating.

The live preview on the right shows the real form as you work. Use the arrows to reorder questions.

## 4. Look & feel, and who fills it in

1. **Look & feel:** keep **Workspace look**, or pick a colour. Choose **All on one page**, and write a short thank-you **Message**.
2. **Who fills it in:** tick **People in this workspace (signed in)** → **Everyone in the workspace**, and **List it in their Forms menu**. Choose **One response per person**.

## 5. Review & approval, and the results page

1. **Review & approval:** keep **No review: just save the responses**. (For requests, pick *One person approves*, *The person's manager approves*, *A team* or *Several stages*. The wizard builds the approval workflow for you.)
2. **Results page:** keep **Charts for choices, ratings and recommend scores** on. Optionally add **Roles who can see the results**.

## 6. Create

On **Review and create**, check what will be made, then select **Create**. The **Your form is ready** screen has **Open the form**, **View results** and a **Copy link** button.

## What you built

- A **form** with a conditional question.
- A **data table**, *Team lunch feedback responses*, with one column per question.
- A **workflow** that saves each response as a row.
- A **results page** with response counts, a chart per question and every response.
- A saved **report**, *Team lunch feedback: responses*, with summary charts.

To change the form later, open **My forms → Edit** (or **Edit with the wizard** on the results page), change it and select **Save changes**. Collected answers are never removed.

## Next steps

- [Build a form with the wizard](/docs/tasks/form-wizard): every step, question type, approval option and chart.
- [Reports](/docs/reports#summary-charts): change the summary charts on the saved report.
- Outgrown the wizard? Open the form in the [form designer](/docs/tutorials/first-form).
`,
  },
  {
    slug: 'tutorials/approval-workflow',
    title: 'Tutorial: build an approval workflow',
    description: 'Build an expense approval: a form trigger, a User Task assigned to the manager with outcomes, a condition, Set Variable with several variables, an email, a parallel step with a Done edge, Save & test, the process view and run history.',
    body: `
**Goal:** when someone submits an *Expense claim* form, their manager approves or rejects it. Large approved claims also notify finance. The requester gets an email either way.

**You need:** **Create workflows** and **Edit workflows**, plus **Edit forms** for the form. Owner, Admin and Manager have them.

**Time:** about 30 minutes.

## 1. Make the form

Build a form called *Expense claim* with these fields. The [first form tutorial](/docs/tutorials/first-form) shows how.

| Label | Key | Type |
|---|---|---|
| Title | \`title\` | Text, required |
| Amount | \`amount\` | Currency, required |
| Receipt | \`receipt\` | Attachments |

## 2. Create the workflow

1. Go to **Build › Workflows** and select **New workflow**.
2. Enter the **Name** *Expense approval*. For **Trigger**, choose **When a form is submitted**.
3. Select **Create workflow**. The builder opens with a **Form Submitted** trigger.
4. Select the trigger. In **Form**, choose *Expense claim*. The **Available downstream** box lists what the next steps can use, such as \`{{form.amount}}\`, \`{{submitted_by_name}}\`, \`{{submitted_by_email}}\` and \`{{submitted_by_manager_id}}\`.

::image workflows-designer | The workflow builder with the node palette, the canvas and the Configure panel | The builder: the **Nodes** palette on the left, the canvas, and **Configure / Data / Variables** on the right.

## 3. Work out the approver (Set Variable)

Drag **Set Variable** from the palette and connect the trigger to it. Add two rows. Rows run top to bottom, so a later row can use an earlier one.

| Variable | Expression |
|---|---|
| \`approver_id\` | \`{{=COALESCE(submitted_by_manager_id, "<your user id>")}}\` |
| \`is_large\` | \`{{=form.amount > 1000}}\` |

\`submitted_by_manager_id\` comes from the reporting lines in **Org**. \`COALESCE\` falls back to you when the requester has no manager.

\`\`\`json title="Set Variable config"
{
  "assignments": [
    { "name": "approver_id", "expression": "{{=COALESCE(submitted_by_manager_id, \\"<your-user-id>\\")}}" },
    { "name": "is_large", "expression": "{{=form.amount > 1000}}" }
  ]
}
\`\`\`

## 4. Ask the manager (User Task)

Add a **User Task** after Set Variable and fill in **Configure**:

1. **Task title:** \`Approve {{form.title}} from {{submitted_by_name}}\`.
2. **Instructions:** \`Amount: {{form.amount}}\`.
3. **Assignment:** choose **Individual**, then under **Or use a variable:** enter \`{{approver_id}}\`.
4. **Due date:** **Relative**, 3 days after creation. Under **Reminders**, select **Add reminder**.
5. **Outcomes:** *Approve* and *Reject*. Each outcome adds a port on the canvas.
6. **Form (optional):** add a **Long text** field with the key \`review_note\` for the manager's comment.

Other ways to assign a task:

- **Individual**: a named person. Pick them, or use a variable.
- **Team**: anyone in the team can pick it up.
- **AAD Group**: an Entra ID group. It appears when your workspace has an enabled Entra ID directory connection (**Settings → Directory sync**). Choose **Anyone in the group can claim it** or **Everyone in the group gets it**.
- **The person's manager**: as above, \`{{submitted_by_manager_id}}\` in a variable.

There is no assignment by role. Use a team for a group of people. See [Assignment and SLAs](/docs/tasks/assignment-and-slas).

\`\`\`json title="User Task config"
{
  "task_title": "Approve {{form.title}} from {{submitted_by_name}}",
  "task_description": "<p>Amount: {{form.amount}}</p>",
  "task_priority": "medium",
  "assignment_type": "individual",
  "assignee_variable": "{{approver_id}}",
  "outcomes": ["Approve", "Reject"],
  "due_date_mode": "relative",
  "due_offset_amount": 3,
  "due_offset_unit": "days",
  "reminders": [{ "offset_minutes": 1440 }],
  "fields": [{ "key": "review_note", "label": "Comment", "type": "textarea" }]
}
\`\`\`

When the task is done, the next steps can read \`{{outcome}}\`, \`{{actioned_by_name}}\` and each field as \`{{task_data.review_note}}\`.

## 5. Branch on the outcome and the amount

Drag from the task's **Approve** port to a new **Branch by Condition** step. The edge gets the label *Approve*. In the condition:

1. Name the first branch *Large*. **Add rule**: \`{{is_large}}\` **is_true**.
2. Tick **Include Else branch (catches everything else)**.

All branches are checked, and every branch that matches runs. Add an Else branch to catch the rest.

\`\`\`json title="Branch by Condition config"
{
  "branches": [
    { "label": "Large", "logic": "and", "rules": [{ "field": "{{is_large}}", "operator": "is_true", "value": "" }] }
  ],
  "has_else": true
}
\`\`\`

> [!NOTE]
> A condition only follows edges labelled with a branch name (or *Else*). Drag from the branch's port so the label is set for you; an unlabelled edge from a condition never runs.

For a choice between fixed rules (amount bands, departments, regions), use a [decision table](/docs/tutorials/data-and-decision-tables) instead.

## 6. Notify finance and the requester at the same time (Parallel)

From the *Large* port, add a **Parallel / Sequential** step. Keep **All at once** and name the branches *Finance* and *Requester*.

1. From the *Finance* port, add **Send Email**. **To:** your finance address. **Subject:** \`Large expense approved: {{form.title}}\`.
2. From the *Requester* port, add **Send Email**. **To:** \`{{submitted_by_email}}\`. **Subject:** \`Approved: {{form.title}}\`. **Body (HTML):** \`<p>Approved by {{actioned_by_name}}. {{task_data.review_note}}</p>\`.
3. From the **Done** port of the Parallel step, add **End Workflow** with the **Reason** *Approved (large)*.

The **Done** edge runs once, after every branch has finished. Use it for whatever must happen after all the parallel work, not on one branch.

\`\`\`json title="Parallel config"
{ "mode": "parallel", "branches": [{ "label": "Finance", "order": 1 }, { "label": "Requester", "order": 2 }] }
\`\`\`

\`\`\`json title="Send Email config (Requester branch)"
{ "to": "{{submitted_by_email}}", "subject": "Approved: {{form.title}}", "body": "<p>Approved by {{actioned_by_name}}. {{task_data.review_note}}</p>" }
\`\`\`

## 7. Finish the other paths

- From the condition's **Else** port: **Send Email** to \`{{submitted_by_email}}\` with *Approved: {{form.title}}*.
- From the task's **Reject** port: **Send Email** to \`{{submitted_by_email}}\`, subject \`Rejected: {{form.title}}\`, body \`{{task_data.review_note}}\`.

A path with no outgoing edge simply ends. **End Workflow** is optional, but it records a reason.

## 8. Save & test

1. Select **Save & test**. The **Test workflow** panel opens.
2. Select **Add test case**, fill in the form (an amount of 1500), then **Run selected**.
3. The **Process view** shows each step as it runs. At the User Task the status is **Awaiting action**, with one button per outcome. Select **Approve**.
4. Check that both emails ran and the Done edge ran after them. **Logs** lists every step with its inputs and outputs.
5. Add a second case with an amount of 200 and check that it takes the Else path.

::image workflows-save-test | The Test workflow panel with the process view paused at a user task | Save & test: run test cases and act on tasks from the panel.

## 9. When a test fails

If a step fails, the test shows the error on that step. When the Agent is on and you can edit the workflow, select **Ask Agent to fix** next to the error.

1. The Agent explains the cause in plain words, for example *"\`{{form.amout}}\` doesn't exist: the field's key is \`amount\`."*
2. Where it can, it proposes a fix on a confirmation card. Read it and select **Confirm**.
3. Select **Re-run test** under the change to run the same test case again.

Some failures have no safe fix in the workflow, such as an email service that is down or a missing permission. The Agent then says why and what to try next. Failed real runs have the same button on their **Process view**; there the Agent only proposes draft fixes and never retries the run. See [Ask Agent to fix](/docs/ai-assistants/using#ask-agent-to-fix-a-failed-run).

## 10. Publish and watch the runs

1. Select **Publish**, add **Publish notes** and confirm. Publishing makes this version live and turns the workflow on. Runs already under way stay on their version.
2. Submit the real form.
3. In the builder's **⋯** menu, select **View runs**. Open a run for its **Process view**, **Variables** and **Logs**, and the **User Tasks** it created.

::image workflows-process-viewer | The process view of a run with completed and waiting steps | The process view of a run.

## What you built

- A form-triggered workflow that sets two variables and assigns a task to the requester's manager.
- Outcome branches, a condition with an Else branch, and a parallel step whose Done edge runs after both emails.
- Test cases you can run again after every change, and a published version with run history.

## Next steps

- [Node reference](/docs/workflows/nodes): every step and its settings.
- [Expressions](/docs/workflows/expressions) and [functions](/docs/workflows/functions).
- [Assignment and SLAs](/docs/tasks/assignment-and-slas): queues, escalation, completion rules.
- [Data tables and decision tables](/docs/tutorials/data-and-decision-tables): save each claim and choose the approver with rules.
`,
  },
  {
    slug: 'tutorials/ai-agent',
    title: 'Tutorial: build an AI agent',
    description: 'Create an agent in the Agents section: connect a provider, write its role and task, give it tools, knowledge and data, test it in the playground and with test cases, watch its costs, then run it as a workflow step.',
    body: `
**Goal:** a *Ticket triager* agent that reads a support request, looks up the customer in a data table, and returns a category and a priority. Then a workflow runs it on every new request.

**You need:** **View agents**, **Create agents**, **Edit agents** and **Test agents** (\`agents.*\`), and **Create integrations** for the provider. Owner, Admin and Manager have them; Member and Viewer don't.

**Time:** about 25 minutes.

> [!NOTE]
> **Agents** (this tutorial) are AI steps you design and run in workflows and chat. The **Agent** is the built-in assistant button that helps you fill forms, work tasks and build. See [Setting up the Agent](/docs/ai-assistants).

## 1. Connect an AI provider

Agents use a provider connection from Integrations.

1. Go to **Build › Integrations** and open the **Connectors** tab. Filter by **AI**.
2. Pick your provider: **OpenAI**, **Claude (Anthropic)**, **Google Gemini**, **xAI Grok**, **Azure OpenAI**, **Mistral AI**, **Groq**, **DeepSeek**, **Together AI**, **Perplexity AI** or **Ollama (Local)**.
3. Paste the API key, select **Continue**, then **Test Connection**, then **Enable Connector**.

See [Connect an integration](/docs/tutorials/integration) for more on connectors.

## 2. Create the agent

1. Go to **Build › Agents** and select **New agent**.
2. Enter the **Name** *Ticket triager* and a **Description**, then select **Create agent**.
3. In the designer, choose the **Provider** (your connection) and a **Model**. Leave **Model** empty to use the provider's default.

## 3. Write its role and task

In the **Identity & task** tab:

1. **Agent role:** *A support lead who sorts incoming requests.*
2. **Task:** *Read the request, look up the customer, and pick a category and a priority.*
3. **Custom instructions:** anything else, for example *Treat any mention of an outage as urgent.*

The **Generated system prompt preview** shows what the model receives. **Starter presets** fill these fields in for common jobs.

> [!TIP]
> **Ask the Agent to draft instructions (optional).** Open the **Agent** button in the designer and ask *"Draft the role, task and boundaries for an agent that triages support tickets into billing, technical, account or general, with a priority."* It proposes the text on a confirmation card. Any tool or data access it would add is listed on the card, and it never changes data grants without showing you. See [Using the Agent](/docs/ai-assistants/using#where-the-agent-works).

In **Boundaries**, add rules it must follow: *Never contact the customer. If unsure, choose "general".*

## 4. Declare its outputs

In **Output**, select **Add output variable** for each value the workflow needs:

| Variable name | Type | Allowed values | Required |
|---|---|---|---|
| \`category\` | String | billing, technical, account, general | yes |
| \`priority\` | String | low, normal, urgent | yes |
| \`summary\` | String | | no |

Tick **Strict** to fail the run when a required output is still missing after one repair attempt.

## 5. Give it data and tools

In **Tools**:

1. Under **Access scope → Data tables**, search for your *Customers* table and tick **Read**. Read lets the agent query the table. Insert, Update and Delete are separate, and new agents have no access until you grant it. An agent's row tools are always limited by these grants (and, when it acts for a person, by that person's own data permissions).
2. Under the built-in tools, add any others it needs, for example **http_get** to call a public status page. Set **Outbound hosts** in **Settings** to limit where URL tools can go.
3. To let it call an integration, open **API references** and add the reference (for example *Slack: Send Message*).
4. Under **Approvals**, tick tools that need a person to approve each call. A reviewer gets a task before the tool runs.

## 6. Add knowledge

In **Tools → Knowledge**, select **Add documents** and upload your support policy (PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, HTML or XML; up to 20 MB each). Under **Data tables to search**, pick tables it may search without write access. The agent searches these passages when it needs them.

Select **Save**. Every save makes a new version; **History** lets you restore an older one.

## 7. Try it in the playground

1. Select **Test**. The playground opens beside the designer and runs the **saved** agent.
2. Send *Customer ACME-42 says invoices won't download since this morning.*
3. Watch the tool calls and the answer stream in. The meta line shows tokens, cost, iterations and time. **View trace** opens the full run.

## 8. Add test cases

In the **Tests** tab, select **Add case**:

- **Case name:** *Outage is urgent*
- **Input message:** *Nothing loads, the whole team is down.*
- Outputs JSON: \`{"priority":"urgent"}\`
- **Tools it must call:** \`query_data_table\`

Select **Save case**, then **Run suite**. Tools that change data or call out are simulated during tests. Run the suite again after every change to the instructions or model.

## 9. Watch costs and set budgets

- **Settings → Budgets & limits** caps one agent: tokens per run, tool calls per run, and tokens or cost per day and month.
- **Agents → Costs & budgets** shows spend for every agent, workspace budgets, and **Model prices**. If a model shows *cost unknown* (for example an Azure OpenAI deployment with its own name, or Ollama), select **Fetch latest pricing** to review and save the latest list prices, or **Add price** to enter its price per million tokens, then **Save prices & budgets**.

## 10. Run it from a workflow

1. In a workflow (for example one triggered by a support form), add **Run Agent** from the palette.
2. **Agent:** *Ticket triager*. **Prompt / message:** \`Customer {{form.customer_id}} wrote: {{form.message}}\`.
3. Keep **Output variable name** \`agent_response\`. Optionally pass **Files (optional)**, such as \`{{form.screenshot}}\`.
4. After the step, use the outputs. Each declared output is a variable: \`{{category}}\`, \`{{priority}}\`, \`{{summary}}\`, and the reply text is \`{{agent_response}}\`. Add a **Branch by Condition** on \`{{priority}}\` equals *urgent* to page the on-call team.

\`\`\`json title="Run Agent node"
{
  "id": "triage",
  "type": "run_agent",
  "label": "Triage ticket",
  "position": { "x": 400, "y": 200 },
  "config": {
    "agent_id": "<agent-id>",
    "agent_name": "Ticket triager",
    "user_message": "Customer {{form.customer_id}} wrote: {{form.message}}",
    "output_variable": "agent_response",
    "timeout_ms": 120000
  }
}
\`\`\`

\`agent_id\` and \`user_message\` are required. **Act as** chooses whose permissions the agent's tools use (the person who started the run by default). Publishing the workflow pins the agent version it uses.

## What you built

- An agent with a role, boundaries, typed outputs, read access to one table, knowledge and approvals.
- A test suite and budgets.
- A workflow step that runs the agent and branches on its output.

## Next steps

- [Agents reference](/docs/agents): models, tools, acting identity, approvals, limits and versions.
- [Agents: tools](/docs/agents#tools) and [testing](/docs/agents#testing).
- [Connect an integration](/docs/tutorials/integration) to give agents more tools.
`,
  },
  {
    slug: 'tutorials/integration',
    title: 'Tutorial: connect an integration',
    description: 'Connect a REST API and Slack, test the connections, keep the credentials safe, and call them from a workflow with Call API / Reference. Includes OAuth 2.0 connections.',
    body: `
**Goal:** connect a REST API and Slack, then post a Slack message from a workflow with data from the API.

**You need:** **View**, **Create**, **Edit** and **Test integrations**, and **Manage references** (\`integrations.*\`). Owner, Admin and Manager have them.

**Time:** about 20 minutes.

Integrations are under **Build › Integrations**. The page has the tabs **Integrations**, **References**, **Connectors**, **Objects** and **MCP servers**. A **reference** is one call you can make (for example *Get customer* or *Send Message*). Workflows, forms and agents call references, never the raw API.

::image integrations | The Integrations page with connected services | Integrations: each connection, its status and its references.

## 1. Connect a REST API

1. Select **New integration**.
2. Enter a **Name**, choose **REST API**, and enter the **Base URL**, for example \`https://api.example.com\`. It must use HTTPS.
3. Choose **Authentication**: **API Key** (a **Header name** and the key), **Bearer Token**, **Basic Auth (user:pass)**, **OAuth 2.0 (configure after creation)** or **None**.
4. Select **Test connection**. It sends a GET to the base URL with your credentials. Many APIs answer 404 at the root even when the key is right, so a 404 is not always a problem.
5. Select **Create integration**.
6. On the integration's page, add references: by hand, or import an API spec with **Import → API spec (OpenAPI, Swagger, Postman)…**. See [References](/docs/integrations/references) and [OpenAPI import](/docs/integrations/openapi-import).

## 2. Connect Slack from a preset

Connectors are ready-made integrations with their references already written.

1. Open the **Connectors** tab and pick **Slack**.
2. Paste the **Bot User OAuth Token** (\`xoxb-…\`) and select **Continue**. Optionally set the **Default Channel**.
3. Select **Test Connection**. It should say which Slack workspace it connected to.
4. Choose the references to create (**Generate all**, or pick some), then select **Enable Connector**.

You now have an integration called *Slack (Connector)* with references like *Slack: Send Message*.

The **Connectors** tab has presets for messaging (Slack, Microsoft Teams, SendGrid, Twilio, Gmail, Exchange Online), databases (PostgreSQL, SQL Server, MySQL, Snowflake, MongoDB, Oracle Database and more), storage, e-signature, CRM and AI providers. Databases are always added from **Connectors**. See [Connectors](/docs/integrations/connectors).

## 3. Keep the credentials safe

- Keys, tokens and passwords are encrypted when they are stored (with the instance's \`ENCRYPTION_KEY\`). They are never sent back to the browser.
- Workflows never see the credentials. A step calls a reference, and the reference adds the credentials from its integration.
- Prefer an integration with **Call API / Reference** over the **HTTP Request** step for anything that needs a key. HTTP Request keeps its auth settings in the workflow itself.
- Each integration has its own permissions (who can view, edit and run it) at the bottom of its page.

## 4. Call it from a workflow

1. Open a workflow and add **Call API / Reference** from the palette.
2. Search for *Get customer* (from your REST API) and select it.
3. Under **Inputs**, map each input to a value, for example \`{{form.customer_id}}\`. Fill in every input you need.
4. Under **Outputs → variables**, tick the fields you want as variables.
5. Add a second **Call API / Reference** step, label it *Post to Slack*, and pick **Slack: Send Message**. Set **channel** to \`#support\` and **message** to \`New request from {{get_customer_response.name}}\`.

After a call, the full response is \`{{<step label>_response}}\` and the HTTP status \`{{<step label>_status}}\`. The step label is lower-cased with spaces as underscores: *Get customer* gives \`{{get_customer_response}}\`. A failed call (say a 404) does not stop the workflow, so branch on the status when it matters. Use **Insert data** or the **Data** tab to pick these values instead of typing them.

\`\`\`json title="Call API / Reference node"
{
  "id": "notify",
  "type": "call_reference",
  "label": "Post to Slack",
  "position": { "x": 400, "y": 300 },
  "config": {
    "reference_id": "<id of Slack: Send Message>",
    "input_mappings": {
      "channel": "#support",
      "message": "New request from {{get_customer_response.name}}"
    },
    "output_mappings": { "ts": { "enabled": true, "variableName": "slack_ts" } }
  }
}
\`\`\`

## 5. Connect with OAuth 2.0 (optional)

For APIs that use OAuth sign-in (authorization code with PKCE):

1. Create the integration with **OAuth 2.0 (configure after creation)**.
2. On its page, select **Edit** in **Connection Settings**. Enter the **Client ID**, **Client Secret**, **Authorization URL**, **Token URL** and **Scopes**.
3. In the provider's app settings, register the redirect URL \`https://<your-app>/api/connectors/oauth/callback\`.
4. Select **Connect** and approve the access. The page shows **✓ Connected**. Tokens refresh automatically; if access is revoked, select **Reconnect**.

Salesforce, Google Drive, Dropbox and the e-signature connectors fill in the OAuth endpoints for you. See [OAuth connections](/docs/integrations/oauth).

## What you built

- A REST API integration with references, and a Slack connector.
- A workflow that calls one, maps its response into a variable, and posts it to Slack.

## Next steps

- [Integrations](/docs/integrations) and [References](/docs/integrations/references): inputs, outputs, body modes and response models.
- [Webhooks](/docs/integrations/webhooks): start workflows from other systems.
- [Build an AI agent](/docs/tutorials/ai-agent) and give it your references as tools.
`,
  },
  {
    slug: 'tutorials/data-and-decision-tables',
    title: 'Tutorial: data tables and decision tables',
    description: 'Create a data table, save and read rows from a workflow with the Data step, and build a decision table that picks the approver for a Decision Table step.',
    body: `
**Goal:** save every expense claim in a data table, and let a decision table decide who approves it by amount.

**You need:** **Create tables** and **Edit schema** (\`data.create\`, \`data.edit_schema\`) for data tables, and **Edit workflows** for business rules and workflows. Owner, Admin and Manager have them.

**Time:** about 20 minutes. It builds on the [approval workflow tutorial](/docs/tutorials/approval-workflow), but works with any workflow.

## 1. Create a data table

1. Go to **Build › Data** and select **New table**.
2. Enter the **Name** *Expenses* and select **Create table**.
3. On the **Schema** tab, select **Add column** for each column, then **Save changes**:

| Name | Type | Required |
|---|---|---|
| Title | Text | yes |
| Amount | Number | yes |
| Status | Text | |
| Approver | Text | |

Column keys are made from the names (\`title\`, \`amount\`, \`status\`, \`approver\`). The **Rows** tab shows the data, and **Access** sets who can see and change it.

::image data-table | A data table with rows | A data table: rows, schema and access.

## 2. Save a row from a workflow

In your workflow, after the trigger, add a **Data** step:

1. **Data table:** *Expenses*. Operation: **Insert**.
2. Map the columns: **Title** = \`{{form.title}}\`, **Amount** = \`{{form.amount}}\`, **Status** = *Pending*.
3. The new row's id is saved as \`{{row_id}}\`.

Later in the workflow, add another **Data** step with **Update**, find the row by **Row ID** \`{{row_id}}\`, and set **Status** to \`{{outcome}}\`.

\`\`\`json title="Data step: insert"
{
  "table_id": "<table-id>",
  "table_name": "Expenses",
  "operation": "insert",
  "column_values": { "title": "{{form.title}}", "amount": "{{form.amount}}", "status": "Pending" },
  "output_row_id_var": "row_id"
}
\`\`\`

**List** reads several rows with filters (for example *Status* **Equals** *Pending*) into \`{{rows}}\` and \`{{row_count}}\`. **Get** reads one row into \`{{row}}\`.

## 3. Ask the Agent to add sample rows (optional)

To try things out, let the built-in Agent fill the table for you. On the *Expenses* table, open the **Agent** panel and ask:

> Add 8 sample expense claims to this table with realistic titles and amounts between 50 and 9000. Set status to Pending.

The Agent shows a preview of the first rows and the count. Select **Confirm** to add them. Later you can ask *"Delete the sample rows"*: it lists the rows and asks you to confirm with a red **Delete N rows** button (over 25 rows, you also type *delete N*). You need **Manage rows** on the table. See [Using the Agent](/docs/ai-assistants/using#add-edit-and-delete-data-table-rows).

## 4. Build a decision table

1. Go to **Govern › Business rules** and select **New decision table**. Name it *Approval policy*.
2. Under **Inputs**, select **Add input**: key \`amount\`, type **Number**.
3. Under **Outputs**, add \`approver\` (**Text**) and \`needs_cfo\` (**Boolean**).
4. Under **Rules**, select **Add rule** for each row. Rules run top to bottom, and the first enabled rule whose conditions all match wins:

| Rule | Condition | approver | needs_cfo |
|---|---|---|---|
| Small | amount **Less than** 500 | team-lead | false |
| Medium | amount **Less than** 5000 | manager | false |
| Large | *(no conditions: catches everything else)* | cfo | true |

5. Select **Test rules**, enter an amount of 7500, and check that *Large* matches. Then **Save**.

::image decision-table | The decision table editor with inputs, outputs and rules | A decision table: inputs, outputs and first-match rules.

## 5. Use it in the workflow

1. Add a **Decision Table** step before the User Task. Choose **Approval policy**.
2. Map the input **amount** to \`{{form.amount}}\`.
3. The outputs become variables: \`{{approver}}\`, \`{{needs_cfo}}\`, and \`{{rule_label}}\` (the rule that matched). \`{{matched}}\` is false when no rule matched.
4. Use them downstream. For example, add a **Branch by Condition** on \`{{needs_cfo}}\` **is_true**, or save \`{{approver}}\` to the row's **Approver** column.

\`\`\`json title="Decision Table step"
{
  "decision_table_id": "<decision-table-id>",
  "decision_table_name": "Approval policy",
  "input_mappings": { "amount": "{{form.amount}}" }
}
\`\`\`

Changing the rules takes effect at once for every workflow that uses the table. There is no draft, so test with **Test rules** before you save.

## What you built

- A data table that every run writes to and updates.
- A first-match decision table with a catch-all rule, tested in the editor.
- A workflow step that sends values into the table and branches on its answer.

## Next steps

- [Data tables](/docs/data-tables) and [Decision tables](/docs/decision-tables).
- [Reports](/docs/reports): chart the rows in your table.
- The [Data](/docs/workflows/nodes) and **Decision Table** steps in the node reference.
`,
  },
  {
    slug: 'tutorials/migrate-infopath',
    title: 'Migrate an InfoPath form',
    description: 'Upload an InfoPath expense report (.xsn), check the analysis, import it as a UserTasks form with its line items, totals and rules, and finish what did not convert.',
    body: `
**Goal:** rebuild an InfoPath expense report (a repeating table of line items, a total and a few rules) as a UserTasks form. Reference: [Import InfoPath forms](/docs/tasks/import-infopath).

**You need:** **forms.edit**. For step 4's data table you also need **data.create** and **workflows.create**.

**Time:** 10 minutes.

## 1. Upload the template

1. Go to **Build › Forms** and select **Import → InfoPath form (.xsn)**.
2. Drop *Expense Report.xsn* on the box. If the file is over 4 MB, export the source files from InfoPath Designer, zip them and upload the .zip instead.

UserTasks unpacks the template and reads its views, data source, rules and validation. Nothing is stored.

## 2. Read the review

- **Views → forms** shows *1 → 1*: the form has one view.
- **Fields** includes *1 repeating → Lists*. The *Line items* table becomes a List with Date, Description, Category, Qty, Unit price and a calculated Line total (\`quantity * unit_price\`).
- **Rules converted** shows *4 of 5*. Open **Full report** to see each one: the cost center rule, the large-report warning (over USD 5,000), the submit button and the *Manager* role check convert. A query of the *Projects* SharePoint list needs attention.
- The **Preview** shows the form as it will look.

## 3. Import

Leave **One form per view** selected, then select **Import** and **Open in the designer**.

## 4. Keep the submissions (optional)

Import again with **Create a data table for the submissions** ticked, and choose **Update the form made then** when asked. You get an *Expense Report submissions* table, a child table for the line items, and a draft workflow *Expense Report: save submissions*. Open the workflow in **Automations → Workflows**, check it, and publish it.

## 5. Finish what didn't convert

1. In the designer, open the **Rules** tab. Turned-off rules show what InfoPath did in their **Notes**.
2. *Refresh projects* queried a SharePoint list. Export the list from SharePoint as CSV or Excel and import it as a data table named **Projects** (**New table → Create from file**; see [Import from CSV or Excel](/docs/data-tables#import-from-csv-or-excel)), then import the form again: the rule becomes a **Table list** step. Or give the *Project* field options from the table.
3. *Managers see status* checks the InfoPath role *Manager*: it now reads \`user.roles contains "Manager"\`. Create a workspace role called **Manager** (Settings → Roles) and give it to the right people.
4. Select **Preview**, add two line items (for example 2 × USD 45.00 and 1 × USD 120.00) and check the total is USD 210.00.

## What you built

- A UserTasks form rebuilt from the InfoPath template: fields, a line-items List with a calculated column, a total, defaults and rules.
- Optionally, a submissions table, a line-items child table and a draft save workflow.
- A list of what still needs a person, with the original InfoPath expressions in the rules' notes.

## Next steps

- [Build an approval workflow](/docs/tutorials/approval-workflow) to send the report for approval.
- [Form rules](/docs/tasks/forms) for everything the Rules tab can do.
`,
  },
  {
    slug: 'tutorials/agent-build-form-and-workflow',
    title: 'Tutorial: use the Agent to build a form and workflow',
    description: 'Ask the built-in Agent to build a leave request form, then move to the workflow builder and have it build the approval workflow in the same conversation. Every change is confirmed first.',
    body: `
**Goal:** a *Leave request* form and its approval workflow, built by asking the Agent. You move from the form designer to the workflow builder and keep the same conversation.

**You need:** the Agent turned on in your workspace (see [Setting up the Agent](/docs/ai-assistants)), and the build permissions for what you ask it to make: **Edit forms**, **Create workflows** and **Edit workflows**. The Agent can only do what you can do.

**Time:** about 15 minutes.

## 1. Open the Agent in the forms library

1. Go to **Build › Forms**.
2. Select the **Agent** button (the sparkle) at the bottom-right of the screen. The **Agent** panel opens beside the page. The context chip under its title shows what the Agent is looking at, for example **Looking at: …**.

## 2. Ask for the form

Type:

> Create a form called "Leave request" with: leave type (Annual, Sick, Unpaid), start date and end date (required), and a reason that is required only for Unpaid leave.

The Agent shows a **confirmation card**: the form's name and the fields it will add, with any warnings. Nothing is saved yet. Read it, then select **Confirm**. (**Cancel** tells the Agent you said no.)

Forms have no draft. When you confirm a change to a form that is already in use, people filling it see the new version straight away. The card warns you when that applies.

## 3. Refine it in the designer

Open the new form in the designer. The Agent stays open and the conversation carries on. Try:

> Add a "Days requested" number field between the end date and the reason, minimum 0.5.

> Check this form for accessibility issues.

Confirm each change on its card. Save any changes you made by hand in the designer before you ask the Agent to change the same form.

## 4. Move to the workflow builder, same conversation

1. Go to **Build › Workflows** and open a workflow, or select **New workflow** to start an empty one.
2. The Agent panel stays open with your earlier messages, and a **Now on …** divider marks the move. The context chip now reads, for example, **Looking at: Workflow “Leave request approval”**.

Ask:

> Build the approval workflow for the Leave request form we just made: start when it is submitted, assign a task to the requester's manager with Approve and Reject outcomes, and email the requester the decision.

Because a workflow is open, the Agent asks first: *Build it in “…” (the workflow you have open), or create a new workflow?* Choose **Use the open workflow** or **Create a new workflow**. (If you had said "here", "this workflow" or "a new one", it would not ask.)

The card lists the steps it will add. Select **Confirm**. The workflow is saved as a **draft**: a new workflow is inactive, and an existing one keeps running its published version. Nothing changes for live runs until you publish.

After that, "this" and "it" mean the open workflow: *Add a reminder to the approval task after one day* changes this workflow.

> [!TIP]
> You can also ask for a different kind of item from where you are. In the workflow builder, *Create a feedback form for this workflow's requesters* makes the Agent offer to create the form and link it. It still shows a card before it changes anything.

## 5. Build from a file (optional)

Have a paper version of the form, or a sketch of the process? Attach it in the Agent panel (the paperclip **Attach files**, drag-and-drop, or paste a screenshot) and ask *"Build a form from this"* or *"Turn this into the approval workflow"*. The Agent asks whether to use the open item or a new one, and shows a confirmation card as before. Reading images needs a model that supports vision.

## 6. Review, test and publish it yourself

1. Read the workflow in the builder. Ask the Agent *Explain what this workflow does* or *Check this workflow for problems*.
2. Select **Save & test** and run a test case (see [step 8 of the approval tutorial](/docs/tutorials/approval-workflow#8-save--test)).
3. When you are happy, select **Publish**. The Agent never publishes, runs or deletes anything.

## 7. When a test fails

If a test step fails, select **Ask Agent to fix** next to the error. The Agent already knows the workflow from your conversation. It explains what went wrong (say, a start date that arrives as text where a date is needed) and proposes a fix on a card, such as adding a **Format Date** step or changing the field type. Select **Confirm**, then **Re-run test** to run the same inputs again.

## What you built

- A form and an approval workflow, from three or four plain-language requests.
- Each change reviewed on a confirmation card before it was saved.
- One conversation that followed you from the form designer to the workflow builder.

## Tips

- Be specific: name the fields, outcomes and who approves.
- Ask it to explain before you ask it to change.
- **New conversation** clears the history when you start something unrelated. The history is kept in this browser only, and is cleared when you sign out.

## Next steps

- [Using the Agent](/docs/ai-assistants/using): what it can do on each screen, with more example prompts.
- [Build an approval workflow](/docs/tutorials/approval-workflow) by hand, to understand each step it made.
`,
  },
  {
    slug: 'tutorials/agent-build-from-process',
    title: 'Tutorial: build a complete process from a document with the Agent',
    description: 'Give the Agent a written leave request procedure, review its build plan of tables, forms, admin forms, a decision table, a workflow and reports, package it, then build everything as drafts in one step.',
    body: `
**Goal:** a complete leave request solution, built by the Agent from a written procedure: a table of requests, a leave types configuration table with its admin form, a start form, approval task forms, a decision table, the workflow that links them, and a report, all in one package you can remove in one go.

**You need:** the Agent turned on in your workspace (see [Setting up the Agent](/docs/ai-assistants)), and permission to create what the plan contains: **Create tables**, **Edit forms**, **Create workflows** and **Edit workflows**. Owner, Admin and Manager have them. Items you can't create are marked **Skipped** on the plan.

**Time:** about 15 minutes.

## 1. Have the process ready

Any written or drawn process works: a Word or PDF procedure, a text file, a flowchart, or a photo of a whiteboard. For this tutorial, paste this text:

> **Leave requests.** An employee requests leave with the leave type (Annual, Sick or Unpaid), start and end dates, and a reason. Their manager approves or rejects it. Requests longer than 10 days also need HR approval. The employee is emailed the decision. HR wants a monthly report of approved leave by type.

## 2. Ask the Agent to build it

1. On **Home**, select **Build from a process with Agent**. (Or open the **Agent** button on any screen; it is on every screen.)
2. Paste the text above, or attach the document, and type *"Build this process."*
3. If the Agent asks **Just a form** or **A full solution**, choose **A full solution**.
4. The Agent asks *Package the solution?* Choose **Package this solution**. A package lets you remove everything in one go, keep versions and share it (see [Package a solution](/docs/ai-assistants/using#package-a-solution)).

## 3. Review the build plan

The Agent answers with a **build plan** card, titled **Build plan: …**, grouped by section. For this example it lists something like:

| Section | Item | What it is |
|---|---|---|
| Data model | Configuration table *Leave types* | Annual, Sick, Unpaid (admins can add more) |
| Data model | Main table *Leave requests* | Reference, employee, leave type (lookup to *Leave types*), start date, end date, days, reason, status |
| Forms | Application form *Leave request* | The fields the employee fills in; leave type is a lookup |
| Forms | Task forms | *Manager approval* and *HR approval*, showing the request (prefilled) with a comment box |
| Forms | Admin form *Manage leave types* | An editable grid on *Leave types*; **Save** writes the changes back |
| Rules | Decision table *Leave approval policy* | Days over 10 → HR approval needed |
| Workflows | *Leave request approval* | Starts from the form, saves the row, asks the manager, checks the policy, asks HR if needed, updates the status, emails the employee |
| Reports | *Leave requests* | Charts by status, by leave type and by month |
| Package | *Leave requests* | Every item above, version 1.0.0 |

The plan also shows how the items link: which form starts the workflow, which table it writes to and which decision table it calls. Each task lists its assignee and *redirect allowed*. Anything you lack permission for is marked **Skipped**.

A process with lines (a purchase request with line items, an expense claim with receipts) also gets a **child table** linked to the main table. On the application form the lines are a **List** field: inputs for one line (*Item*, *Quantity*, *Unit price*), an **Add item** button and an *Add row to list* rule that moves the inputs into the list below, with a calculated line total and a total underneath (see [List fields](/docs/tasks/forms#list-fields-repeating-rows)). The workflow saves the request, then loops over \`{{form.line_items}}\` and adds one child row per line with \`{{item.item}}\`, \`{{item.quantity}}\` and the request's id.

## 4. Adjust it in chat

Ask for changes before anything is made, for example:

- *Add a "Cover arranged by" person field to the start form.*
- *Make the HR threshold 15 days.*
- *Skip the report for now.*
- *Skip the admin forms.*

The Agent shows an updated plan each time.

## 5. Build all

Select **Build all**. The Agent creates the items in order (tables, forms, the decision table, the workflow, the report, then the package) and wires them together. The card shows each item's progress and a link to open it.

The summary links to the package. Under **Packages → Installed**, expand it to see every item it owns. **Uninstall** removes the whole solution, and shows exactly what it will remove first.

Everything is a draft. The workflow is saved inactive, so nothing runs yet.

If an item fails (for example a name already taken), the Agent stops and lists what it has already created. It offers to fix the failed item and continue; you confirm the remaining items again.

## 6. Check, test and publish

1. Open the workflow from its link. Ask the Agent *"Explain what this workflow does"* to check it matches the procedure.
2. Open the decision table and select **Test rules** with 12 days and 20 days.
3. In the workflow, select **Save & test** and run a test case for each path (see [step 8 of the approval tutorial](/docs/tutorials/approval-workflow#8-save--test)).
4. When you are happy, select **Publish**. Then share the start form's link (see [step 9 of the first form tutorial](/docs/tutorials/first-form#9-share-it)).

## What you built

- A full leave request solution (table, forms, decision table, workflow and report) from one paragraph of text.
- A plan you reviewed and changed before anything was created.
- An admin form, so your admins maintain the leave types without editing the table.
- One package that holds it all: remove it in one go, build new versions, or share it to the community gallery (the Agent can submit it for review).
- Drafts that you tested and published yourself.

## Next steps

- [Using the Agent](/docs/ai-assistants/using#build-a-complete-process-from-a-document): the build plan and what it can make.
- [Build an approval workflow](/docs/tutorials/approval-workflow) and [Data tables and decision tables](/docs/tutorials/data-and-decision-tables): how each built item works, so you can change it by hand.
`,
  },
]
