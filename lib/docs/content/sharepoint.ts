import type { DocPageDef } from '../types'

/**
 * Docs for the SharePoint Server extension (paid): what it does and how it
 * behaves for site owners, list managers and farm administrators. These pages
 * describe behaviour only; the extension's source is private.
 */

export const SHAREPOINT_PAGES: DocPageDef[] = [
  {
    slug: 'sharepoint',
    title: 'SharePoint Server extension',
    description: 'Replace SharePoint 2010 and 2013 workflows and InfoPath forms on SharePoint Server 2016, 2019 and Subscription Edition: an add-in with list-event workflows, embedded forms and a dashboard per list.',
    body: `
The **SharePoint extension** connects UserTasks to SharePoint Server farms. It replaces the SharePoint 2010 and 2013 workflow engines and InfoPath Forms Services with UserTasks workflows and forms that run on your lists and libraries. Content stays in SharePoint.

> [!NOTE]
> Microsoft's notes for the November 10, 2026 Subscription Edition update ([KB5002945](https://support.microsoft.com/en-us/servicing/office/hotfix/sharepoint/5002945)) say the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition. Both reached end of support on July 14, 2026.

## What you get

- **A UserTasks button** on the ribbon and command bar of every list and library, plus a tile in Site Contents. The first click sets the list up; later clicks open [the list dashboard](/docs/sharepoint/list-dashboard).
- **Workflows that start from list events**: created, modified, deleted, renamed, attachments, approval status, new versions, check-in and more. See [trigger events](/docs/sharepoint/triggers).
- **Start by hand**: "Start a UserTasks workflow" on the item menu. See [manual start](/docs/sharepoint/manual-start).
- **Generated New, Edit and Display forms** that open inside the SharePoint page and replace the list's forms, or the InfoPath forms that took their place. See [list forms](/docs/sharepoint/forms).
- **Web parts** for classic pages: *UserTasks – My tasks* and *UserTasks – Form*. See [web parts](/docs/sharepoint/web-parts).
- **The SharePoint REST API as workflow steps**: items, files and folders, versions and approval, permissions, the recycle bin and the list's schema, also through the REST API, CLI and MCP.
- **Importers** for InfoPath templates and SharePoint Designer 2010 workflows. See [migration](/docs/sharepoint/migration).
- **Directory sync** of SharePoint site users and groups, so approvals go to the same people.

## Requirements

| | |
|---|---|
| SharePoint | SharePoint Server 2016, 2019 or Subscription Edition (developed and tested on Subscription Edition) |
| Farm services | App Management Service and Microsoft SharePoint Foundation Subscription Settings Service, both running |
| Add-ins | An app domain for the farm and a farm App Catalog |
| Sign-in | The identity provider the farm uses, such as AD FS or Windows sign-in, configured as single sign-on in UserTasks |
| UserTasks | Self-hosted in your network, or UserTasks Cloud through the [on-premises gateway](/docs/integrations/gateways), served over HTTPS |
| Licence | A SharePoint licence, per farm, checked offline from a signed licence file |

## Install

New to UserTasks? [Get started in 4 steps](/sharepoint/get-started) walks you from the free trial through installing UserTasks to your first list.

The SharePoint extension comes built into its own UserTasks image, the **SharePoint edition**. The one-line installer downloads it with your licence (a trial or a purchased one):

\`\`\`bash
curl -fsSL https://usertasks.com/install.sh | sh -s -- --edition sharepoint --licence usertasks.licence
\`\`\`

\`\`\`powershell
& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Edition sharepoint -Licence .\\usertasks.licence
\`\`\`

The installer sends the licence file to usertasks.com, which checks its signature and dates and returns a download pass for 30 minutes; the image is signed and checked before it runs, and the licence is installed for you. Already running UserTasks without SharePoint (**Settings › Extensions** then shows *Not in this build*)? Switch that install to the SharePoint edition, keeping its data, with \`usertasks upgrade --edition sharepoint\`. Air-gapped servers install from a signed offline bundle made on a connected machine: [air-gapped installs](/docs/self-hosting/air-gapped#sharepoint-edition). More: [editions](/docs/self-hosting#editions).

1. A UserTasks admin enables the extension in **Settings › Extensions** and adds the licence, or starts a [30-day trial](/docs/sharepoint/trial).
2. In **Settings › Integrations › SharePoint add-in**, enter a client ID and an issuer ID (two new GUIDs) and an RSA certificate with its private key (self-signed is fine). The key is stored encrypted and never leaves UserTasks; **Test high-trust access** checks it against each connected site.
3. Download the add-in package and its generated PowerShell install script.
4. The farm administrator runs the script in the SharePoint Management Shell with the site URLs. It trusts the certificate, registers UserTasks as a **high-trust, provider-hosted add-in**, allows SharePoint's calls to UserTasks, grants the add-in its permissions per site collection, and installs it on each site from the farm's own App Catalog. Run it again with -Upgrade after a new package, or -Uninstall to remove it. No SharePoint Store is involved.
5. Add the farm's addresses to **Settings › Trusted embedding** so forms, designers and web parts can open inside SharePoint pages. With UserTasks Cloud, SharePoint's callbacks go through the on-premises gateway's relay, so no inbound firewall rule is needed.

## No sign-in screen

Clicking UserTasks in SharePoint never shows a UserTasks login page. SharePoint sends no verifiable identity with an add-in launch, so UserTasks never trusts a user name from the page. Instead it signs the person in silently through the workspace's identity provider (OIDC with prompt=none or passive SAML). With AD FS and Windows sign-in people see nothing at all. People synced from SharePoint become UserTasks users the first time they sign in.

## Pricing

$7,500 USD per SharePoint farm per year, including every update released during the year and support. UserTasks itself is open source (Apache-2.0). Try it free for 30 days first: see [SharePoint trial](/docs/sharepoint/trial) and [usertasks.com/sharepoint](/sharepoint).
`,
  },
  {
    slug: 'sharepoint/list-dashboard',
    title: 'The list dashboard',
    description: 'What the UserTasks button opens on a SharePoint list: the set-up screen, then "UserTasks for <list>" with Overview, Runs, Metrics, Assets and Permissions.',
    body: `
The UserTasks button on a list or library opens a full page that looks like SharePoint's own settings pages, with **← Back to <list>** at the top.

::image sharepoint-dashboard-overview | The Overview tab of UserTasks for Contracts with stat tiles, the list's assets and the runs waiting for people | The Overview tab (demo data)

## The first click: set up

When nothing is bound to the list yet, the page is **Set up UserTasks for <list>**:

- **API reference**: always included. It is the list's connection and the typed SharePoint operations workflows use.
- **Forms (New, Edit, View)**: a generated form set that replaces SharePoint's forms. Untick *Keep SharePoint's own forms* to keep them.
- **A workflow**: pick the events that start it, in plain words (*Created*, *Modified*, *Deleted*, *Renamed*, *Attachment added*…), and optionally *only when this column changes (to …)*.

One **Create** button makes them, named after the list: "<list> workflow" and "<list> — New / Edit / Display". You can then open each one in its designer, inside SharePoint.

## Later clicks: UserTasks for <list>

Everything bound to the list, on five tabs. A period switch (7, 30 or 90 days) applies to the numbers, and **Start workflow** starts a run on an item.

### Overview

Stat tiles (runs started, success rate, failed, open now with running and waiting, average and p95 duration, form submissions and edit conflicts), the API reference, the forms with whether they replace SharePoint's, each workflow with its start events, status and who changed it last, create cards for what's missing, and the runs waiting for someone.

### Runs

A **workflow queue** for the list: every run with its status (running, waiting on a person, queued, completed, failed, cancelled), workflow, item, who or what started it, start time, duration and current step. Filter by status, workflow, starter and date range, search by item, run ID or person, sort, and page. **Open run** shows the run's details; **Cancel** stops a run; **Run again** restarts a failed or cancelled one.

::image sharepoint-dashboard-runs | The Runs tab: a workflow queue with status filters, search and runs waiting on a legal review or finance approval | Runs: the list's workflow queue (demo data)

### Metrics

- **Runs per day by outcome**: completed, failed or cancelled, still open.
- **Cycle time**: the average time from start to finish of the runs that completed each day, waiting on people included.
- **Where runs are waiting now**, by step and by person.
- **Form submissions per day**, per form, with edit conflicts (someone else changed the item in SharePoint while the form was open).
- **A report per workflow** for the period: started, completed, failed, cancelled, average and p95 duration, with **Download CSV**.

::image sharepoint-dashboard-metrics | The Metrics tab: runs per day by outcome, cycle time, where runs are waiting by step and person, form submissions per day and a report with Download CSV | Metrics (demo data)

### Assets

The full list of the forms and workflows bound to the list, with type, status (Draft, On, Off, unpublished changes), runs, last run and who changed it. Actions: **View**, **Edit** (the designer, inside SharePoint), **Publish** or **Turn on**, **Turn off**, **Run now**, **Delete** (confirmed), and **Add form**, **Add workflow**, **Import an existing workflow**. *Use SharePoint's forms again* restores the list's original forms.

### Permissions

Only list managers and UserTasks admins see this tab. See [permissions](/docs/sharepoint/permissions).

## One source of truth

The dashboard stores nothing of its own. It shows the forms whose target is the list and the workflows whose SharePoint trigger names it, wherever they were made. Every bound object carries a *sharepoint: <list>* tag, so the Automations and Forms pages in UserTasks show it as a badge and can filter by it.

## Who sees what

People who can't do something don't see the button for it, and the page says plainly who can ("You need Manage Lists on <list> in SharePoint", or "Ask a UserTasks admin"). Plain members see explanations, never numbers they aren't allowed to see.
`,
  },
  {
    slug: 'sharepoint/triggers',
    title: 'SharePoint trigger events',
    description: 'Start a workflow when a SharePoint list item or file is created, modified, deleted, renamed, approved, versioned or checked in, with field conditions, content type and folder filters.',
    body: `
The trigger **SharePoint item or file changed** starts a workflow when something happens to an item or file in a connected list or library.

## Settings

| Setting | |
|---|---|
| List or library | A connected list or library |
| Events | See the table below. New workflows default to Created and Modified |
| Only when these fields change | Conditions on the list's columns: *changes*, *changes to*, *changes from*, *is* / *is not*, greater or less than (numbers, dates), *contains* (people, lookups, multi-choice, text), *is empty*. All or any |
| Content type | A content type name or ID prefix |
| Folder | A folder in the list or library, subfolders included |
| Check every | How often the change log is read as a fallback: 1, 2 (default), 5, 10, 15, 30 or 60 minutes |
| Can be started by hand | Offer the workflow on the item menu ([manual start](/docs/sharepoint/manual-start)); on by default |

**Test with the latest event** reads the most recently changed item and shows the event it makes and whether this configuration would start. Nothing runs and nothing is saved.

## Events

| Event | Fires when |
|---|---|
| Created | An item or file is added, or restored from the recycle bin (with *restored from recycle bin* set) |
| Modified | Fields change or a new version is saved |
| Deleted | An item is moved to the recycle bin or deleted permanently |
| Moved to the recycle bin / Deleted permanently | Only one kind of delete |
| Renamed / Moved or renamed | A file or folder's name or location changes |
| Attachment added / removed | A list item's attachments change |
| Approval status changed | Content approval moves to approved, rejected, pending, draft or scheduled |
| New version | The version label changes (versioned lists) |
| Checked in / Checked out / Major version published | Document check-in, check-out and publishing |
| Folder created | A folder is added |

A finer event always comes **together with** the broader one that already covered the change, which stays the primary event. A workflow on *Deleted* keeps starting for both kinds of delete; choose *Moved to the recycle bin* or *Deleted permanently* to react to one only.

## How changes arrive

Events arrive by **push**, through remote event receivers the add-in registers for the events the list's workflows need (usually within a second), and by **polling** SharePoint's change log as a fallback. Both feed one pipeline, so a change seen both ways starts each workflow once.

## What the workflow receives

| Variable | |
|---|---|
| event, events | The primary event, and every event of this change |
| item_id, item_url, title, file_name, folder, content_type, version | The item |
| before, after | Field values by internal name, typed (people, lookups, terms and links as objects). *after* is empty for deletes |
| changed_fields | The fields whose values changed |
| user | Who made the change, matched to a UserTasks member by e-mail |
| approval_status, approval_status_before, version_before | Content approval and versions |
| attachments_added, attachments_removed, previous_name, deletion | Details of the change |

## One workflow per event

> [!NOTE]
> Coming in the next update of the extension. Each trigger event on a list gets one workflow, named "<list> – <event>" (for example "Contracts – Item created"). Choosing an event that already has a workflow opens that workflow, and publishing it makes a new version rather than a second workflow. When you add an event to a workflow and another workflow on the list already starts on it, UserTasks asks whether to **take it over** (the event leaves the other workflow as a new version of it, which is turned off if that was its only event) or **keep both**. Every publish checks again, so duplicates never appear silently. Existing workflows with several events keep working, and *Split into one workflow per event* is available on them.

## Limits

- Items the connection's account can't read are invisible to the trigger.
- An item added and deleted between two polls, with no push, fires nothing.
- Long text values are cut at 8,000 characters in *before* and *after*.
`,
  },
  {
    slug: 'sharepoint/manual-start',
    title: 'Start a workflow by hand',
    description: 'Start a UserTasks workflow on a SharePoint list item from the item menu or the list dashboard, with an optional note for the run.',
    body: `
Some processes don't start on a list event: someone decides. Workflows on a SharePoint list can be started by hand on any item.

::image sharepoint-start-menu | A SharePoint library with an item's menu open and Start a UserTasks workflow highlighted | The item menu (modern library, demo data)

## From the item menu

1. Select the item, open its menu (**…** or right-click) and choose **Start a UserTasks workflow**. The action is in classic and modern lists and libraries.
2. The start page names the item. Pick the workflow (only workflows with *Can be started by hand* on are offered) and, if you like, add a **note for the run**.
3. Select **Start**. The run begins on that item; **Back to <list>** returns you.

::image sharepoint-start-page | The Start a workflow page: the item, the workflow picker and an optional note | The start page (demo data)

The run receives the same item data as an event-started run, plus who started it and the note. The person is recorded as the run's starter, and the start is audited.

## From the dashboard

**Start workflow** on [the list dashboard](/docs/sharepoint/list-dashboard) does the same for an item you choose, and **Run now** on a workflow starts it on the most recently changed item, which is handy for testing.

## Only by hand

SharePoint Designer 2010 workflows that SharePoint started only manually are imported as workflows that start only by hand: they never start on changes.

## Who can start one

People who manage the list in SharePoint, UserTasks admins, and people given *Start it by hand* on the workflow in the [Permissions tab](/docs/sharepoint/permissions).

> [!NOTE]
> Coming in the next update of the extension: when a workflow declares start parameters, the start page asks for them too, validated before the run starts.
`,
  },
  {
    slug: 'sharepoint/forms',
    title: 'SharePoint list forms',
    description: 'Generated New, Edit and Display forms that replace SharePoint or InfoPath list forms inside the SharePoint page, return to the list after Save, Cancel or Delete item, and can be restored.',
    body: `
UserTasks generates **New, Edit and Display forms** for a list or library from its columns and makes them the list's forms. People keep using SharePoint's own buttons and links; the UserTasks form opens inside the SharePoint page, with the site's suite bar, header and navigation around it.

::image sharepoint-form-embedded | A UserTasks New form embedded in a SharePoint page, with SharePoint's header and navigation | A generated New form inside SharePoint (demo data)

## The form set

| Form | Fields | Buttons |
|---|---|---|
| New | The New form's columns, SharePoint's defaults; for libraries, the file first | Save, Cancel |
| Edit | The Edit form's columns; calculated columns read-only; for libraries, *Replace file* | Save, Cancel, Delete item |
| Display | Every Display column read-only, plus Created, Modified, their authors and the version | Edit item, Close, Delete item |

Each form is an ordinary UserTasks form: add rules, lookups, calculations, sections and steps in the form designer. Saving uses SharePoint's ETag, so if someone changed the item in SharePoint since the form opened, nothing is overwritten and the person is told. Lists with several content types get a content-type choice on New, and each type's own fields.

## Replaced by default

A UserTasks form made for a list **becomes the list's form** unless you opt out, whether it came from the set-up screen, *Add forms*, the API or an InfoPath import. Going back is always explicit: **Use SharePoint's forms again** restores the exact original form addresses, including InfoPath's. Deleting one UserTasks form gives SharePoint back that one form.

## Back to the list

Like SharePoint's forms, **Save**, **Cancel**, **Close** and **Delete item** return people to the list they came from (or the list's default view). These are visible button rules in the designer, so you can change them.

**Delete item** asks for confirmation and moves the item to the recycle bin. It is shown only to people SharePoint lets delete that item, and the server checks again before deleting.

## Seamless

No loading text or spinners: the form is prepared on the server with the item's values, fades in at its final height and grows with its content. Sign-in happens silently. A real problem (no access, the item is gone) shows one sentence with *Back to the list*.

## What opens the UserTasks form

| | Classic UI | Modern UI |
|---|---|---|
| List: New, Edit, Display | Ribbon, item menu and the form pages | Command bar New and Edit, clicking the title, *Edit all* in the details pane |
| Library: upload with properties (New form) | Ribbon *Upload Document* and *New Document* | *Upload with form* on the command bar |
| Library: properties (Display, Edit) | View and Edit Properties, and the properties step after any upload | *Edit all* in the details pane |

SharePoint keeps a few screens of its own: Quick edit (the grid), inline editing in the modern details pane, and the modern library's New (from a template) and Upload.

## Uploading to a library

When a library has a UserTasks New form, uploading with it is one step: the person picks the file and fills in its properties, and **Save** puts the document in the library (in the folder they are in) with its properties and content type, as one version, checked in. They then return to the library.

- **Classic UI:** the ribbon's *Upload Document* and *New Document* open the UserTasks New form. They look the same as before.
- **Modern UI:** the command bar gets **Upload with form**. SharePoint opens it in a new tab, and after Save that tab shows the library.
- **SharePoint's own uploads stay available:** drag and drop, the modern *New* and *Upload* buttons, and the *New* and *Upload* links above a classic view. Afterwards the properties open in the UserTasks Edit form. In classic UI that happens straight after the upload; in modern UI, use *Edit all*. In a library with required columns, SharePoint keeps such a document checked out until its properties are saved.

The buttons belong to the library's forms. **Use SharePoint's forms again** removes them, and SharePoint's own Upload and New Document come back.

## Designers inside SharePoint

Opening a form or workflow from the dashboard opens the UserTasks designer inside a SharePoint page: SharePoint's header stays, the designer fills the rest, and **Back to <list>** or **Done** returns to the dashboard.

## What isn't mirrored

- SharePoint's column and list validation formulas beyond simple comparisons are checked by SharePoint when saving, and its message is shown.
- Multi-value managed metadata is read-only on New and Edit.
- Version history, check-in and check-out stay in SharePoint.

See also [Import InfoPath forms](/docs/tasks/import-infopath) and [Forms](/docs/tasks/forms).
`,
  },
  {
    slug: 'sharepoint/web-parts',
    title: 'SharePoint web parts',
    description: 'The UserTasks – My tasks and UserTasks – Form web parts for classic SharePoint pages: settings, silent sign-in, sizing and limits.',
    body: `
The add-in brings two web parts (add-in parts) for **classic** SharePoint pages, such as a team site's home page or a web part page.

::image sharepoint-my-tasks | The My tasks web part on a SharePoint team site's home page, with Approve and Reject on each task | UserTasks – My tasks on a site's home page (demo data)

## Add one to a page

Edit the page, then **Insert › App Part** and choose **UserTasks – My tasks** or **UserTasks – Form**. They are also in the Web Part Gallery under **UserTasks**. Open the part's **Web Part Properties** to change its settings, which are under the **UserTasks** category.

> [!IMPORTANT]
> SharePoint security updates since July 2025 turn the web part tool pane off per site collection, for every web part. To change settings on a site, the farm administrator runs Enable-SPToolPane for that site collection, or the install script with -EnableToolPane. Without it the parts still work with their defaults.

Nobody signs in: the part signs people in silently with the workspace's single sign-on, shows no spinners or sign-in page, and resizes with its content.

## UserTasks – My tasks

The signed-in person's tasks, with title, workflow and step, due date (overdue in red), priority and status. Filters: **Mine**, **My groups**, **All**; **Open** or **Completed**; **Any time**, **Due soon**, **Overdue**; plus search and pages.

On each task: **Approve** / **Reject** (or the task's own outcomes) when there is nothing left to fill in, **Accept** / **Decline**, **Claim** / **Unclaim** for team tasks, and **Open**, which shows the full task page in a panel inside the part. Every action goes through the same permissions, validation and audit as the UserTasks app.

| Setting | Default |
|---|---|
| Show: my tasks, my groups' tasks, or all I can see | My tasks |
| Number of items (1–50) | 10 |
| Show completed, compact, show filters and search | yes, no, yes |
| Only tasks for this SharePoint list (title or ID) | all |
| Only tasks of these UserTasks workflows | all |
| Open tasks in: a panel or a new tab | panel |

## UserTasks – Form

A UserTasks form on the page. While editing the part, it lists the forms you can open; copy one's ID into **Form** in the properties. Public forms work without anyone signing in; other forms sign the person in silently.

| Setting | Default |
|---|---|
| Form: a form ID or link | — |
| Height: auto (follows the form) or fixed | auto |
| After submit: the form's own setting, a thank-you message, a fresh form, or go to a page | the form's setting |
| Hide form title | no |

## Modern pages

On SharePoint Server, modern pages host only SPFx web parts, so these add-in parts appear on classic pages. The embed pages they use are host-agnostic, ready for an SPFx web part.

## Requirements

The farm's addresses must be in **Settings › Trusted embedding**, and UserTasks must be served over HTTPS. Browsers that block cookies in embedded windows may ask for one **Continue** click; putting UserTasks on a name in SharePoint's own domain avoids it.
`,
  },
  {
    slug: 'sharepoint/permissions',
    title: 'SharePoint permissions modes',
    description: 'Who can set up and manage UserTasks forms and workflows on a SharePoint list: Follow SharePoint permissions (Manage Lists) or UserTasks roles only, per-object grants and the Permissions tab.',
    body: `
A workspace setting decides who can set up UserTasks from the SharePoint button: **Settings › Extensions › SharePoint › Who can set up UserTasks from the SharePoint button**.

## Follow SharePoint permissions (default)

Anyone with **Manage Lists** on a list or library in SharePoint can set up and manage the forms and workflows bound to **that list only**: create them, publish, turn off, run, delete, and edit them in the designer. This works even when they are an ordinary member in UserTasks.

- The person is matched to SharePoint by the verified e-mail of their UserTasks account, never by an identity sent from the page.
- The check runs **again for every action** on the server. Someone who loses Manage Lists in SharePoint can't take the next action; the objects stay.
- Clicking **Edit** gives the list manager access to change that one form or workflow. It is listed in the Permissions tab and taken away once they no longer manage the list.
- Every action is recorded in the audit trail with the reason, *via SharePoint permission (Manage Lists on <list>)*.

> [!WARNING]
> Workflows run with the identity of the SharePoint connection, which usually has more rights than the list manager (for example, writing to other lists on the site). That is the same trust SharePoint Designer workflows had, but it is a real delegation. Choose **UserTasks roles only** if list owners should not automate.

## UserTasks roles only

Setting up and managing needs the usual UserTasks permissions: forms.edit, workflows.create, activate and delete, and Manage SharePoint connections. UserTasks admins and owners can always do everything.

## The Permissions tab

On [the list dashboard](/docs/sharepoint/list-dashboard), list managers and UserTasks admins see:

::image sharepoint-dashboard-permissions | The Permissions tab: who can change the forms and workflows, who can use them, and the library's SharePoint permissions | The Permissions tab (demo data)

- **Who can change these forms and workflows**: the mode, the UserTasks roles that can change them everywhere, and per form and workflow, the people given access of their own, with **Give someone access** (audited).
- **Who can use them**: which roles can open the forms (SharePoint still decides which items each person can see and change), who the workflows start for, and who can start them by hand.
- **Permissions in SharePoint**: the list's SharePoint permissions, read-only, with *Change permissions in SharePoint*.

## Forms and items

UserTasks forms never widen SharePoint's permissions: reads and writes to items run through SharePoint, and *Delete item* appears only for people SharePoint lets delete that item.
`,
  },
  {
    slug: 'sharepoint/migration',
    title: 'Migrate SharePoint workflows and forms',
    description: 'Bring InfoPath forms, SharePoint Designer 2010 workflows and Nintex workflows into UserTasks: dry-run reports, drafts and SharePoint targets.',
    body: `
Start from what you already have. Every importer first analyses (a dry run) and reports how each part converts; imports always create **drafts**, and SharePoint is never changed by an import.

| Importer | Reads | Makes | Availability |
|---|---|---|---|
| InfoPath form | .xsn templates, or the form templates of a connected site's form libraries and list forms | UserTasks forms; list forms become the list's forms | Free, in UserTasks core; site scan in the extension |
| SharePoint Designer 2010 workflow | .xoml workflow files (or a .wsp / .zip holding them), or a workflow pulled from a connected site | A draft workflow on the SharePoint trigger of the list it ran on | SharePoint extension |
| Nintex workflow | .nwf (Nintex for SharePoint 2013 / 2016) and .nwp (Office 365) exports, or a .zip of them | A draft workflow: standalone, on a SharePoint list and event, or a new draft version of an existing workflow | Free, in UserTasks core; SharePoint targets with the extension |

Find them in **Automations › Import from…** and **Forms › Import**, through the REST API, MCP and the CLI.

## Nintex workflows

**Import from Nintex** previews the export with a mapping report, then imports it as a draft. Inside SharePoint it is also in the embedded designer, for the list you are on:

- it checks the list's columns against the ones the workflow uses, and can add the missing ones;
- SharePoint actions (set item permissions, create, update and delete items, and others) become SharePoint steps on the connected list;
- it can create the SharePoint list from the import when the list doesn't exist yet.

Nintex Forms come in from .nwp packages and list templates; a .nwf file contains only the workflow. Actions without an equivalent come in as labelled placeholders to rebuild.

## The report

Each action, condition and variable is listed as *mapped*, *partial* (converted, review it), *placeholder* (a labelled "To rebuild" step that keeps the original in its note) or *skipped*, with a coverage percentage, a complexity score and a readiness verdict: *auto*, *review* or *rebuild*.

## SharePoint Designer 2010: what maps

| SharePoint Designer 2010 | UserTasks |
|---|---|
| Start Approval / Feedback / Custom Task Process, Assign a To-do Item | User Task with outcomes |
| Set Field in Current Item, Create / Update / Delete List Item | SharePoint item steps on the connected list |
| Lookups in other lists | A query step before the action |
| Set Workflow Variable, Do Calculation, Build Dynamic String | Set variable, math, text template |
| Send an Email, Log to History List | Send email, log |
| Pause for Duration / until Date, Stop Workflow | Delay, Pause until, End |
| If / Else If / Else | Condition |
| Item permission actions, check in / out, content approval | SharePoint permission, file and approval steps (review them) |

A workflow that started on item creation or change gets the same events; one that SharePoint started only by hand starts only from the [item menu](/docs/sharepoint/manual-start).

## A migration scan

The extension can scan a connected site and list its SharePoint Designer workflows and InfoPath forms, with the lists they belong to, so you can plan list by list.

## Suggested order

1. Scan the site and retire what nobody uses.
2. Import the InfoPath forms; finish the rules the report flags.
3. Import or rebuild one workflow per pattern; test it on real items with **Run now**.
4. Publish, make the UserTasks forms the list's forms, and turn the old workflow off.

See the [SharePoint workflow migration guide](/sharepoint-workflow-migration), the [InfoPath migration guide](/infopath-migration-guide) and [Nintex alternative](/nintex-alternative).
`,
  },
  {
    slug: 'sharepoint/trial',
    title: 'SharePoint trial',
    description: 'Try the SharePoint extension free for 30 days on one farm: start it on usertasks.com or inside self-hosted UserTasks (online or air-gapped), what you see during the trial, and what happens when it ends.',
    body: `
The SharePoint extension has a **free 30-day trial** for one SharePoint Server farm. For the whole path from trial to your first list, see [Get started in 4 steps](/sharepoint/get-started). You need self-hosted UserTasks next to the farm (Docker or Kubernetes), a work email address and the farm ID. No card.

> [!NOTE]
> There is one trial per farm and one per company email domain. Asking again for the same farm gives you the same licence again.

## Find the farm ID

On a farm server, in the SharePoint Management Shell:

\`\`\`powershell
(Get-SPFarm).Id
\`\`\`

It is a GUID such as \`3f2504e0-4f89-11d3-9a0c-0305e82c3301\`. UserTasks identifies the farm the same way when you connect a site (the farm's authentication realm, which is the farm ID unless someone changed it with \`Set-SPAuthenticationRealm\`). The trial licence only works with that farm.

## Start the trial

### Inside UserTasks (recommended)

1. Sign in as an **instance admin** and open **Settings › Extensions**.
2. On **SharePoint**, choose **Start a 30-day trial**. Enter your name, work email, company and the farm ID, and accept the trial terms.
3. If UserTasks can reach usertasks.com, the licence is fetched and installed at once. Turn **SharePoint** on and connect a site of that farm.

If this install runs plain UserTasks, **Settings › Extensions** shows SharePoint as *Not in this build* with the same **Start a 30-day trial** button. After the trial is installed, switch the install to the SharePoint edition on the server (it uses the licence you just installed, takes a backup first and keeps all data), then turn SharePoint on:

\`\`\`bash
usertasks upgrade --edition sharepoint
\`\`\`

The UserTasks add-in's first page in SharePoint also has **Start a 30-day trial**: it opens the same form with the farm ID filled in.

### Air-gapped or no internet access

If UserTasks can't reach usertasks.com (or you choose **This server is offline**):

1. UserTasks shows a **request code** (it starts with \`UTTRIAL1-\`). It holds the farm ID and this installation's ID and address, and no secrets. Copy it.
2. On any computer with internet access, open [usertasks.com/sharepoint/trial](/sharepoint/trial), paste the code into the farm ID box and fill in the form.
3. The licence is shown on the next page and emailed to you. Paste it into **Paste your trial licence** in UserTasks (or upload the \`.licence\` file in **Settings › Licence**).

### On usertasks.com

Fill in the form at [usertasks.com/sharepoint/trial](/sharepoint/trial) with the farm ID. The licence is shown at once and emailed. Install it in **Settings › Licence** (upload the file or paste the text).

## During the trial

- Everything in the extension works, on that farm.
- Instance admins see a small **Trial: N days left · Buy** line at the top of UserTasks and on the extension in **Settings › Extensions**.
- From **7 days** before the end, the line turns into a warning, instance admins get an email (7 days, 1 day, at the end and when it stops), and the SharePoint dashboard shows a notice.

## When the trial ends

The extension stops **24 hours after the trial expires**, the same rule as a paid licence. Just before it stops, UserTasks:

- **Gives SharePoint its own forms back.** Every list that uses UserTasks forms gets its original New, Edit and Display forms again, exactly as they were, so nobody is stuck. UserTasks records which forms it replaced.
- **Pauses workflows that SharePoint events start.** They are not deleted. Running workflows that reach a SharePoint step pause there with their data kept.
- Leaves the add-in's event receivers in place; SharePoint keeps working normally and UserTasks ignores their calls.

If SharePoint can't be reached at that moment, UserTasks retries every few minutes and shows what is left in **Settings › Extensions**.

**Nothing is deleted**: forms, workflows, runs, settings and data stay in UserTasks.

## Upgrades and a lapsed licence

\`usertasks upgrade\` downloads each new SharePoint edition with the licence installed in UserTasks (renewals are picked up automatically). When the licence has lapsed, the upgrade is refused before anything changes, with the reason; UserTasks keeps running as it is. Install the new licence and run the upgrade again. To leave the SharePoint edition, \`usertasks upgrade --edition core\` switches back to plain UserTasks (data is kept).

## Add a licence and everything comes back

Buy a licence ($7,500 USD per farm per year) and install it in **Settings › Licence**. Within about 5 minutes UserTasks automatically:

- puts the same UserTasks forms back on the same lists, exactly as they were;
- resumes the paused workflows: SharePoint events start them again (changes made while the extension was stopped don't start workflows), and paused runs continue from the step where they stopped.

Each step is recorded in the audit log, and **Settings › Extensions** says what was restored and anything that still needs attention.

## Privacy

usertasks.com keeps your name, work email, company, the farm ID and (when UserTasks sent the request) its instance ID and address, to issue the licence, contact you about the trial and stop repeat trials.
`,
  },
]

