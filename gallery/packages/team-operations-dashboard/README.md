# Team operations dashboard

A dashboard app for team leads and operations managers: KPIs, throughput, bottlenecks, cycle time and overdue work in one place, filtered by team, period and person, with charts that filter each other.

## What's inside

| Asset | What it does |
|---|---|
| **Team operations** (app) | Three pages: Overview, Team, Delivery. Tab navigation, compact density. |
| **Team work request** (form) | What is needed, team, type, priority, needed-by date, details. |
| **Team work item** (workflow) | Logs the work item, the lead triages it (accept or decline), the team delivers it, the item closes with its cycle time. |
| **Work items** (data table) | Work per team with type, priority, status and cycle time (14 samples). |
| **Weekly delivery** (data table) | Planned and delivered items per team per week (16 samples). |

## Pages

- **Overview** (filters: Team, Period, Person): an announcement, open and completed tasks, requests started, average cycle time, throughput, on-time status, bottlenecks and cycle time. Click Open tasks to go to the Team page.
- **Team** (filters: Team, Period, Person, Status): open tasks per person and tasks by status. Click a person to filter the task and overdue lists to them, click a status slice to filter by status; Show everyone clears the person. New request opens the request form in a side panel.
- **Delivery**: delivered per team, per team and week, delivered against plan, work items by type, average cycle time by team and the Work items grid grouped by team.

The task widgets on Overview and Team cover every task the viewer may see in the workspace (narrowed by the filters), not only this package's workflow, so the dashboard is useful from day one.

## Roles

- **Viewers** see the dashboards and filters; they never see New request or claim buttons. Most team leads only need this.
- **Contributors** can also send requests and claim tasks from the lists.
- **Editors** change the app in the builder; the person who installs the package is the first editor.

Share the app after install in **Apps → Team operations → Settings → Audience**.

## Customise it

- **Teams**: the Team filter lists your workspace teams (Settings → Teams) and narrows the task widgets to work routed to that team (User Task steps assigned to a team). Set a default team on the filter if most viewers lead one team.
- **Scope**: to watch only certain workflows, add a Workflow filter or set workflow_id on the widgets in the builder.
- **Delivery data**: the team leads update Weekly delivery in the grid (or from a weekly form); the goal's target is 98 items, change it to your plan.
- **Look**: change the accent colour, icon or navigation in the app's settings. Widgets follow your workspace theme in light and dark mode.
