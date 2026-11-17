import type { DocPageDef } from '../types'

export const NINTEX_IMPORT_PAGE: DocPageDef = {
  slug: 'tasks/import-nintex',
  title: 'Import from Nintex',
  description: 'Upload Nintex workflow exports (.nwf from Nintex for SharePoint, .nwp from Nintex for Office 365): each becomes a draft UserTasks workflow, its Nintex Forms become UserTasks forms, with a report of what mapped and what needs review.',
  body: `
UserTasks reads the files Nintex exports and rebuilds them as UserTasks workflows and forms. It's available to everyone, with no add-on needed. The files are only read for the import and never stored. Every workflow is made as a **draft**: you review it, then publish it.

## What it reads

| File | Product | What's inside |
|---|---|---|
| **.nwf** | Nintex for SharePoint 2010, 2013, 2016 and Subscription Edition | One workflow: start options, variables and every action |
| **.nwp** | Nintex Workflow for Office 365 | One workflow package, often with Nintex Forms (classic or responsive) for the start form and task forms |
| **.zip** | Either | Several .nwf / .nwp files. User defined actions (.uda) are listed, and each workflow that uses one gets a placeholder for it |

## Import a workflow

1. Go to **Build › Workflows** and select **Import from… → Nintex workflow (.nwf / .nwp)**.
2. **Upload**: drop the files onto the box, or click to browse.
3. **Preview**: see what maps. This shows the coverage, each workflow's actions, the steps it becomes, its tasks and the actions to rebuild, the Nintex start options, and the items that need attention. You can download the full report as JSON.
4. **Where should this go?** Choose one:
   - **A new workflow**: a standalone workflow with no SharePoint dependency. It starts manually or by API, or on a schedule. Nintex *site workflows* start on a schedule by default. Nintex doesn't export its schedules, so set the schedule after the import. SharePoint list actions (update item, create item, query list …) become clearly marked placeholders.
   - **A connected SharePoint list** (when the SharePoint extension is installed): the workflow runs on the list's events. The Nintex start options (on create, on change, manual) choose the events. List actions become SharePoint steps.
   - **Replace an existing workflow**: the import becomes a **new draft of the workflow you pick**. Its id, name, published versions and run history stay. Its trigger stays, unless you chose a SharePoint list target. The published version keeps running until you publish the new draft.
5. **Confirm**: check the result for that target. If the workflow had unpublished changes, the draft replaces them, and you'll see a warning first. If other workflows already run on the same list events, choose **Keep both** or **Remove the events from the other workflow**. Replacing needs you to tick **Replace the draft**.
6. Select **Import**, then **Open in the designer**.

You need **workflows.create** (or **workflows.edit**) to import, and edit access to the workflow you replace. You also need **forms.edit** to import forms. Importing into one workflow you can edit (without forms) needs only edit access to that workflow.

## Import from the designer in SharePoint

When the workflow designer is open inside SharePoint (the UserTasks button, **Add workflow** or **Edit** on a list), select **Import from Nintex** in its header. This also works on a new list or event workflow.

1. Upload the Nintex files, as above.
2. **Where should this go?** The first choice is **Connect to this SharePoint list**: the list or library and the event the designer was opened for. The import becomes a **new draft of this workflow**. Its trigger, events and filters stay, so there's never a second workflow on the same event. The other targets are under **Other options**.
3. **Confirm** checks the list's columns against every column the Nintex workflow uses: [Current Item] fields, Set field and Update item fields, conditions, and lookups to the same list. Columns are matched by internal name, then by display name. Each column shows as:
   - **matched**: the steps use it. A column matched by display name under another internal name is wired to the list's name;
   - **type mismatch** (a warning): for example, Nintex wrote a number to a text column, or wrote to a read-only column;
   - **missing**: under **Add these columns to [list name]?**, tick the ones to add and check the suggested type. The type comes from the Nintex type, else from how the workflow uses the column (a number variable written to it, compared values, a few literal values for a choice). Adding columns needs **Manage Lists** on the list in SharePoint, or the SharePoint manage right in UserTasks. The check runs again afterwards.
4. You can skip missing columns. Each step that uses one is flagged in the designer, with **Check this step** on the step and a warning on its card, until you select **Mark as reviewed**.
5. Nintex **start form** fields become the workflow's start parameters, with their labels, required flags, choices and defaults. The Run dialog and the SharePoint start page ask for them.
6. Select **Import**, then **Open the new draft**. Review it, then publish it. Publishing asks again about any other workflow on the same events.

Columns that can be added from UserTasks: single and multiple lines of text, number, currency, date and time, yes/no, choice and multiple choice (with the values the workflow uses), person, and hyperlink. Lookup, managed metadata, calculated and multiple-person columns must be added in SharePoint. A lookup the workflow used is offered as text.

On any connected list target, a workflow that already starts on the same event gets the import as its new draft too (one workflow per event). Events no single workflow covers make a new workflow, and you choose **Keep both** or **Remove the events from the other workflow**.

## Create a SharePoint list for the workflow

With the SharePoint extension, the Import dialog offers **Create a SharePoint list for this workflow**, both in the designer in SharePoint and in the app. Select it, choose the Nintex files, and check the proposal:

- the **name**: the Nintex workflow's list, or "[workflow name] items";
- the **site**: the designer's own site, or any connected site;
- a **list** or a **document library** (a library when the workflow checks documents in or out);
- the **columns**: every column the workflow uses and its start form fields, with display name, internal name, type, required and choices. Edit, remove or add columns.

**Connect this list and bind the workflow to it** is ticked by default. The import then goes onto the new list, on the events of the Nintex start options. Creating a list needs **Manage Lists** on the site in SharePoint, or the SharePoint manage right in UserTasks. If the name is taken, choose **Use the existing list** (its missing columns then go through the column check) or another name.

## What maps

| Nintex | UserTasks |
|---|---|
| Request approval, Flexi task, Request review, Assign to-do task | User task, with its outcomes as branches. Assignees are matched to members (e-mail, login) and teams (name); *Initiator* becomes the person who started the workflow and *Manager* the initiator's manager. Pick people for the rest in the preview. Reminders, escalation, delegation and lazy approval are flagged for review |
| Send notification | Send email. SharePoint people and groups need e-mail addresses |
| Set variable, Build string, Math operation, Regular expression, Calculate date | Set variable, Text template, Math, Regex, Date math |
| Collection operation (add, insert, get, count, exists, index of, remove by index or value, pop, clear, join, sort, remove duplicates) | Set variable with the list functions (\`LIST_ADD\`, \`INDEX\`, \`LIST_REMOVE\`, \`LAST\` …) |
| Set a condition, Run if | Branch by condition. Both value comparisons map, including *and* / *or* pairs. Other condition kinds need review |
| Switch | Branch by value |
| Run parallel actions | Parallel |
| For each | Loop for each |
| Loop (while a condition holds) | A condition that loops back with **Go To Activity** |
| State machine, Change state | A state variable and a **Branch by value** over the states. Each state ends by going back to it with the next state |
| Action set | Its actions, in order |
| Pause for, Pause until | Pause for duration, Pause until date |
| End workflow, Terminate workflow | End workflow |
| Log in history list | Log |
| Set workflow status | A *workflow_status* variable (review) |
| Call web service, Web request | HTTP request. **Stored credentials are never copied**: use a connection or secret |
| Commit pending changes | Not needed: UserTasks saves changes at once |
| Update item, Set field, Create item, Delete item, Query list | SharePoint steps on a connected list. A Query list's CAML becomes an OData filter, order and row limit, on the list it names when that list is connected (untranslatable CAML is kept as is, for review). As a standalone workflow: placeholders that show the filter |
| Set item permissions | *Set item permissions* steps: **Stop inheriting permissions** (without the inherited ones) first when Nintex replaced the permissions, then one grant per user or group. A [Current Item] person column grants its person, a workflow variable its value, groups and logins stay as they are |
| Check out / Check in, Set approval status, Start workflow, Wait for item update, Wait for check out status change | The SharePoint steps *Check out / check in*, *Set approval status*, *Start workflow on item* and the two waits |
| User defined actions, custom actions and Xtensions, AD / Exchange actions, document generation, Nintex Live, Query / Update XML | Placeholders that keep the action's name and settings (never its passwords) |

The SharePoint-only actions need the SharePoint extension. With it, they map on every target. Without a list (a standalone workflow, or the first preview), the steps come in with the list left to choose. Without the extension, the report says *SharePoint step: needs the SharePoint extension*.
| Disabled actions | Not imported (listed in the report) |

References inside the actions are translated:

- **Item fields** become \`{{after.Field}}\` on a SharePoint list. On a standalone workflow they become start parameters (\`item_field\`).
- **Workflow variables** become \`{{variable}}\`.
- **Workflow constants** become variables called \`const_…\`. Set their values after the import, and put any credentials in a connection or secret.
- **Common values** (initiator, current date, item URL …) become the run's own values.
- **Inline functions** become expression functions: \`fn-Replace\` → \`REPLACE\`, \`fn-FormatDate\` → \`FORMAT_DATE\` (with the .NET format translated), \`fn-SubString\` / \`fn-Remove\` / \`fn-Insert\` → \`SUBSTRING\` / \`REMOVE\` / \`INSERT\`, \`fn-DateDiffDays\` → \`DATE_DIFF\`, \`fn-Currency\` → \`FORMAT_CURRENCY\`, \`fn-XmlDecode\` → \`XML_DECODE\`, and more. Functions with no equivalent (\`fn-XPath\`) are flagged for review.

## Nintex Forms

Forms inside a .nwp become UserTasks forms, with their fields in order:

- text, multi-line text, choice (with options), date and time, people, yes/no, number, currency, hyperlink, lookup and attachments;
- panels and groups become headings.

Labels, images, buttons, rich text and repeaters are listed as not converted. Form rules are counted for you to rebuild. Choose **New forms** (any workspace form, which you can bind to data later), **Do not import**, or **Replace an existing form**, which makes a new draft of the form you pick.

## Also by API

\`POST /api/v1/importers/nintex/analyze\` and \`…/import\` take the files (base64) and options:

- \`target\`: \`new\`, \`replace\`, or an extension target (\`ext.<extension>.<key>\`, listed by the Import dialog);
- \`trigger\`: \`auto\`, \`manual\` or \`schedule\`;
- \`workflow_id\`, \`workflow\`, \`name\`, \`target_config\`, \`conflicts\`, \`forms\`, \`form_id\` and \`confirm\`;
- \`keep_trigger\`: with an extension target and \`workflow_id\`, the replaced workflow keeps its own trigger.

The report's \`details.workflows[].columns\` holds the column check, and \`startParameters\` and \`columnsNeeded\` hold the start parameters and the columns a new list would need.

The MCP tools \`importers_analyze\` and \`importers_import\` do the same.
`,
}
