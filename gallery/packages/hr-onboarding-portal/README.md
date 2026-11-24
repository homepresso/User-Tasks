# HR onboarding portal

An app that gets every new starter ready for day one: hiring managers request a starter, IT, Facilities, the People team and the manager each get their task, and everyone can see the checklist and the start dates coming up.

## What's inside

| Asset | What it does |
|---|---|
| **Onboarding portal** (app) | Five pages: Home, Checklist, Team tasks, Start dates, Resources. Tab navigation with a coloured header. |
| **New starter request** (form) | Name, job title, department, manager, start date, location, employment type, equipment, notes. |
| **New starter onboarding** (workflow) | Adds the starter and four checklist items, then a task each for IT, Facilities, the People team and the manager, due on the start date. |
| **New starters** (data table) | Starters with start date, location, status and checklist progress (6 samples). |
| **Onboarding checklist** (data table) | One row per item per starter, with the owning team and status (24 samples). |

## Pages

- **Home**: New starter (opens the form in a side panel), links to the checklist, start dates and your tasks; starters in the pipeline, average checklist progress (gauge), open tasks, requests this month, progress per starter and who is joining soon.
- **Checklist**: items by status, items per team and status, and the checklist grid grouped by starter. People with Manage rows on the table can tick items off in the grid.
- **Team tasks** (contributors): your onboarding tasks, tasks per person and a Kanban board of every onboarding task.
- **Start dates**: a month calendar of onboarding tasks (each is due on the start date) beside the list of starters.
- **Resources**: links for managers and a short explanation of the process.

## Roles

- **Viewers** read the pages but never see New starter or task buttons.
- **Contributors** request starters and complete the onboarding tasks assigned to them: hiring managers and the IT, Facilities and People teams.
- **Editors** change the app in the builder; the person who installs the package is the first editor.

Share the app after install in **Apps → Onboarding portal → Settings → Audience**.

## Customise it

- **Who prepares what**: the install asks who receives the IT, Facilities and People team steps. Point each at a team later; the manager step already goes to the manager chosen on the form.
- **Order**: the four tasks run one after the other. Reorder them, or add more checklist items (copy an "Add checklist" step and a task).
- **Due dates**: every task is due on the start date with a reminder two days before; change that on each step.
- **Look**: change the accent colour, icon or navigation in the app's settings. Widgets follow your workspace theme in light and dark mode.
