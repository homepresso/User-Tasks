import type { DocPageDef } from '../types'

export const FORM_WIZARD_PAGE: DocPageDef = {
  slug: 'tasks/form-wizard',
  title: 'Build a form with the wizard',
  description: 'Make a form, survey, questionnaire or request form in a few plain-language steps: the wizard creates the form, a data table for the responses, an optional review or approval workflow and a results page.',
  body: `
The form wizard is the quick way to collect information. You answer a few questions, and it makes everything for you:

- a **form** people fill in;
- a **data table** that stores every response;
- a **workflow**, which saves each response and, if you want one, runs a review or approval;
- a **results page** with every response, summary cards and charts.

These are ordinary objects. Anyone who can use the designers can open and change each one in full afterwards. The wizard is optional: the [form designer](/docs/tasks/forms) is still there for anything the wizard does not cover.

## Where to start

- **My forms** in the side menu: your wizard forms and unfinished drafts, with **Build a form**.
- **Build a form** on Home.
- **+ New → Form with the wizard** at the top of the app, or the command palette (search for *build a form*).
- **Build › Forms → New form → Use the wizard (recommended)**, for people who can also use the designer.

## Drafts are saved as you go

Your progress is saved on the server a moment after each change ("Progress saved" at the top). The first save gives the draft its own address, so a reload picks up where you were.

- **My forms** lists your unfinished drafts with a **Draft** badge. **Continue** opens one; **Discard** deletes it straight away.
- You can keep up to 50 unfinished drafts.
- When you edit a form you already created, your changes are also kept as a working copy (**Unsaved changes** in My forms). Nothing changes for the live form until you select **Save changes**.

## The steps

The wizard has seven steps ("Step n of 7"). **Next** checks the step first: anything to fix is listed under "Before you go on". **Back** goes back, and the last step has **Create** (or **Save changes** when you edit).

| Step | What you decide |
|---|---|
| **What are you building?** | Start from a template: Request or application, Survey, Questionnaire or quiz, Registration or sign-up, Feedback, Incident or report, or Start from scratch. Then give the form a name and a short description. |
| **Questions** | Add, reorder, copy and delete questions. For each one, set whether it is required, add help text and options, and choose **Show this question only if…**. A live preview shows the real form. |
| **Look & feel** | Choose the colours: your workspace's look, a saved form theme or a colour. Set the header (title, subtitle, logo). Choose the layout: all on one page, in steps, or one question at a time. Write the thank-you message. |
| **Who fills it in** | People in the workspace: everyone, or chosen roles or teams, listed in their Forms menu. And/or a public link, if your workspace allows anonymous forms. Choose one response per person (for signed-in people) or many, and optional opening and closing dates. |
| **Review & approval** | Optional. Responses can go to one person, to the person's manager, to a team, or through several stages. Each stage has Approve, plus Decline and Ask for changes if you want them. You can also set due dates and email the person who submitted with the decision. |
| **Results page** | Choose whether to show charts, and which roles and teams besides you may see the results. |
| **Review & create** | See everything that will be made, then select **Create**. |

When it is done, **Your form is ready** has **Open the form**, **View results** and **Edit with the wizard**, a **Copy link** button (and **Copy embed code** for a public link), links to open each part in the designers, and **Build another form**.

### Question kinds

Short answer, Long answer, Number, Money (with a currency), Date, Email, Phone, Choice (pick one), Choices (pick any), Yes / no, File upload, Section heading and Page break, plus the [survey controls](/docs/tasks/survey-controls):

| Kind | What people see | Options in the wizard |
|---|---|---|
| **Star rating** | Stars (or hearts, thumbs up) to click | **Out of** 3, 4, 5, 6, 7 or 10, the **Symbol**, **Allow half stars** |
| **Recommend score (0 to 10)** | Eleven buttons, "Not at all likely" to "Extremely likely" (NPS) | Colour the score bands, the end labels |
| **Agreement scale** | A row of points, e.g. Strongly disagree to Strongly agree | A ready-made scale (agreement, satisfaction, frequency, importance, quality) or your own points |
| **Grid of statements** | Several statements, each answered on the same scale | The statements, the scale |
| **Slider** | A slider with the value beside it | Lowest, highest, step, unit, end labels |
| **Smiley faces** | Three or five faces from unhappy to happy (CSAT) | Three or five faces |
| **Rank in order** | A list to drag (or move up / down) into order | The options |
| **Picture choice** | Cards with an icon and a label | The options, an icon each, pick one or several |
| **Yes / no / maybe** | One segmented control | — |

The Survey, Feedback and Quiz templates use these where they fit (a star rating, a grid, a ranking and the recommend score in a survey; smiley faces and an agreement scale in feedback; a confidence slider in a quiz).

**Show this question only if…** compares an earlier answer:

- is / is not
- includes
- is answered / is not answered
- is more than / is less than

Ratings, smiley faces and the recommend score compare as numbers (for example *Recommend score is less than 7*). A grid of statements, a ranking and a file upload can't be the question another one depends on, and a page break can't be conditional. **Always show it** removes the condition. A hidden question is not required. Each condition becomes an *Always* rule in the form's [rules](/docs/tasks/forms#rules).

If you move a question above the one it depends on, or delete that question, the condition is cleared.

In a **quiz**, choose the **Right answer(s) (for the score)** of Choice (pick one), Choices (pick any) and Yes / no questions (**Don't score this question** leaves one out). Each right answer scores a point; for Choices (pick any) the picks must match exactly. The score is stored with each response and shown on the results page. There is no pass mark.

Limits: up to 100 questions, 50 options per question and 30 statements in a grid.

## What gets made

**The data table** is named "*form name* responses". It has one column per question (a grid of statements has one column per statement, so reports can count each statement), plus:

- **Reference**: the short code people see after they submit.
- **Submitted by**, **Submitter email** and **Submitted at**.
- **Status**: *Submitted*, or with a review *Pending*, *Approved*, *Declined* or *Changes requested*.
- **Stage**: for several stages.
- **Decided by**, **Decided at** and **Decision note**: with a review.
- **Score**: for quizzes.

**The workflow** starts with **Form Submitted** and saves the response as a row. With a review, each stage then becomes a task:

- The task shows the answers read only, with a box for comments.
- It has the buttons you chose.
- **Approve** moves the response to the next stage, or marks it *Approved* after the last one.
- **Decline** and **Ask for changes** record the decision straight away. *Ask for changes* asks the person to submit the form again; it doesn't reopen their response.
- **Each stage is due after (days)** sets one due date for every stage (3 days by default, up to 90), with a reminder a day before.
- With **Email the person who submitted it with the decision** on (the default), they get the decision and the reviewer's comments.

Who approves: **One person approves**, **The person's manager approves**, **A team (anyone in it can pick it up)**, or **Several stages** (2 to 5, each with **A person**, **The person's manager**, **A team** or **An Entra ID group**). The team choice appears when your workspace has teams or an Entra ID connection.

"The person's manager" is looked up in the reporting lines (Org) when the form is submitted. If they have no manager, or the form was filled in through a public link, the task goes to the person you chose under **If they have no manager, send it to**. A team task can be picked up by anyone in the team.

To see or change the generated workflow, open it from **Open in the designers** on the done screen. Your changes there are replaced the next time you save the form with the wizard.

**The results page** shows:

- cards: **Responses**, **This week** (compared with last week), and, when they apply, **Waiting for a decision**, **Approval rate** and **Average score**;
- responses over time (the last 30 days) and how many answered each question;
- a chart for each question that has one, picked for its kind: the average rating with its distribution, the recommend score (NPS) on a gauge with promoters, passives and detractors, agreement as a bar centred on the neutral point, a grid as one bar per statement, a slider's average, median and spread, the CSAT percentage, the average position of each ranked option, and counts for choices, picture choices and yes / no / maybe. Every chart has a **Table** button with the same numbers. The numbers are worked out on the server, so a large survey stays fast;
- every response (25 a page), with **Search responses**, a status filter and **Newest first** / **Oldest first**.

The cards and charts use the newest 5,000 responses. The page is at \`/forms/results/<id>\`. Only you, the roles and teams you chose, and people who can edit forms can open it (they also need **Submit forms**).

One **saved report** per form is also created, for you only: *form name: responses*. It lists every response with the questions as columns (file uploads are left out), plus status and decision when there is an approval and the score for a quiz, with [summary charts](/docs/reports#summary-charts) above the table:

- **Total responses**, **Responses over time** (the last 90 days, per day), **By day of the week** and **By hour of the day** (in the viewer's time zone);
- **By status** when there is a review or approval;
- **Average score** and the spread of **Scores** for a quiz;
- up to three charts for the questions that chart best: the recommend score (NPS) as a number, ratings, smiley faces and agreement scales as columns in scale order, Choice (pick one), Yes / no (/ maybe) and single-pick picture choice as a donut (bars when there are more than 5 options), and a slider's average. Never more than 8 charts in all.

You can change, reorder or remove the charts with **Edit** on the report, and share it from **Reports**. The results page keeps its own chart for every question.

> [!NOTE]
> **Existing forms get charts on their next wizard save.** A form made before summary charts gets them the next time you open it with **Edit with the wizard** and select **Save changes**. Every wizard save puts the report's columns, charts and filters back to the wizard's, so make lasting report changes in a copy of the report.

## Changing a form later

Open it from **My forms → Edit**, or **Edit with the wizard** on the results page, and select **Save changes**. What changes:

- **Form**: it gets a new version.
- **Workflow**: it is rebuilt and published again.
- **Results page**: it follows the new questions.
- **Saved report**: its columns and charts are rebuilt (see above).
- **Data table**: new questions add columns. Nothing already collected is removed. A deleted question keeps its column and its answers. A question cannot change to a kind that would change its column's type; add it as a new question instead.

You can change a wizard form if you made it or can edit forms, and you have **Create forms with the wizard**.

## Who can use it

The wizard needs **Create forms with the wizard** (\`forms.wizard\`). Owner, Admin, Manager and Member have it by default; Viewer does not.

The wizard only creates its own objects, owned by you. It does not give you any other build access: you don't need **Edit forms**, **Create tables** or **Create workflows**, and you don't get them. Steps you can't use are hidden or explained, for example the public link when anonymous forms are off.

**Describe it and we'll draft it** appears when your workspace has an AI provider connection (the one [agents](/docs/agents) use). Describe the form and select **Draft questions**. Your description is sent to that provider, and its questions **replace** the ones you have. Nothing is stored by the provider step. It doesn't suggest grids, sliders or picture choices; add those yourself.

## API, MCP and CLI

| | |
|---|---|
| REST | \`POST /api/v1/forms/wizard\` with \`{ spec }\` (add \`dry_run: true\` for the plan only). Also \`GET /api/v1/forms/wizard\`, \`GET\` and \`PATCH /api/v1/forms/wizard/{id}\`, and \`GET /api/v1/forms/wizard/{id}/results\`. |
| MCP | \`forms_wizard_create\`, \`forms_wizard_update\`, \`forms_wizard_list\`, \`forms_wizard_get\`, \`forms_wizard_results\` |
| CLI | \`usertasks forms wizard-create -f spec.json\`, \`wizard-list\`, \`wizard-get\`, \`wizard-update\`, \`wizard-results\` |

The spec is the wizard's answers: \`name\`, \`questions\`, \`look\`, \`audience\`, \`approval\` and \`results\`. The [API Explorer](/docs/api-explorer) has the full shape. With the CLI, \`-f\` takes the whole request body (\`{ "spec": { … } }\`). If any step fails, everything already created is removed and the error says why (it names anything that could not be removed, for an admin to delete).

For a step-by-step example, see the tutorial [Build a form with the wizard](/docs/tutorials/first-form-wizard).
`,
}
