# IT service desk

An app for a small IT team: people raise tickets and follow them, agents work a Kanban board, and everyone can see whether SLAs are on track. A knowledge base answers the common questions first.

## What's inside

| Asset | What it does |
|---|---|
| **IT service desk** (app) | Five pages: Home, Team board, SLA, Insights, Knowledge. Top navigation with a coloured header. |
| **Raise a ticket** (form) | Name, email, category, priority, summary, details, asset tag, screenshots. |
| **Service desk ticket** (workflow) | Logs the ticket, gives the desk a task due in a day, loops back to the requester when more information is needed. |
| **Service desk tickets** (data table) | The ticket register with priority, status, agent and SLA state (14 sample tickets). |
| **Knowledge articles** (data table) | Self-help articles shown as cards (8 sample articles). |

## Pages

- **Home**: a maintenance notice, Raise a ticket (opens the form in a dialog), Knowledge base, Team board (agents only), My tickets and popular fixes.
- **Team board** (contributors): my workload, open and resolved counts, a Kanban board by status (drag cards to change status), open tickets per agent and the open ticket list. Click an agent in the per-agent chart to filter the board and the list to them.
- **SLA** (contributors): open tickets against SLA, the SLA state of every ticket in the register (green, amber and red from the theme), breached tickets, SLA by agent and the weekly trend. The Period filter drives the charts.
- **Insights** (contributors): top categories, tickets by priority, raised versus resolved, time to resolve and the full register grouped by status.
- **Knowledge**: searchable article cards with a link to each article, and a Raise a ticket button for when the article does not help.

## Roles

- **Viewers** read the pages but never see Raise a ticket or the task buttons.
- **Contributors** raise tickets, reply to the desk and, if they are agents, work tickets assigned to them. Give everyone this role.
- **Editors** change the app in the builder; the person who installs the package is the first editor.

Nobody sees the app until you share it: open **Apps → IT service desk → Settings → Audience** after install.

## Customise it

- **Routing**: the install asks who works new tickets. Point the "Work the ticket" step at your service desk team later, or add a condition on priority to route P1 tickets to an on-call person.
- **SLA**: change the step's due date (one day) and the widgets' "at risk" window (eight hours).
- **Knowledge**: replace the Knowledge articles rows with your own help site; the cards and search update at once.
- **Look**: change the accent colour, icon, header style or navigation in the app's settings. Charts use theme colours, so they work in light and dark mode.
