import type { DocPageDef } from '../types'

export const GETTING_STARTED_PAGES: DocPageDef[] = [
  {
    slug: 'quickstart/cloud',
    title: 'Quickstart: cloud',
    description: 'Sign in to the hosted edition, build and run a first workflow, and drive it from the CLI.',
    body: `
The cloud edition at usertasks.com runs the same open-source code as a self-hosted install, operated for you. This page takes you from sign-in to a running workflow in about ten minutes.

## 1. Sign in

Open [/login](/login) and sign in with your workspace slug, email and password, or with the invitation link you were sent. New to UserTasks and want a hosted workspace? [Contact us](/contact).

The first time a workspace owner signs in, \`/onboarding\` asks for the organisation profile (name, URL identifier, industry and size).

## The getting-started guide

The first time you sign in to a new workspace, a short guide opens: a welcome, then a checklist of the things worth doing first. Each item has a button that takes you there and **Show me**, a spotlight tour that highlights the real buttons on the page step by step (→ / ← to move, Esc to leave). On a phone the checklist is a bottom sheet and **How to** lists the steps instead.

| Item | Done when |
|------|-----------|
| Set up the Agent (Settings → Agent: add an AI provider key, then turn it on) | The Agent is available to you |
| Browse the Gallery (ready-made solutions) | Any package is installed |
| Make it yours: theme and logo (Settings → General) | A logo is uploaded or the theme is changed |
| Invite your team (Settings → Members & invites) | An invitation was sent, or there is more than one member |
| Set up single sign-on (Settings → SSO & directory) | A directory (Entra ID, Okta, Google, LDAP or SCIM) is connected |
| Build your first form or workflow (the form wizard, or **Build from a process with Agent**) | A form or workflow exists that isn't from a package or the self-test |
| Optional: run the platform self-test, read the [tutorials](/docs/tutorials) | The self-test workflow is installed; you opened the tutorials |

You only see what your role lets you do. With the Agent on, **Ask the Agent to set this up for you** opens it with the remaining items as a starter prompt.

- **Remind me later** closes it; it comes back the next day, and the **Getting started** launcher in the side menu shows your progress meanwhile.
- **Close** (or Esc) hides it for this session only.
- **Don't show again** stops it opening by itself. **Help → Getting started** (the avatar menu) opens it any time, and you can turn it back on from there.
- When everything is done you get a small celebration and the launcher goes away.

Your choices are saved to your account for each workspace, so they follow you between devices. Admins see this guide for a workspace's first 30 days. People who join later get a shorter checklist (find your tasks, fill in a form, meet the Agent, set your preferences) for their first 30 days; turn that off under **Settings → General → Getting started guide**. **Help → Send feedback** sends a note straight to the UserTasks team, with your workspace attached.

## 2. Build a workflow

1. Go to **Build › Workflows → New workflow**.
2. Pick a trigger. **Webhook** is the easiest to test: it gives you a URL you can POST to.
3. Drag nodes from the palette onto the canvas and connect them. Click a node to open its settings panel.
4. Click **Save & test** to save the draft and run it with test inputs, step by step.
5. Click **Publish**. Runs always use the published version; you can keep editing the draft.

::image designer | The workflow designer with the settings panel open on a User Task node | An invoice approval workflow: an integration call, a decision table, a user task with typed fields and an email.

## 3. Run it and watch it

Start the workflow from the designer, by calling its webhook, or from the API. Open the workflow's **⋯ → View runs** to follow each run step by step; a run that reaches a User Task waits until someone completes the task in **Tasks**.

## 4. Do the same from a terminal

The CLI needs Node.js 20 or later (22 LTS recommended). \`usertasks login\` opens your browser and logs in to \`http://localhost:3000\`.

\`\`\`bash
npm install -g @user-tasks/cli
usertasks login
usertasks workflows list
usertasks workflows start --set workflow_id=<id> --set variables:='{"amount": 1200}'
usertasks logs tail --category workflow
\`\`\`

Without \`--url\` the CLI talks to a local install at \`http://localhost:3000\`. For another server, add \`--url\`, for example \`usertasks login --url https://tasks.example.com\` or \`--url https://usertasks.com\` for the cloud.

## Next steps

- [Tutorials](/docs/tutorials): build a form, a [form with the wizard](/docs/tutorials/first-form-wizard), an approval workflow, an AI agent and an integration, step by step.
- Not a designer? [Build a form with the wizard](/docs/tasks/form-wizard) makes a form, its responses table and a results page in a few steps.
- [Concepts](/docs/concepts): workflows, runs, tasks and the asset types around them.
- [Workflows](/docs/workflows): the designer, triggers and the [node reference](/docs/workflows/nodes).
- [CLI](/docs/cli) and [API](/docs/api): automate everything you just did by hand.
- [Ship logs](/docs/observability) to Splunk, Datadog, OpenTelemetry or a webhook.
`,
  },
  {
    slug: 'quickstart/self-host',
    title: 'Quickstart: self-host',
    description: 'Run UserTasks on your own machine with Supabase, create your admin account at /setup and sign in.',
    body: `
UserTasks is a Next.js application backed by Supabase (Postgres, Auth, Storage, Vault, pg_cron and pg_net). You run the app; Supabase can be hosted on supabase.com or self-hosted. This page gets a local install running. For production, read [Self-hosting](/docs/self-hosting).

> [!TIP]
> Every install starts on Supabase with no provider settings. Supabase is an excellent platform and our recommended way to run UserTasks. If you'd like files, email, secrets, sign-in or the database in AWS, Azure, Google Cloud or your own network, you can move one area at a time with \`usertasks-admin switch\` whenever you're ready. See [Choose your topology](/docs/topologies).

New to the terminal? [Quick start on your computer (beginner)](/docs/self-hosting/quick-start) walks through every step, from installing Git, Node.js and Docker Desktop.

## Requirements

- Git, and Node.js 22 LTS (recommended; 20.9 or later works)
- Docker (for a local Supabase stack), or a Supabase project

## 1. Database and configuration

\`\`\`bash
git clone <repository-url> usertasks && cd usertasks
npm run setup:local
\`\`\`

\`npm run setup:local\` runs \`npm install\`, starts the local Supabase in Docker (applying \`supabase/migrations\` to a new database, or only the new migrations to an existing one), writes \`.env.local\` with the local URL and keys plus fresh \`ENCRYPTION_KEY\` and \`CRON_SECRET\` values, and sets up the background-job secrets of step 5 in the local Vault. It never overwrites values already in \`.env.local\` and is safe to run again. Works in PowerShell, cmd, bash and zsh.

## 2. Configuration by hand (optional)

Using a hosted Supabase project, or prefer to do it yourself? Apply the migrations (\`npx supabase link --project-ref <ref> && npx supabase db push --linked\`, or \`npx supabase start\` for a local stack) and:

\`\`\`bash
cp .env.example .env.local
\`\`\`

Fill in at least \`NEXT_PUBLIC_SUPABASE_URL\`, \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`, \`SUPABASE_SERVICE_ROLE_KEY\` (a local stack prints them with \`npx supabase status -o env\`), \`NEXT_PUBLIC_APP_URL\`, \`CRON_SECRET\` (\`openssl rand -hex 32\`) and \`ENCRYPTION_KEY\` (\`openssl rand -base64 32\`). Every variable is described in [Environment variables](/docs/self-hosting/environment).

## 3. Run

\`\`\`bash
npm run dev
\`\`\`

Or, for a production build:

\`\`\`bash
npm run build && npm start
\`\`\`

## 4. Create your admin account

Self-signup is off in self-hosted mode. Instead, open http://localhost:3000: while the install has no workspace yet, you're sent to the **Create your admin account** screen at \`/setup\`. It asks for:

- the organisation name (the slug made from it is what you type on the login page)
- your name, email and password
- the **setup code**

The setup code is printed in the terminal running \`npm run dev\`:

\`\`\`text
UserTasks setup code: ABCD-EFGH-JKLM (open /setup to create the admin account)
\`\`\`

You're signed in and taken to \`/onboarding\`. Invite more people from **Settings → Members & invites**. [Create your admin account](/docs/self-hosting/admin-account) explains the setup code, including how to make a new one.

Prefer the command line? This creates the workspace and owner without \`/setup\` and prints the workspace slug. Run it in the UserTasks folder: it reads \`.env.local\` by itself (variables set in your shell win), in bash, zsh, PowerShell or cmd alike:

\`\`\`bash
npm run bootstrap -- --email admin@example.com --password 'a-strong-password' --org "Acme Inc"
\`\`\`

## 5. Turn on background work

Schedules, the run queue, SLAs, reminders, log shipping and sync jobs run when pg_cron calls the app. \`npm run setup:local\` does this for a local stack. Otherwise add two Vault secrets (the URL must be reachable from the database; for a local stack use \`http://host.docker.internal:3000\`):

\`\`\`sql
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret', 'Bearer secret for usertasks cron endpoints');
select vault.create_secret('http://host.docker.internal:3000', 'app_base_url', 'Public base URL of the UserTasks app');
\`\`\`

> [!NOTE]
> Without these secrets, synchronous runs, tasks and the API still work, but scheduled triggers, delays, queued runs and log export wait until something calls the processor.

## Docker

Copy the example file, fill in \`.env\`, then start the stack:

\`\`\`bash
cp .env.example .env
docker compose up --build
\`\`\`

The image runs the app only; the database stays in Supabase. Read the setup code with \`docker compose logs app | grep "setup code"\`. See [Self-hosting](/docs/self-hosting#docker) for build arguments and optional database drivers, and [Install step by step](/docs/self-hosting/install) for every other way to run it, Supabase-free ones included.
`,
  },
  {
    slug: 'home',
    title: 'Home',
    description: 'Your start page after signing in: four cards that chart your tasks, decisions, submissions and the processes you follow, one list for your tasks (queued ones included), the processes you follow, the forms you submitted and your favourite forms, and your activity charts, arranged the way you like.',
    body: `
**Home** (\`/home\`) is the first item in the side menu and the page you land on after signing in. It answers three questions: what do I have to do, what have I asked for, and where is it now?

::image home-submissions | Home: the four cards and the My submissions tab with a waiting process | My submissions: the form, the process it started, where it is now and who has it.

By default Home shows, top to bottom:

1. the four cards (**My tasks**, **My decisions**, **My submissions**, **Following**), a quarter of the width each, each with a small chart (see [The cards](#the-cards));
2. the list (**My tasks**, **Following**, **My submissions**, **Favourite forms**), full width;
3. the other **My activity** charts: **Tasks completed** and **Time to complete** side by side, then **Processes I work in most**;
4. **Drafts**.

The page header greets you ("Good afternoon, Ada") and shows today's date and the time zone your activity days follow.

You can rearrange, resize and hide all of these. See [Customise your Home](#customise-your-home).

## The cards

| Card | Big number | Chart | Underneath |
|---|---|---|---|
| **My tasks** | open tasks assigned to you, with **overdue** and **past SLA** chips | tasks completed per day (a small column chart) and the **on-time** meter: on time against late, with the share | completed in the period, queued for you |
| **My decisions** | approval rate ("53% approved") | your outcomes as one stacked bar: Approved, Rejected, Sent back and your workflows' own labels | decisions in the period |
| **My submissions** | forms you submitted whose process is still running or waiting | the forms you submitted in the period, by the status of the process each started: completed, in progress, failed, cancelled | submitted in the period, median end-to-end time |
| **Following** | processes you follow that are still active, with an **updated today** chip | active against finished | followed in total, updated today |

Select a card's number to open its tab in the list (My decisions has no tab). The big numbers are counts right now; the charts follow the period in Home's header. Each card loads on its own, so a slow one never holds up the rest.

Select the chevron (⌄) at the top right of a card to **expand** it: it grows to show the full legend, a table of the same numbers and its notes, such as the tasks you completed without a decision. Select it again to collapse it. Home remembers which cards you expanded, in this browser. The chevron is a button that says whether the details are shown, and screen readers can tell which details it controls. In edit mode the cards show collapsed, and their collapsed size is also the smallest you can make them.

## The list

Click a task in **My tasks** (or press Enter or Space on its title) to expand it in place. It shows the task's description, up to six of its filled-in fields and its subtasks, each with its status, assignee, due date and progress, and a link to it. The details load when you open the row. The form button at the end of each row (**Open task form**) goes straight to the task's form.

## My activity

**My activity** charts your own work in the workspace you're in: the charts on the cards, and three chart widgets below the list. Pick **7 days**, **30 days** or **90 days** in Home's header, next to **Edit layout**. The choice applies to every chart and Home remembers it in this browser. The header also says which time zone the days follow.

::image home-activity | My activity: tasks completed, time to complete and the processes you work in most | My activity over 30 days.

| Chart | Headline | What it shows |
|---|---|---|
| **Tasks completed** | tasks completed in the period | completed tasks per day (7 and 30 days) or per week (90 days, weeks start on Monday), plus your busiest day or week |
| **My decisions** (card) | approval rate ("53% approved") | your outcomes split into Approved, Rejected, Sent back and your workflows' own outcome labels |
| **Time to complete** | median time from assigned to completed, with the p90 | median and p90 for each day or week, plus **time to pick up** when tasks had to be accepted or claimed |
| **On time** (on the My tasks card) | share completed by the deadline | on time against late |
| **Processes I work in most** | the top process's share of your tasks | the five workflows most of your completed tasks came from |
| **My submissions** (card) | forms you submitted | the status of the process each one started, and the median time from submitting to that process completing |

Each chart has a tooltip on hover or keyboard focus, an **(i)** that explains how it's measured, and a **Table** button that shows the same numbers as a table (on the cards, the table is part of their details). Screen readers get a one-sentence summary of each chart. Numbers use your browser's locale. Durations read like "2 h 15 m" or "3 days". The series colours come from your workspace theme: its brand colour, chart colours and success, warning and danger colours. Home checks at runtime that neighbouring colours can be told apart, including with colour-vision deficiency. When a theme's colours are too close, Home uses a tested fallback palette instead.

### How the numbers are worked out

- **Your tasks** are completed tasks, not deleted, completed in the period, that are either:
  - assigned to you;
  - team or shared tasks with no single assignee that you responded to.

  A task a manager completed on your behalf still counts as yours.
- **Days** run from midnight to midnight in your browser's time zone. The page says which zone it used. From the API, use \`timezone\`. Without it, your profile's time zone is used, then UTC. The period starts at midnight 6, 29 or 89 days ago and runs to now.
- **Your outcome** is the one you chose. On a shared task that is your own response, not the final result.
- **Decisions and approval rate.** Outcomes are matched on whole words, ignoring case. Reject-like words are checked first, so "Disapprove" and "Not approved" count as rejections.

  | Counts as | Outcome labels |
  |---|---|
  | **Rejected** | Reject, Decline, Deny / Denied, Refuse, Disapprove, Veto, Not approved, Unapproved, No, Fail |
  | **Approved** | Approve, Accept, Authorise / Authorize, Endorse, Grant, Sign off, Agree, Yes, Pass, Go ahead |
  | **Sent back** | Send back, Return, Request changes, Changes requested, Rework, Revise, More info, Need info |
  | **Its own label** | any other label, when the task offered two or more outcomes (for example "Escalate") |
  | **Not a decision** | Completed, Done, Submit(ted), Finish(ed), Close(d), Acknowledge(d), Noted, OK, Save(d); and any label on a task that offered one outcome or none |

  **Approval rate = Approved ÷ all decisions** (Approved, Rejected, Sent back and the tasks' own labels). Tasks that aren't decisions are listed under the chart but left out of the rate. The bar shows the five largest groups. Any other labels are combined into **Other decisions**, and so is a label whose colour couldn't be told apart from the others.
- **Time to complete** runs from when the task was assigned to you to when it was completed. "Assigned" is when the task was created, or its last reassignment, redirection, delegation or escalation before it was completed. **Median**: half of your tasks took less time. **p90**: nine in ten took less.
- **Time to pick up** runs from assigned to when you accepted or claimed the task. It only covers tasks that had to be accepted or claimed.
- **On time** means completed on or before the task's due date. A task with no due date uses its process's SLA due time. Tasks with neither are left out, and the chart says how many.
- **My submissions** counts forms you submitted in the period, but not task forms. Each submission takes the status of the process it started: a running one if there is one, otherwise the latest. End-to-end time runs from submitting to that process completing, for completed ones only.

## Counts in the side menu

**My tasks** and **Task tracker** show a number when something is waiting, for example **My tasks 4**:

| Menu item | The number |
|---|---|
| **My tasks** | your open tasks, queued ones included: the **My tasks** card's open tasks plus those *queued for you* (waiting for you to accept them, and unassigned tasks of your teams) |
| **Task tracker** | open tasks you assigned to someone else: what its default view (**Assigned by me**) lists, without the completed and cancelled ones |

- At 0 there is no badge, and large numbers show as **99+**.
- With the side menu collapsed, a dot on the icon shows that something is waiting. Hover over it to see the count.
- On a phone, the counts are in the menu drawer, and the **Tasks** tab shows the My tasks count.
- Screen readers hear the label and the count, for example "My tasks, 4 pending".
- The counts come from one small read. They refresh when you come back to the tab, every minute, and straight away when you complete, claim or accept a task, or when one of your tasks changes.

## Favourite forms

Star a form (☆) in the **Forms** menu or in **Build › Forms**, or use the heart (♡) at the top right of the form's own page, and it appears in the **Favourite forms** tab of the list, next to **My submissions**. Each row shows the form's name and description, an **Open** button that opens the form to fill in (\`/f/<id>\`), and a star to remove it from your favourites. Favourites are personal and alphabetical. With more than ten, the tab has a search box. With none, it explains how to star a form. If you can no longer open a favourite (you lost the right to submit forms in the workspace), it is hidden, and it comes back if your access does.

**Drafts** is its own widget, at the end of Home. It lists the forms where you used **Save draft** and haven't submitted yet, newest first, with the time you saved each one. Click one to go back to the form, which offers to resume your draft. When you have no drafts, the widget takes up no space (in edit mode it shows a placeholder). See [Favourite and Save draft icons](/docs/tasks/forms#favourite-and-save-draft-icons).

## The list

One list with four tabs. Home remembers the last tab you used. Every tab has a search box (Favourite forms once you have more than ten), sorts sensibly, pages 25 rows at a time, and stacks each row on a phone.

- **My tasks**: open tasks for you, with the **process** (workflow), the **stage** (the step's name), the status, the due date or SLA, priority and when it reached you. Soonest due first; sort by priority or newest instead. Tasks waiting for your response show the status **Queued**: tasks sent to you for acceptance (and collaborative invitations) have **Accept** and **Decline**, and unassigned tasks of a team you belong to have **Claim**. Claiming makes you its assignee, and only you can complete it from then on; if someone else claims it first, you're told so. Whether a new task is queued or added straight to your list follows your [task queue rules](/docs/tasks#task-queue-rules). A Home tab saved as the old **Task queue** opens **My tasks**.
- **Following**: processes you follow, active first. Each row shows the current stage, status, start and update dates, and the people it is with. Use **Process view** or **Unfollow**. **Auto-follow processes I start** is on by default: every process you start, including the ones your form submissions start, is followed for you. Turn it off to follow by hand. Processes you already follow stay followed.
- **My submissions**: every form you submitted, newest first. Each row shows the process it started, its status (*Starting*, *Running*, *Waiting*, *Completed*, *Failed*, *Cancelled*), the current stage, the people involved and the last update. Each row has three actions:
  - **View submission** (👁) shows the values you sent, read-only.
  - **Process view** appears only when the form started a process.
  - **Follow / Unfollow** adds or removes the process in **Following**.

  Task-form answers are task completions, so they appear under your tasks, not here.
- **Favourite forms**: the forms you starred, with **Open**. See [Favourite forms](#favourite-forms).

### View stage

The stage name in **Following** and **My submissions** is a button. It shows who the step is with (a person, the team, or "an automatic step"), since when, and when it is due.

## Customise your Home

Select **Edit layout** at the top right of Home. Every card, the list, each chart and **Drafts** is a widget on a 12-column grid. Each widget gets a dashed outline, a handle with its name and size (columns × rows), a hide button and a resize corner.

::image home-layout | Home in edit mode: dashed outlines, a handle with each widget's name and size, hide buttons and resize corners | Edit layout: drag by the handle, resize from an edge or the corner, hide, add back or reset.

- **Move:** drag a widget by its handle. The other widgets make room as you drag. Widgets fill each row from left to right, in your order. Make widgets narrower or wider to change how many fit on a row, for example three cards at 4 columns each.
- **Resize:** drag a widget's right edge (width), bottom edge (height) or corner button (both). Sizes snap to the grid. Each widget has a smallest and largest size, for example the list is at least 4 columns wide and the cards are at most 6.
- **Hide:** select the eye button on the widget. **Add widget** lists everything you've hidden, grouped into cards, lists and charts. A widget you add back returns to its default place and size.
- **Reset to default** puts back the default order and sizes and shows every widget.
- **Done** saves your layout. **Cancel** throws your changes away.

Outside edit mode nothing can be dragged, so clicking and scrolling on Home work as usual. While you edit, the widgets' own buttons and links are switched off.

### Keyboard

| Keys (on a widget's handle) | What happens |
|---|---|
| **←** / **↑** | Move one place earlier |
| **→** / **↓** | Move one place later |
| **Home** / **End** | Move to the start / the end |
| **Shift** + **←** / **→** | One column narrower / wider |
| **Shift** + **↑** / **↓** | One row shorter / taller |

The corner button takes the plain arrow keys for resizing. Each change is announced to screen readers, for example "Task list moved to position 3 of 12" or "Task list: 8 of 12 columns wide, 14 rows tall". All edit controls are real buttons.

### On phones and tablets

Home saves one layout, sized for desktop, and adapts it to the width available:

- **Desktop** (Home at least 900 px wide): 12 columns, as you arranged it.
- **Tablet** (560 to 899 px): 6 columns. Each widget takes half its desktop width, but never less than it needs to stay readable.
- **Phone**: one column, in your order. In edit mode on a phone you can reorder and hide widgets, but not resize them.

Charts redraw to fit when you resize them. The list stacks each row's details when its widget is narrow.

### Where it's saved

Your layout is saved to your account, separately for each workspace, so it follows you to other browsers and devices. Nobody else can see or change it. If you never customise Home, or you reset it, you get the default. Future default changes then reach you too. Widgets added in a later release appear in their default place in a saved layout, and widgets that are removed drop out of it. For example, the old **Favourite forms** widget is now a tab of the list, so it drops out of saved layouts and everything else stays where you put it. When Home's default layout changes and you have a saved one, Home shows a one-time note with **Try the new default**. It opens edit mode with the new default, so you can select **Done** to keep it or **Cancel** to go back to yours.

## Process view

**Process view** opens the process's diagram as the designer drew it. Finished steps are green, the step it is on now pulses, and steps it hasn't reached are grey. Above the diagram, **Now** says who has the current step and since when. **Steps so far** lists each task with its assignee and dates. Click a step to see its status and who handled it.

::image home-view-flow | Process view: the process diagram with the current step highlighted and who has it | Process view, as the person who submitted the form sees it.

This view is safe to give anyone who submitted the form, even without permission to see workflows. It shows step names, statuses, assignees and dates only. It never shows step settings, outputs, errors, variables, or anyone's form values. People who can view workflow runs also get **Full run view**.

### Who has each step, and what happened

Each User Task step shows who it is with: their avatar and name, or the team for an unclaimed team task, or **Unassigned**. When several people share a task it reads "Priya Nair +2"; point at it to see everyone and where each of them is (Queued, In progress, On hold, Done, Declined). The diagram shows the same small badge above each task step, and **Steps so far** lists every step with its history:

- who responded and when (point at the time for the exact date), with "on behalf of Ana" when a manager or a manager of the workflow acted for the assignee;
- the outcome (Approved, Declined, Ask for changes, or the step's own outcome), in the outcome's colour;
- the comment or reason (long ones are cut short, select **More**);
- redirects, reassignments and escalations ("Redirected from Tom to Priya").

A step with several responses lists every one. Outcomes, comments and the redirect lines are only shown to people who can open that task (see below). Everyone else who can see the process sees who completed each step and when.

### Open the waiting task

When the process is waiting at a User Task, a small form icon appears next to the step: in **Now**, on the diagram, in **Steps so far**, and in the **Waiting at: {step} · {name}** chip at the top. Point at it to see the task and who it is assigned to. Select it to open the task, on its **Form** tab when it has a form. The icon only appears when you may open that task:

| You are | Icon | On the task page |
|---|---|---|
| The assignee, a collaborator, a claim candidate, or a member of the team an unclaimed task is with | Yes | Do the task yourself |
| A manager of an assignee (direct or further up the reporting line) | Yes | **Acting on behalf of {name}**: give a reason, then act. It's recorded as done by you on their behalf, and they are notified |
| A manager of the workflow: an explicit **Edit** grant on the workflow (for you, your role or your team) | Yes | **Acting on behalf of {name}**, as above. The history and audit log record that you acted as a manager of the workflow |
| An admin with **View all tasks** (\`tasks.view_all\`) | Yes | Read-only, unless you also hold **Complete any task** (\`tasks.complete_any\`, break-glass) |
| The person who started the process (and nothing else) | No: **Waiting for {name}** | – |
| Anyone else who can see the run (for example a **View** grant on the workflow) | No: **Waiting for {name}** | – |

A **View** grant on a workflow lets you see its runs but not act on its tasks. Acting needs **Edit**. The task page and every task action check these rules again on the server.

## Who sees what

- You can see a process's progress, and follow it, when any of these is true:
  - you started it;
  - your form submission started it;
  - you have (or had) a task in it;
  - you can view workflow runs (\`workflows.view_runs\`).
- Anyone else gets "not available to you".
- You only ever see your own tasks, submissions, follows and favourites, and only in the workspace you're in.

## From the API, MCP and the CLI

| Task | REST | MCP | CLI |
|---|---|---|---|
| Card counts | \`GET /home/metrics\` | \`home_metrics\` | \`usertasks home metrics\` |
| My activity charts | \`GET /home/stats?period=30d\` | \`home_stats\` | \`usertasks home stats --period 30d\` |
| My tasks / queue | \`GET /home/tasks\`, \`GET /home/queue\` | \`home_tasks\`, \`home_queue\` | \`usertasks home tasks\`, \`usertasks home queue\` |
| Claim a team task | \`POST /tasks/{id}/claim\` | \`tasks_claim\` | \`usertasks tasks claim <id>\` |
| My submissions | \`GET /home/submissions\` | \`home_submissions\` | \`usertasks home submissions\` |
| A run's progress | \`GET /home/runs/{id}/progress\` | \`home_run_progress\` | \`usertasks home progress <id>\` |
| Following | \`GET /home/following\`, \`PUT\` / \`DELETE /home/following/{id}\` | \`home_following\`, \`home_follow\` | \`usertasks home following\`, \`home follow\`, \`home unfollow\` |
| Favourite forms | \`GET /home/favorite-forms\`, \`PUT\` / \`DELETE /home/favorite-forms/{id}\` | \`home_favorite_forms\`, \`home_favorite_form\` | \`usertasks home favorites\`, \`home favorite\`, \`home unfavorite\` |
| Auto-follow | \`GET\` / \`PATCH /home/preferences\` | \`home_preferences\` | \`usertasks home preferences\`, \`home set-preferences\` |
| Home layout | \`GET\` / \`PUT\` / \`DELETE /home/layout\` | \`home_layout\` | \`usertasks home layout\`, \`home set-layout -f layout.json\`, \`home reset-layout\` |

These are personal, so use a credential bound to a user. A tenant-wide API key gets 403.

A layout is \`{ items: [{ id, w, h }], hidden: [ids] }\`. \`items\` are the visible widgets in reading order, \`w\` is in columns of the 12-column grid and \`h\` is in rows of 40 px. The widget ids are \`metric.tasks\`, \`metric.submissions\`, \`metric.following\`, \`tasks\`, \`chart.completed\`, \`chart.decisions\`, \`chart.duration\`, \`chart.on_time\`, \`chart.top_processes\`, \`chart.submissions\`, \`favorites\` and \`drafts\`. \`PUT\` accepts known ids only, each at most once, in a body of at most 8 KB. It clamps sizes to each widget's limits, and puts any widget you leave out of both lists back in its default place. \`GET\` also returns \`customised\` and each widget's title and size limits.
`,
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    description: 'The building blocks of UserTasks — workflows, runs, tasks, integrations, rules, data — and how they fit together.',
    body: `
UserTasks is a **headless workflow engine**: it runs your processes and exposes everything through a REST API, an MCP server and a CLI, so your own applications and AI clients can drive it. It also ships a complete web app (designer, task list, settings) for the people who build and operate those processes.

## Workspaces

Everything belongs to a **workspace** (a tenant). Data is isolated per workspace by Postgres row-level security and server-side checks. People are members of one or more workspaces with **roles** that grant permissions. To switch workspace in the web app, open your **avatar menu** (top right): it lists **All organizations** and every workspace you belong to, with a tick by the current one; pick one to switch. The same menu has your profile, settings and **Sign out**.

## Workflows and runs

A **workflow** is a graph of nodes: one **trigger**, then logic, operations and actions joined by edges. You edit a **draft** and **publish** it; each publish creates an immutable **version**. A **run** is one execution of the published version. Runs carry **variables**, write a step-by-step log, and can **wait**: for a person (User Task), for a time (delay, pause until), or for an external event. Waiting runs are resumed from a durable **queue**.

## Tasks

A **task** is work for a person. User Task nodes create tasks with typed **fields** and **outcomes**; completing the task (in the app, through the API, MCP or CLI) resumes the run on the outcome's path. Tasks have assignees or teams, due dates, SLAs, reminders and escalation.

## Reusable assets

| Asset | What it is | Used from |
|---|---|---|
| [Integration](/docs/integrations) | A connection to an external system (base URL + authentication) | References |
| [Reference](/docs/integrations/references) | One saved operation on an integration (REST, OData or a database query) | Call API / Reference nodes, agents, reports, MCP |
| [Connector](/docs/integrations/connectors) | A pre-built integration for a known service | Integrations |
| [Decision table](/docs/decision-tables) | Ordered business rules: inputs in, outputs out | Decision Table node, API, MCP |
| [Data table](/docs/data-tables) | A typed table inside UserTasks | Data node, triggers, reports, OData |
| [Email template](/docs/email-templates) | Subject and HTML with variables | Send Email node, task notifications |
| [Custom workflow action](/docs/workflows/custom-actions) | Your own sandboxed code as a typed node with one or more functions | Custom actions in the palette, API, MCP, CLI |
| [AI agent](/docs/agents) | A model with instructions, tools and an output schema | Run Agent node, API, MCP |
| [Report](/docs/reports) | A saved query and chart over tasks, runs or data | App, API, MCP |

## Surfaces

Every operation is available four ways, and they enforce the same permissions:

- the **web app** for designers, approvers and admins;
- the **REST API** at \`/api/v1\` ([API](/docs/api)), described by an OpenAPI 3.1 document;
- the **MCP server** at \`/api/mcp\` ([MCP](/docs/mcp)) for AI assistants;
- the **CLI** \`usertasks\` ([CLI](/docs/cli)) and the TypeScript [SDK](/docs/sdk).

Configuration moves between workspaces as files: [config as code](/docs/config-as-code) and GitHub sync. Everything that happens is recorded in an [event stream](/docs/observability) you can tail or ship to your log platform.

## Common use cases

Worked examples with an architecture sketch, the features involved and a snippet ([all use cases](https://usertasks.com/use-cases)):

- [Headless task management](https://usertasks.com/use-cases/headless-task-management) — human tasks and approvals inside your own app, through the [Tasks API](/docs/tasks/api).
- [Approvals and compliance](https://usertasks.com/use-cases/approvals-and-compliance) — approval matrices in [decision tables](/docs/decision-tables), SLAs, escalation and audit.
- [AI agent orchestration](https://usertasks.com/use-cases/ai-agent-orchestration) — [agents](/docs/agents) as workflow steps with a person reviewing the result.
- [Middleware and integration hub](https://usertasks.com/use-cases/middleware-integration-hub) — [webhooks](/docs/integrations/webhooks) in, transforms, calls out, retries and log export.
- [Replacing SharePoint 2010 and 2013 workflows](https://usertasks.com/use-cases/sharepoint-workflow-replacement), and migration guides for [Nintex](https://usertasks.com/use-cases/nintex-migration) and [K2](https://usertasks.com/use-cases/k2-migration).
`,
  },
]
